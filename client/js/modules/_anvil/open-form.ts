import {
    Suspension,
    chainOrSuspend,
    pyAttributeError,
    pyCallOrSuspend,
    pyCallable,
    pyDict,
    pyFalse,
    pyFunc,
    pyImport,
    pyModule,
    pyNone,
    pyObject,
    pyRuntimeError,
    pySetAttr,
    pyStr,
    pyTypeError,
    toPy,
} from "@Sk";
import { Component, notifyComponentMounted, notifyComponentUnmounted } from "@runtime/components/Component";
import { validateChild } from "@runtime/components/Container";
import { hooks, topLevelForms } from "@runtime/runner/data";
import {
    funcFastCall,
    iterKws,
    kwsToObj,
    pyTryFinally,
    s_clear,
    s_refresh_data_bindings,
    s_slots,
} from "@runtime/runner/py-util";
import type { Slot, WithLayout } from "@runtime/runner/python-objects";
import { warn } from "@runtime/runner/warnings";

type WithLayoutSubclass = NonNullable<WithLayout["_withLayout"]["_withLayoutSubclass"]>;
type OpenableFormWithLayout = WithLayout & {
    _withLayout: WithLayout["_withLayout"] & { _withLayoutSubclass: WithLayoutSubclass };
};
type LayoutComponent = Component & { anvil$customPropsDefaults: Record<string, unknown> };
type PySlots = pyDict<pyStr, Slot>;

function hasLayout(form: Component | null | undefined): form is WithLayout {
    return form != null && "_withLayout" in form;
}

function hasLayoutSubclass(form: Component | null | undefined): form is OpenableFormWithLayout {
    return hasLayout(form) && form._withLayout._withLayoutSubclass !== undefined;
}

function isComponent(value: unknown): value is Component {
    return value != null && typeof value === "object" && "anvil$hooks" in value;
}

export function createOpenFormFunctions() {
    let appPlaceHolder: HTMLElement | null = document.getElementById("appGoesHere");

    function getAppPlaceHolder(): HTMLElement {
        appPlaceHolder ??= document.getElementById("appGoesHere");
        if (appPlaceHolder === null) {
            throw new Error("Missing app placeholder element");
        }
        return appPlaceHolder;
    }

    function clearPlaceHolder() {
        const appPlaceHolder = getAppPlaceHolder();
        while (appPlaceHolder.lastChild) {
            appPlaceHolder.removeChild(appPlaceHolder.lastChild);
        }
    }

    const layoutsAreCompatible = (a: OpenableFormWithLayout, b: OpenableFormWithLayout) => {
        const aLayout = a._withLayout._withLayoutSubclass.layout,
            bLayout = b._withLayout._withLayoutSubclass.layout;
        console.log("Checking layout compatibility between", aLayout, "and", bLayout);
        if (aLayout.type !== bLayout.type) {
            return false;
        } else if (aLayout.type === "form" && bLayout.type === "form") {
            return bLayout.parsedFormSpec.packageQualifiedFormName === aLayout.parsedFormSpec.packageQualifiedFormName;
        } else if (aLayout.type === "builtin" && bLayout.type === "builtin") {
            return bLayout.name === aLayout.name;
        } else if (aLayout.type === "constructor" && bLayout.type === "constructor") {
            return bLayout.constructor === aLayout.constructor;
        }
        return false;
    };

    function assertOpenFormIsComponent(pyForm: pyObject): asserts pyForm is Component {
        if (!isComponent(pyForm)) {
            throw new pyTypeError(
                `Attempting to open a form which is not an anvil component, (got type ${pyForm?.tp$name})`
            );
        }
    }

    function openFormInstance(pyForm: pyObject): pyObject | Suspension {
        assertOpenFormIsComponent(pyForm);

        if (pyForm !== topLevelForms.openForm) {
            // it's ok to call open_form on the same form
            validateChild(pyForm, "open_form");
        }

        clearPlaceHolder();

        const fns: ((previous?: pyObject) => pyObject | Suspension)[] = [];
        const oldForm = topLevelForms.openForm;
        if (oldForm) {
            fns.push(() => notifyComponentUnmounted(oldForm, true));
            topLevelForms.openForm = null;
            fns.push(() => {
                if (topLevelForms.openForm !== null) {
                    warn(
                        "Warning: You are likely calling 'open_form()' from inside the hide event of the outgoing form (or from one of its components). This may not be what you want."
                    );
                }
                // Re-use layout instances
                if (
                    hasLayoutSubclass(pyForm) &&
                    !pyForm._withLayout.pyLayout &&
                    hasLayoutSubclass(oldForm) &&
                    layoutsAreCompatible(pyForm, oldForm)
                ) {
                    const newWithLayout = pyForm._withLayout;
                    const oldWithLayout = oldForm._withLayout;
                    // We can re-use this instance! Remove from the old form, clear its slots, reset its properties, clear its event bindings, and give it to the new form
                    const pyLayout = oldWithLayout.pyLayout! as LayoutComponent;
                    oldWithLayout.pyLayout = undefined;
                    const slots = pyLayout.tp$getattr<PySlots>(s_slots);

                    return chainOrSuspend(
                        null,
                        // Clear the layout's slots
                        ...slots.$items().map(([k, v]) => () => {
                            const clear = v.tp$getattr<pyCallable>(s_clear);
                            return pyCallOrSuspend(clear, []);
                        }),

                        // Set properties of the layout from the new form's kwargs, clearing any that were set by the old form.
                        ...(function* () {
                            const { kwargs } = newWithLayout;
                            const oldFormKwargs = kwsToObj(oldWithLayout.kwargs);
                            for (const [k, v] of iterKws(kwargs)) {
                                yield () => pySetAttr(pyLayout, new pyStr(k), v, true);
                                delete oldFormKwargs[k];
                            }
                            // Any remaining oldFormKwargs indicate properties that should be reset to their default value
                            for (const k of Object.keys(oldFormKwargs)) {
                                yield () =>
                                    pySetAttr(
                                        pyLayout,
                                        new pyStr(k),
                                        toPy(pyLayout.anvil$customPropsDefaults[k]),
                                        true
                                    );
                            }
                        })(),

                        // now that the properties have been set, refresh data bindings
                        () => pyLayout.tp$getattr(s_refresh_data_bindings, true),
                        (rdbMethod) => rdbMethod && pyCallOrSuspend(rdbMethod),

                        // Dissociate from the old form
                        () => oldWithLayout.onDissociate?.(pyLayout, oldForm) ?? pyNone,

                        // Associate with the new form
                        () => {
                            newWithLayout.pyLayout = pyLayout;
                            return newWithLayout.onAssociate?.(pyLayout, pyForm) ?? pyNone;
                        }
                    );
                }
                return pyNone;
            });
        }

        fns.push(() => chainOrSuspend(pyForm.anvil$hooks.setupDom(), () => pyNone));

        fns.push(() => {
            const domElement = pyForm.anvil$hooks.domElement;
            if (domElement == null) {
                throw new pyRuntimeError("Form DOM element was not created");
            }
            const appPlaceHolder = getAppPlaceHolder();
            appPlaceHolder.appendChild(domElement);
            topLevelForms.openForm = pyForm;
            return notifyComponentMounted(pyForm, true);
        });

        fns.push(() => {
            // For what ever reason, this imported at the top prevents the ide iframe from loading sometimes
            // TODO - figure out why and fix it
            // for leave it here for now
            // if you change this - try opening m3 in the designer, any component fails
            hooks.onOpenedForm?.();
            return pyNone;
        });

        fns.push(() => pyForm);

        return chainOrSuspend(null, ...fns);
    }

    let openFormCall = 0;
    const INFLIGHT_FORM_IMPORTS = new Map<string, pyObject | Suspension>();

    const openForm = funcFastCall(function (args, rawKwargs) {
        const [pyForm, ...formArgs] = args;
        const thisFormCall = ++openFormCall;

        if (pyForm === undefined) {
            throw new pyTypeError("anvil.open_form() requires an argument");
        }

        if (!(pyForm instanceof pyStr)) {
            return openFormInstance(pyForm);
        }

        const formName = pyForm.toString();

        return chainOrSuspend(
            pyTryFinally(
                () => {
                    const moduleDict: Record<string, pyObject> = {
                        __package__: new pyStr(window.anvilAppMainPackage),
                    };
                    // This prevents multiple imports of the same form
                    // If the module is slow to load, multiple inflight imports can result in false positive circular import errors
                    // This probably needs addressing in Skulpt
                    // but it's not obvious how to distinguish between a circular import (that suspends)
                    // and multiple imports of the same slow module resulting from user interaction, say a button click handler
                    if (INFLIGHT_FORM_IMPORTS.has(formName)) {
                        return INFLIGHT_FORM_IMPORTS.get(formName);
                    }
                    const rv = pyImport(formName, moduleDict, {}, [], -1);
                    INFLIGHT_FORM_IMPORTS.set(formName, rv);
                    return rv;
                },
                () => {
                    INFLIGHT_FORM_IMPORTS.delete(formName);
                }
            ),
            () => {
                const leafName = formName.split(".").pop()!;
                const modName = new pyStr(window.anvilAppMainPackage + "." + formName);
                let pyFormMod: pyModule;
                try {
                    pyFormMod = Sk.sysmodules.mp$subscript(modName);
                } catch {
                    pyFormMod = Sk.sysmodules.mp$subscript(pyForm);
                }

                const formConstructor = pyFormMod.$d[leafName];

                if (!formConstructor) {
                    throw new pyAttributeError(
                        '"' + formName + '" module does not contain a class called "' + leafName + '"'
                    );
                }

                return pyCallOrSuspend(formConstructor, formArgs, rawKwargs);
            },
            (pyForm: pyObject) => {
                if (thisFormCall !== openFormCall) {
                    // during instantiation of a form, another call to open_form() is made
                    // this either happened during the __init__ method of constructing the form
                    // or some external event like browser back/forward, or clicking a button
                    assertOpenFormIsComponent(pyForm);
                    return pyForm;
                } else {
                    return openFormInstance(pyForm);
                }
            }
        );
    });

    const getOpenForm = new pyFunc(function () {
        return topLevelForms.openForm || pyNone;
    });

    const isServerSide = new pyFunc(function () {
        return pyFalse;
    });

    return { openForm, getOpenForm, isServerSide };
}
