import { Component } from "@runtime/components/Component";
import { getCssPrefix } from "@runtime/runner/legacy-features";
import {
    funcFastCall,
    kwsToObj,
    objToKws,
    pyPropertyFromGetSet,
    s_add_component,
    s_add_event_handler,
    s_remove_event_handler,
    s_set_event_handler,
    s_setdefault,
    s_update,
} from "@runtime/runner/py-util";
import {
    buildNativeClass,
    buildPyClass,
    chainOrSuspend,
    checkOneArg,
    Kws,
    objectRepr,
    pyCall,
    pyCallable,
    pyCallOrSuspend,
    pyDict,
    pyFunc,
    pyMappingProxy,
    pyNewableType,
    pyNone,
    pyObject,
    pyStr,
    pyTypeError,
    toJs,
    toPy,
} from "@Sk";

const hooks = new pyDict<pyStr, pyObject>();

const s_focus = new pyStr("focus");
const s_spacing_above = new pyStr("spacing_above");
const s_spacing_below = new pyStr("spacing_below");
const s_none = new pyStr("none");
const s_text = new pyStr("text");
const s_anvil_TextBox = new pyStr("anvil.TextBox");

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

export const setupDefaultAnvilPluggableUI = (anvilModule: { [name: string]: pyObject }) => {
    const builtinComposites = { __name__: new pyStr("_builtin_composites") };

    for (const name of ["TextBox", "TextArea", "Button", "CheckBox", "RadioButton"]) {
        hooks.mp$ass_subscript(new pyStr("anvil." + name), anvilModule[name]);
    }

    const LinearPanel = anvilModule.LinearPanel as pyNewableType;

    const TextBoxWithLabel = buildPyClass(
        builtinComposites,
        ($gbl, $loc) => {
            const tbEvents = ["focus", "lost_focus", "pressed_enter"];

            $loc._anvil_events_ = toPy(tbEvents.map((name) => ({ name })));

            $loc.__init__ = funcFastCall((args, kws) => {
                checkOneArg("TextBoxWithLabel", args);

                const kwObject = kwsToObj(kws);
                const { label = pyStr.$empty, text = pyStr.$empty } = kwObject;
                delete kwObject.label;
                kwObject.text = text;

                const [self] = args;

                self.tp$setattr(s_spacing_above, s_none);
                self.tp$setattr(s_spacing_below, s_none);

                const add_component = self.tp$getattr<pyCallable>(s_add_component);

                return chainOrSuspend(
                    pyCallOrSuspend<Component>(anvilModule.Label, [], ["text", label]),
                    (label) => {
                        self.$label = label;
                        return pyCallOrSuspend(add_component, [label]);
                    },
                    () => pyCallOrSuspend<Component>(pluggableUI.mp$subscript(s_anvil_TextBox), [], objToKws(kwObject)),
                    (box) => {
                        self.$box = box;
                        return pyCallOrSuspend(add_component, [box]);
                    },
                    () => {
                        return pyNone;
                    }
                );
            });

            for (const prop of ["text", "placeholder"]) {
                $loc[prop] = pyPropertyFromGetSet(
                    (self) => self.$box.tp$getattr(new pyStr(prop), true),
                    (self, value) => self.$box.tp$setattr(new pyStr(prop), value, true)
                );
            }
            $loc.label = pyPropertyFromGetSet(
                (self) => self.$label.tp$getattr(s_text, true),
                (self, value) => self.$label.tp$setattr(s_text, value, true)
            );

            $loc.focus = new pyFunc((self) => {
                return pyCallOrSuspend(self.$box.tp$getattr(s_focus));
            });

            for (const eventHandlerMethod of [s_add_event_handler, s_set_event_handler, s_remove_event_handler]) {
                $loc[eventHandlerMethod.toString()] = new pyFunc((self, ...args) => {
                    const [event] = args;
                    if (tbEvents.includes(event?.toString())) {
                        return pyCallOrSuspend(self.$box.tp$getattr(eventHandlerMethod), args);
                    }
                    return pyCallOrSuspend(LinearPanel.tp$getattr(eventHandlerMethod), [self, ...args]);
                });
            }
        },
        "TextBoxWithLabel",
        [LinearPanel]
    );

    const FooterButton = funcFastCall((args, kws) => {
        const kwObj = kwsToObj(kws);
        const buttonType = toJs(kwObj.button_type);
        delete kwObj.button_type;
        kwObj.spacing_above ??= s_none;
        kwObj.spacing_below ??= s_none;

        return chainOrSuspend(pyCallOrSuspend<Component>(anvilModule["Button"], args, objToKws(kwObj)), (button) =>
            chainOrSuspend(button.anvil$hooks.setupDom(), (buttonElement) => {
                const btnEl = buttonElement.querySelector("button");
                const prefix = getCssPrefix();
                btnEl?.classList.remove(`${prefix}btn-default`);
                btnEl?.classList.add(`${prefix}btn-${buttonType || "default"}`);
                return button;
            })
        );
    });

    hooks.mp$ass_subscript(new pyStr("anvil.TextBoxWithLabel"), TextBoxWithLabel);
    hooks.mp$ass_subscript(new pyStr("anvil.alerts.FooterButton"), FooterButton);
};
