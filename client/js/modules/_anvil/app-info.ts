import {
    Args,
    Kws,
    buildNativeClass,
    buildPyClass,
    chainOrSuspend,
    checkString,
    copyKeywordsToNamedArgs,
    objectRepr,
    pyAttributeError,
    pyCall,
    pyCallOrSuspend,
    pyDict,
    pyFunc,
    pyKeyError,
    pyMappingProxy,
    pyNewableType,
    pyNone,
    pyObject,
    pyRuntimeError,
    pyStr,
    pyTypeError,
    pyValueError,
    toJs,
    toPy,
} from "@Sk";
import { pluggableUI } from "@runtime/modules/_anvil/pluggable-ui";
import { getClientConfig } from "@runtime/runner/data";
import { PyModMap, anvilServerMod, funcFastCall, pyPropertyFromGetSet } from "@runtime/runner/py-util";
import { getRandomStr } from "@runtime/utils";

interface AnvilEnvironmentInfo {
    description?: string;
    tags?: string[];
}

interface AnvilAppInfo {
    environment: AnvilEnvironmentInfo;
    [attr: string]: unknown;
}

declare global {
    interface Window {
        anvilAppInfo: AnvilAppInfo;
    }
}

interface EnvironmentInstance extends pyObject {
    data: AnvilEnvironmentInfo;
}

interface ThemeColorsInstance extends pyObject {
    mapping: pyDict<pyStr, pyObject>;
    $getVar(themeName: string): string;
}

interface AppInfoInstance extends pyObject {
    _environment?: EnvironmentInstance;
}

export function createAppInfo(pyModule: PyModMap) {
    const _environmentClass = buildNativeClass<pyNewableType<EnvironmentInstance>>("anvil.AppInfo.Environment", {
        constructor: function Environment() {
            if (ANVIL_IN_DESIGNER) {
                this.data = { description: "Designer", tags: ["debug"] };
            } else {
                this.data = window.anvilAppInfo.environment;
            }
        },
        slots: {
            $r() {
                const { description: name, tags } = this.data;
                const pyName = toPy(name);
                const pyTags = toPy(tags || []);
                return new pyStr(`Environment(name=${objectRepr(pyName)}, tags=${objectRepr(pyTags)})`);
            },
        },
        getsets: {
            // todo can remove _$rw$ after PR - https://github.com/skulpt/skulpt/pull/1306 is merged
            name_$rw$: {
                $get() {
                    return toPy(this.data.description);
                },
            },
            tags: {
                $get() {
                    return toPy(this.data.tags || []);
                },
            },
        },
    });
    [
        /*!defAttr()!1*/ {
            name: "name",
            type: "string",
            description: "The name of the current environment",
        },
        /*!defAttr()!1*/ {
            name: "tags",
            type: "list",
            description: "tags associated with the current environment",
        },
    ];
    /*!defClass(anvil,#AppEnvironment)!*/

    const rootElement = document.documentElement;

    const _ThemeColors = buildNativeClass<pyNewableType<ThemeColorsInstance>>("anvil.ThemeColors", {
        // for convenience we subclass from mappingproxy
        // not really allowed in python but fine in js
        // saves us implementing all the dict methods
        base: pyMappingProxy,
        constructor: function ThemeColors() {
            // mapping is the internal name used in mapping proxy
            this.mapping = toPy(window.anvilThemeColors);
        },
        slots: {
            $r() {
                return new pyStr(`ThemeColors(${objectRepr(this.mapping)})`);
            },
            tp$as_sequence_or_mapping: true,
            mp$ass_subscript(key: pyObject, val?: pyObject) {
                if (val === undefined) {
                    throw new pyTypeError("cannot delete a theme color");
                } else if (!checkString(key)) {
                    throw new pyTypeError("theme color names must be strings");
                } else if (!checkString(val)) {
                    throw new pyTypeError("a theme color must be set to a string");
                }
                const themeColor = key.toString();
                if (!(themeColor in window.anvilThemeColors)) {
                    throw new pyKeyError(key);
                }
                this.mapping.mp$ass_subscript(key, val);
                const cssValue = val.toString();
                const varname = this.$getVar(themeColor);
                rootElement.style.setProperty(varname, cssValue);
                window.anvilThemeColors[themeColor] = cssValue;
            },
        },
        methods: {
            update: {
                $meth(args: Args, kws?: Kws) {
                    const updateDict = pyCall(pyDict, args, kws);
                    for (const [key, val] of updateDict.$items()) {
                        this.mp$ass_subscript(key, val);
                    }
                    return pyNone;
                },
                $flags: { FastCall: true },
            },
        },
        proto: {
            $getVar(themeName: string) {
                return (
                    window.anvilThemeVars[themeName] ??
                    (window.anvilThemeVars[themeName] =
                        `--anvil-color-${themeName.replace(/[^A-z0-9]/g, "-")}-${getRandomStr(4)}`)
                );
            },
        },
    });

    // can only create this instance after the app has loaded
    let _themeColorsInstance: ThemeColorsInstance | undefined;
    const appInfoClass = buildPyClass(
        pyModule,
        function ($gbl, $loc) {
            $loc["__getattr__"] = new pyFunc(function (self: AppInfoInstance, pyAttrName: pyStr) {
                const attrName = pyAttrName.toString();
                if (Object.prototype.hasOwnProperty.call(window.anvilAppInfo, attrName)) {
                    return toPy(window.anvilAppInfo[attrName]);
                }
                throw new pyAttributeError(attrName);
            });
            $loc["__setattr__"] = new pyFunc(function () {
                throw new pyAttributeError("This object is read-only");
            });
            /*!defAttr()!1*/ ({
                name: "theme_colors",
                type: "mapping",
                description: "Theme colors for this app as a readonly dict.",
            });
            $loc["theme_colors"] = pyPropertyFromGetSet((self: AppInfoInstance) => {
                return _themeColorsInstance ?? (_themeColorsInstance = new _ThemeColors());
            });
            /*!defAttr()!1*/ ({
                name: "environment",
                type: "anvil.AppEnvironment instance",
                description: "The environment in which the current app is being run.",
            });
            $loc["environment"] = pyPropertyFromGetSet((self: AppInfoInstance) => {
                return self._environment || (self._environment = new _environmentClass());
            });

            /*!defMethod(_, [path])!2*/ ("Get an asset file from the app's theme assets.");
            $loc["get_asset"] = funcFastCall(function (args, kws) {
                const [self, pyPath] = copyKeywordsToNamedArgs("get_app_asset", [null, "path"], args, kws, [
                    pyNone,
                ]) as [AppInfoInstance, pyObject];
                return chainOrSuspend(
                    pyCallOrSuspend(anvilServerMod.call, [new pyStr("anvil.private.get_app_asset"), pyPath]),
                    (media: pyObject) => {
                        if (media === pyNone) {
                            throw new pyValueError(`Asset not found: ${pyPath}`);
                        }
                        return media;
                    }
                );
            });

            /*!defMethod(_,[package_name])!2*/ ("Get the client config for the specified package. If no package name is specified, the client config for the current app is returned.");
            $loc["get_client_config"] = funcFastCall(function (args, kws) {
                const [self, pyPackageName] = copyKeywordsToNamedArgs(
                    "get_client_config",
                    [null, "package_name"],
                    args,
                    kws,
                    [pyNone]
                ) as [AppInfoInstance, pyObject];
                const packageName = pyPackageName === pyNone ? null : pyPackageName.toString();
                try {
                    return toPy(getClientConfig(packageName));
                } catch (e) {
                    const message = e instanceof Error ? e.message : String(e);
                    throw new pyValueError(message);
                }
            });
            /*!defMethod(_,[package_name])!2*/ ("Get the server config for the specified package. If no package name is specified, the server config for the current app is returned.");
            $loc["get_server_config"] = funcFastCall(function (args, kws) {
                throw new pyRuntimeError("get_server_config is not available in the client");
            });
            $loc["package_name"] = pyPropertyFromGetSet(() => toPy(window.anvilAppMainPackage));

            [
                /*!defAttr()!1*/ {
                    name: "id",
                    type: "string",
                    description: "A unique identifier for the current app",
                },
                /*!defAttr()!1*/ {
                    name: "branch",
                    type: "string",
                    description:
                        "The Git branch from which the current app is being run. This is 'master' for development apps or apps without a published version, and 'published' if this app is being run from its published version.",
                },
                /*!defAttr()!1*/ {
                    name: "package_name",
                    type: "string",
                    description: "The package name of this app",
                },
            ];
            /*!defClass(anvil,#AppInfo)!*/
        },
        "AnvilAppInfo",
        []
    );
    [
        /*!defModuleAttr(anvil)!1*/ {
            name: "app",
            pyType: "anvil.AppInfo instance",
            description: "Information about the current app, as an instance of [anvil.AppInfo](#AppInfo)",
        },
    ];
    const app = pyCall(appInfoClass);

    return { app, pluggableUI };
}
