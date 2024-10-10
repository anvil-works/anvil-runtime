import {pyLazyMod, s_setdefault, s_update} from "@runtime/runner/py-util";
import {
    buildNativeClass,
    chainOrSuspend,
    Kws,
    objectRepr,
    pyCall,
    pyCallable,
    pyCallOrSuspend,
    pyDict,
    pyFunc,
    pyMappingProxy,
    pyNone,
    pyObject,
    pyStr,
    pyTypeError, setUpModuleMethods,
} from "@Sk";

const hooks = new pyDict<pyStr, pyObject>();

interface HookListener {
    key: string;
    isPrefix: boolean;
    function: pyFunc;
}

// We store listeners as a flat list on the assumption that there won't be many of them (~1 per theme), so no sense
// implementing a trie-by-path-segment or anything fancy.
const listeners: HookListener[] = [];

const checkProvideArgs = (args: pyObject[], kws?: Kws) => {
    if (kws?.length || args.length !== 2) {
        throw new pyTypeError("usage: pluggable_ui.provide(package_name, updates)");
    }

    const [packageName, updates] = args;
    if (!(packageName instanceof pyStr)) {
        throw new pyTypeError("package_name must be a string");
    }
    if (!(updates instanceof pyDict)) {
        throw new pyTypeError("updates must be a dict");
    }
    const items = updates.$items() as [pyStr, pyObject][];
    for (const [k, _] of items) {
        if (!(k instanceof pyStr)) {
            throw new pyTypeError("keys of pluggable_ui must be strings");
        }
    }
    return [packageName, updates as pyDict<pyStr, pyObject>, items] as const;
};

const PluggableUI = buildNativeClass("anvil.PluggableUI", {
    // This is pretty directly cargo-culted from anvil.app.theme_colors:
    base: pyMappingProxy,
    constructor: function PluggableUI() {
        // mapping is the internal name used in mapping proxy
        this.mapping = hooks;
    },
    slots: {
        $r() {
            return new pyStr(`PluggableUI(${objectRepr(hooks)})`);
        },
        tp$as_sequence_or_mapping: true,
        mp$ass_subscript(key, val) {
            throw new pyTypeError("use provide() method to update anvil.pluggable_ui");
        },
    },
    methods: {
        provide: {
            $meth(args, kws) {
                const [packageName, updates, updateItems] = checkProvideArgs(args, kws);

                pyCall(hooks.tp$getattr<pyCallable>(s_update), [updates]);

                const listenerCalls: (() => void)[] = [];
                for (const l of listeners) {
                    const ourUpdates = new pyDict<pyStr, pyObject>();
                    for (const [key, value] of updateItems) {
                        const jsKey = key.toString();
                        if (l.isPrefix ? jsKey.startsWith(l.key) : jsKey === l.key) {
                            ourUpdates.mp$ass_subscript(key, value);
                        }
                    }
                    if (ourUpdates.sq$length()) {
                        listenerCalls.push(() => pyCallOrSuspend(l.function, [ourUpdates]));
                    }
                }

                return chainOrSuspend(null, ...listenerCalls, () => pyNone);
            },
            $flags: { FastCall: true },
        },
        provide_defaults: {
            $meth(args, kws) {
                const [packageName, updates, updateItems] = checkProvideArgs(args, kws);

                const setDefault = hooks.tp$getattr<pyCallable>(s_setdefault);

                for (const [key, value] of updateItems) {
                    pyCall(setDefault, [key, value]);
                }

                // No listeners triggered by default setting

                // (todo is this right? We could get loaded before the initial provider!)

                return pyNone;
            },
            $flags: { FastCall: true },
        },
        add_listener: {
            $meth(args, kws) {
                if (kws?.length || args.length != 2) {
                    throw new pyTypeError("usage: add_listener(name, listener_func)");
                }
                const [pyHookName, func] = args;
                if (!(pyHookName instanceof pyStr)) {
                    throw new pyTypeError("first argument to add_listener() must be a string");
                }
                if (!func.tp$call) {
                    throw new pyTypeError("second argument to add_listener() must be a callable function");
                }
                const hookName = pyHookName.toString();
                const isPrefix = /\*$/.test(hookName);
                const key = isPrefix ? hookName.substring(0, hookName.length - 1) : hookName;

                listeners.push({ key, isPrefix, function: func });

                return func;
            },
            $flags: { FastCall: true },
        },
        remove_listener: {
            $meth(func) {
                const idx = listeners.findIndex((l) => l.function === func);
                if (idx !== -1) {
                    listeners.splice(idx, 1);
                }
                return pyNone;
            },
            $flags: { OneArg: true },
        },
    },
});

export const pluggableUI = new PluggableUI();

// Anvil built-in defaults

export const setupDefaultAnvilPluggableUI = (anvilModule: {[name: string]: pyObject}) => {
    const setDefault = hooks.tp$getattr<pyCallable>(s_setdefault);

    for (const name of ["TextBox", "TextArea", "Button", "CheckBox", "RadioButton"]) {
        hooks.mp$ass_subscript(new pyStr("anvil."+name), anvilModule[name]!);
    }

    const util = pyLazyMod("anvil.util");

    const builtinComposites = {__name__: new pyStr("_builtin_composites")} as {[name:string]: pyObject};
    setUpModuleMethods("_builtin_composites", builtinComposites, {
        TextBoxWithLabel: {
            $meth(args, kwargs) {
                return util.TextBoxWithLabel.tp$call(args, kwargs);
            },
            $flags: { FastCall: true },
        }
    });

    hooks.mp$ass_subscript(new pyStr("anvil.TextBoxWithLabel"), builtinComposites.TextBoxWithLabel);
};