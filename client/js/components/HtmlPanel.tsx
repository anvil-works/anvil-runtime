"use strict";

import {
    loadScripts as loadSanitizedScripts,
    SanitizedScript,
    sanitizeScripts,
    setInnerHTMLWithWrapping,
} from "@runtime/html-form/dom-utils";
import { getCssPrefix } from "@runtime/runner/legacy-features";
import {
    chainOrSuspend,
    promiseToSuspension,
    proxy,
    pyCall,
    pyCallable,
    pyCallOrSuspend,
    pyDict,
    pyException,
    pyFunc,
    pyMappingProxy,
    pyNone,
    pyObject,
    pyStr,
    remapToJsOrWrap,
    typeName,
} from "@Sk";
import PyDefUtils from "PyDefUtils";
import { addFormTemplateNamedDomNodeSource, FormTemplate } from "../runner/forms";
import { PyModMap, pyPropertyFromGetSet, reportError, s_add_component, s_clear } from "../runner/py-util";
import { Slot } from "../runner/python-objects";
import { ClassicComponentConstructor } from "./ClassicComponent";
import { ClassicContainer } from "./ClassicContainer";
import { Component } from "./Component";
import { indexInRange, validateChild } from "./Container";
import { isInvisibleComponent } from "./helpers";

interface HtmlSlot {
    element: Element;
    hide_if_empty: Element[];
    show_if_empty: Element[];
    repeat?: boolean;
    components: { component: Component; carrierElement: HTMLElement }[];
}

interface HtmlTemplateAnvil {
    elements: { root: HTMLDivElement };
    slots: Record<string, HtmlSlot>;
    scripts: SanitizedScript[];
    pyLayoutSlots: pyDict<pyObject, Slot>;
    namedDomNodes: Map<string, Element>;
    namedDomNodesProxy: pyMappingProxy;
    namedDomNodesOverwrite?: any;
    yamlHost: FormTemplate | null;
    addComponentToDom?: (...args: any[]) => any;
    childCleanupMap?: Map<any, { detachDom: () => void; setVisibility?: (v: boolean) => void }>;
}

interface HtmlTemplate extends ClassicContainer<HtmlTemplateAnvil> {}

const HtmlPanelFactory = (pyModule: PyModMap) => {
    const ClassicContainer = pyModule["ClassicContainer"] as ClassicComponentConstructor;

    const HtmlTemplate = PyDefUtils.mkComponentCls<HtmlTemplate>(pyModule, "HtmlTemplate", {
        base: ClassicContainer,

        properties: PyDefUtils.assembleGroupProperties<HtmlTemplate>(
            /*!componentProps(HtmlTemplate)!1*/ ["user data", "tooltip", "appearance"],
            {
                html: /*!componentProp(HtmlTemplate)!1*/ {
                    name: "html",
                    type: "html",
                    defaultValue: pyStr.$empty,
                    exampleValue: "<b>Hello</b>",
                    description: "The HTML from which this panel is defined",
                    pyVal: true,
                    important: true,
                    initialize: true,
                    set(s, e, pyV) {
                        const components = s._anvil.components;
                        const domNode = s._anvil.domNode;
                        let rv;

                        components.forEach(({ component }) => {
                            component.anvil$hooks.domElement!.remove();
                        });

                        let v = pyV.toString();
                        const m = v.match(/^@theme:(.*)$/);
                        if (m) {
                            v = pyModule["HtmlTemplate"].$_anvilThemeAssets[m[1]] || "";
                        }
                        try {
                            setInnerHTMLWithWrapping(domNode, v);
                        } catch (exc) {
                            console.log("Probably irrelevant HTML/Javascript-parsing exception:", exc);
                        }

                        // Optimize: Single DOM traversal instead of 7 separate querySelectorAll calls
                        const allSpecialElements = domNode.querySelectorAll(
                            "link, script, [anvil-name], [anvil-slot], [anvil-slot-repeat], " +
                                "[anvil-hide-if-slot-empty], [anvil-if-slot-empty]"
                        );

                        const namedElements: Element[] = [];
                        const scripts: HTMLScriptElement[] = [];
                        const slotElements: Element[] = [];
                        const slotRepeatElements: Element[] = [];
                        const hideIfEmptyElements: Element[] = [];
                        const showIfEmptyElements: Element[] = [];

                        // Categorize elements in a single pass
                        for (const el of allSpecialElements) {
                            const tagName = el.tagName;

                            // Loading CSS can cause height changes
                            if (tagName === "LINK") {
                                el.addEventListener("load", (e) => {
                                    PyDefUtils.updateHeight?.();
                                });
                            } else if (tagName === "SCRIPT") {
                                scripts.push(el as HTMLScriptElement);
                            }

                            if (el.hasAttribute("anvil-name")) {
                                namedElements.push(el);
                            }
                            if (el.hasAttribute("anvil-slot")) {
                                slotElements.push(el);
                            }
                            if (el.hasAttribute("anvil-slot-repeat")) {
                                slotRepeatElements.push(el);
                            }
                            if (el.hasAttribute("anvil-hide-if-slot-empty")) {
                                hideIfEmptyElements.push(el);
                            }
                            if (el.hasAttribute("anvil-if-slot-empty")) {
                                showIfEmptyElements.push(el);
                            }
                        }

                        s._anvil.scripts = sanitizeScripts(scripts);
                        if (s._anvil.onPage) {
                            rv = loadScripts(s);
                        }

                        const namedDomNodes = (s._anvil.namedDomNodes ??= new Map());
                        namedDomNodes.clear();
                        namedElements.forEach((elt) => {
                            const name = elt.getAttribute("anvil-name");
                            if (name) {
                                namedDomNodes.set(name, elt);
                            }
                            // TODO: should we support anvil:dom-node or anvil:on-dom here
                            // or just leave them, if you want to use them you need to migrate
                        });

                        const slots = (s._anvil.slots = {} as Record<string, HtmlSlot>);
                        slotElements.forEach((element) => {
                            element.classList.add("anvil-inline-container"); // is this right?
                            const slotName = element.getAttribute("anvil-slot");
                            if (slotName) {
                                slots[slotName] ??= {
                                    element,
                                    hide_if_empty: [],
                                    show_if_empty: [],
                                    components: [],
                                };
                            }
                        });

                        slotRepeatElements.forEach((element) => {
                            slots[element.getAttribute("anvil-slot-repeat")!] = {
                                element,
                                hide_if_empty: [],
                                show_if_empty: [],
                                repeat: true,
                                components: [],
                            };
                        });

                        hideIfEmptyElements.forEach((elt) => {
                            const slot = slots[elt.getAttribute("anvil-hide-if-slot-empty")!];
                            if (slot) {
                                slot.hide_if_empty.push(elt);
                                elt.classList.add("anvil-force-hidden");
                            }
                        });

                        showIfEmptyElements.forEach((elt) => {
                            const slot = slots[elt.getAttribute("anvil-if-slot-empty")!];
                            if (slot) {
                                slot.show_if_empty.push(elt);
                            }
                        });

                        const savedSlotComponents = new Map<string, { components: Component[]; pySlot: Slot }>();

                        // 1. Remove all components currently in pyLayoutSlots
                        for (const [pyName, pySlot] of s._anvil.pyLayoutSlots?.$items() || []) {
                            const savedComponents = [...pySlot._slotState.components];
                            const clear = pySlot.tp$getattr<pyCallable>(s_clear);
                            pyCall(clear); // TODO suspend.
                            savedSlotComponents.set(pyName.toString(), {
                                components: savedComponents,
                                pySlot,
                            });
                        }

                        // 2. Nuke pyLayoutSlots
                        s._anvil.pyLayoutSlots = new pyDict();

                        // Add all the non-slot components to the dom
                        components.forEach((c) => {
                            const component = c.component;
                            addComponentToDomWithStableCleanup(s, component, c.layoutProperties["slot"]);
                        });

                        // 3. Rebuild pyLayoutSlots
                        const slotsSoFar = [];
                        for (const [name, htmlSlot] of Object.entries(s._anvil.slots)) {
                            const oldSlot = savedSlotComponents.get(name);
                            const slot =
                                oldSlot?.pySlot ||
                                new Slot(
                                    () => s,
                                    0,
                                    { slot: name },
                                    false, // TODO: Infer oneComponent from HTML slot attributes
                                    undefined // TODO: Infer templates from HTML slot
                                );

                            // The following lines of code need, more than any other lines of code, to be in this order.

                            s._anvil.pyLayoutSlots.mp$ass_subscript(new pyStr(name), slot);
                            slot._slotState.earlierSlots = [...slotsSoFar];
                            slotsSoFar.push(slot);

                            const addComponent = slot.tp$getattr<pyCallable>(s_add_component);
                            for (const component of oldSlot?.components || []) {
                                pyCall(addComponent, [component]);
                            }
                        }
                        return rv;
                    },
                },
            }
        ),

        events: PyDefUtils.assembleGroupEvents("HTML panel", /*!componentEvents(HtmlTemplate)!1*/ ["universal"]),

        element: (props) => (
            <PyDefUtils.OuterElement
                className={`${getCssPrefix()}html-templated-panel anvil-container anvil-always-inline-container`}
                {...props}
            />
        ),

        layouts: [
            {
                name: "slot",
                type: "string",
                description: "The name of the template slot where this component will be placed",
                defaultValue: "",
                important: true,
                priority: 0,
            },
        ],

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew<HtmlTemplate>(ClassicContainer, (self) => {
                // Store this on self so we can call it from DesignHtmlPanel
                self._anvil.addComponentToDom = addComponentToDomWithStableCleanup;

                self._anvil.slots ||= {};
                self._anvil.scripts ||= [];

                self._anvil.pyLayoutSlots ||= new pyDict();

                self._anvil.namedDomNodes ??= new Map();
                self._anvil.namedDomNodesProxy = new pyMappingProxy(proxy(self._anvil.namedDomNodes));
                self._anvil.namedDomNodesOverwrite = undefined; // the '.dom_nodes' property was introduced in 2023, so we need to make sure it's overwritable
                self._anvil.yamlHost = null;

                self._anvil.element.on(
                    "_anvil-call",
                    (e, resolve: (value: any) => void, reject: (reason?: any) => void, fn: string, ...args: any[]) => {
                        const err = (msg: string) => {
                            const ex = new pyException(msg);
                            ex.traceback = [{ filename: "<template>", lineno: "<unknown>" }];
                            reportError(ex);
                            reject(msg);
                        };

                        e.stopPropagation();

                        const pyFn = self.tp$getattr(new pyStr(fn));
                        if (pyFn === undefined) {
                            err(
                                "Attempted to call non-existent method from Javascript: <" +
                                    typeName(self) +
                                    " object> has no attribute '" +
                                    fn +
                                    "'."
                            );
                            return;
                        }

                        const pyArgs = new Array(args.length);
                        for (let i = 0; i < args.length; i++) {
                            try {
                                pyArgs[i] = PyDefUtils.unwrapOrRemapToPy(args[i]);
                            } catch (e) {
                                err(
                                    "Could not convert argument " +
                                        i +
                                        " (type '" +
                                        typeof args[i] +
                                        "') to Python when calling '" +
                                        fn +
                                        "' from JavaScript."
                                );
                                return;
                            }
                        }

                        PyDefUtils.callAsync
                            .apply(null, [pyFn, undefined, undefined, undefined, ...pyArgs])
                            .then((r) => {
                                let jsR = undefined;
                                try {
                                    jsR = remapToJsOrWrap(r);
                                } catch (e) {
                                    // ignore - throw below
                                }

                                if (jsR === undefined) {
                                    err(
                                        "Could not convert return value from function '" +
                                            fn +
                                            "' to JavaScript. Return value was of type '" +
                                            r.tp$name +
                                            "'"
                                    );
                                    return;
                                }

                                resolve(jsR);
                            })
                            .catch((e) => {
                                reject(e);
                            });
                    }
                );

                self._anvil.pageEvents = {
                    add() {
                        return loadScripts(self);
                    },
                };
            });

            $loc["slots"] = pyPropertyFromGetSet((self) => self._anvil.pyLayoutSlots);

            /*!defAttr()!1*/ ({
                name: "dom_nodes",
                type: "dict",
                description:
                    "A read-only dictionary allowing you to look up the DOM node by name for any HTML tag in this component's HTML that has an anvil-name= attribute.",
            });
            $loc["dom_nodes"] = pyPropertyFromGetSet(
                (self) => self._anvil.namedDomNodesOverwrite ?? self._anvil.namedDomNodesProxy,
                (self, value) => {
                    self._anvil.namedDomNodesOverwrite = value;
                }
            );

            // @ts-expect-error - this is a method on the component
            $loc["anvilComponent$registerWithForm"] = function (pyForm: FormTemplate) {
                const self = this;
                if (self._anvil.yamlHost) {
                    return;
                }
                self._anvil.yamlHost = pyForm;
                addFormTemplateNamedDomNodeSource(pyForm, (self._anvil.namedDomNodes ??= new Map()));
            };

            /*!defMethod(_,component,[slot="default"])!2*/ ("Add a component to the named slot of this HTML templated panel. If no slot is specified, the 'default' slot will be used.");
            $loc["add_component"] = PyDefUtils.funcWithKwargs(function (
                kwargs: any,
                self: HtmlTemplate,
                component: Component
            ) {
                validateChild(component);

                return chainOrSuspend(component.anvil$hooks.setupDom(), () => {
                    if (isInvisibleComponent(component)) {
                        return pyModule["ClassicContainer"]._doAddComponent(self, component);
                    }
                    const callbacks = addComponentToDomWithStableCleanup(
                        self,
                        component,
                        kwargs["slot"],
                        kwargs["index"]
                    );

                    return pyModule["ClassicContainer"]._doAddComponent(self, component, kwargs, callbacks);
                });
            });

            const removeFromParentStr = new pyStr("remove_from_parent");
            /*!defMethod(_,[slot="default"])!2*/ ("clear the HTML template of all components or clear a specific slot of components.");
            $loc["clear"] = PyDefUtils.funcWithKwargs(function (kwargs: any, self: HtmlTemplate) {
                const components = self._anvil.components.slice(0);
                const slot = kwargs["slot"];
                const fns = [];
                components.forEach((c) => {
                    if (!slot || c.layoutProperties["slot"] === slot) {
                        fns.push(() => pyCallOrSuspend(c.component.tp$getattr<pyCallable>(removeFromParentStr)));
                    }
                });
                fns.push(() => pyNone);
                return chainOrSuspend(undefined, ...fns);
            });

            /*!defMethod(_,js_function_name,*args)!2*/ ("Call a Javascript function");
            $loc["call_js"] = new pyFunc(PyDefUtils.callJs);
        },
    });

    pyModule["HtmlPanel"] = pyModule["HtmlTemplate"] = HtmlTemplate;

    pyModule["HtmlTemplate"].$_anvilThemeAssets = {};

    // keep a stable reference to the cleanup functions
    function addComponentToDomWithStableCleanup(
        self: HtmlTemplate,
        pyComponent: Component,
        slotName: string,
        ...args: any[]
    ): { detachDom: () => void; setVisibility?: (v: boolean) => void } {
        const cleanupMap = (self._anvil.childCleanupMap ??= new Map());
        const { detachDom, setVisibility } = _addComponentToDom(self, pyComponent, slotName, ...args);
        cleanupMap.set(pyComponent, { detachDom, setVisibility });
        return {
            detachDom() {
                cleanupMap.get(pyComponent)?.detachDom();
                cleanupMap.delete(pyComponent);
            },
            setVisibility(v) {
                return cleanupMap.get(pyComponent)?.setVisibility?.(v);
            },
        };
    }

    /**
     * @returns {{detachDom: () => void, setVisibility?: (v: boolean) => void}}
     */
    function _addComponentToDom(
        self: HtmlTemplate,
        pyComponent: Component,
        slotName: string,
        index?: number | null
    ): { detachDom: () => void; setVisibility?: (v: boolean) => void } {
        const celt = pyComponent.anvil$hooks.domElement!;
        const isDropzone = celt.hasAttribute("anvil-dropzone");

        const delEmptyMarkers = (slot: HtmlSlot, has_components: boolean) => {
            slot.show_if_empty.forEach((elt) => {
                elt.classList.toggle("anvil-force-hidden", has_components);
            });
            slot.hide_if_empty.forEach((elt) => {
                elt.classList.toggle("anvil-force-hidden", !has_components);
            });
        };

        index = indexInRange(index, self);

        // Unless index is undefined, we're inserting before a particular component in this slot.
        // We want to identify this component, find its container component, and insert before it.

        let insertingBeforeComponentInSlot: Component | undefined;
        if (index != null) {
            // Find the next component after `index` that's in this slot
            for (let i = index; i < self._anvil.components.length; i++) {
                const sn = self._anvil.components[i].layoutProperties?.slot ?? "default";
                if (sn === slotName) {
                    insertingBeforeComponentInSlot = self._anvil.components[i].component;
                    break;
                }
            }
        }

        // We want to know
        // * Which component we're inserting be
        // * The insertion index

        // Is there a spec for this slot
        const slot = self._anvil.slots[slotName];

        if (slot) {
            const slotElt = slot.element;
            if (!slot.components.length && !isDropzone) {
                // we only need to do this if we are an empty slot
                delEmptyMarkers(slot, true);
            }

            // If we're inserting before a component in this slot, identify it and grab its largest per-component element
            const idxInSlot = slot.components.findIndex(
                ({ component }) => component === insertingBeforeComponentInSlot
            );
            const insertingBeforeElement = idxInSlot !== -1 && slot.components[idxInSlot].carrierElement;

            let detachDom, setVisibility;

            const slotRecord = { component: pyComponent, carrierElement: pyComponent.anvil$hooks.domElement! };
            if (idxInSlot === -1) {
                slot.components.push(slotRecord);
            } else {
                slot.components.splice(idxInSlot, 0, slotRecord);
            }

            if (slot.repeat) {
                const s_copy = (slotRecord.carrierElement = slotElt.cloneNode(true) as HTMLElement);
                s_copy.removeAttribute("anvil-slot-repeat");
                s_copy.setAttribute("anvil-slot-repeated", slotName);
                const dropZone = s_copy.querySelector("[anvil-slot],[anvil-component-here]");
                if (dropZone) {
                    dropZone.appendChild(celt);
                    if (ANVIL_IN_DESIGNER) {
                        // the designer users this
                        $(dropZone).data("anvil-slot-repeat-parent", $(s_copy));
                    }
                } else {
                    s_copy.appendChild(celt);
                }
                (insertingBeforeElement || slotElt).insertAdjacentElement("beforebegin", s_copy);
                detachDom = () => {
                    s_copy.remove();
                    slot.components = slot.components.filter((c) => c.component !== pyComponent);
                    if (!slot.components.length) {
                        delEmptyMarkers(slot, false);
                    }
                    return pyNone;
                };
                let visibleDisplayState = s_copy.style.display;
                setVisibility = (v: boolean) => {
                    if (ANVIL_IN_DESIGNER) {
                        s_copy.classList.toggle(getCssPrefix() + "visible-false", !v);
                    } else {
                        s_copy.style.display = v ? visibleDisplayState : "none";
                    }
                };
            } else {
                if (insertingBeforeElement) {
                    insertingBeforeElement.insertAdjacentElement("beforebegin", celt);
                } else {
                    slotElt.appendChild(celt);
                }
                detachDom = () => {
                    celt.remove();
                    slot.components = slot.components.filter((c) => c.component !== pyComponent);
                    if (!slot.components.length) {
                        delEmptyMarkers(slot, false);
                    }
                    return pyNone;
                };
            }
            return { detachDom, setVisibility };
        }

        // We don't have an explicit slot of that name. Fall back to the default slot.
        // If we are already trying to insert into "default" and there *still* isn't a slot
        // of that name, we manually add component elements to the end of our DOM node - in the correct order.

        if (slotName === "default") {
            // fall-through to appending to ourselves!
            if (insertingBeforeComponentInSlot) {
                insertingBeforeComponentInSlot.anvil$hooks.domElement!.insertAdjacentElement("beforebegin", celt);
            } else {
                self._anvil.elements.root.appendChild(celt);
            }
            return { detachDom: () => celt.remove() };
        } else {
            return _addComponentToDom(self, pyComponent, "default", index);
        }
    }

    function loadScripts(self: HtmlTemplate) {
        const scripts = self._anvil.scripts ?? [];
        self._anvil.scripts = [];

        const promise = loadSanitizedScripts(scripts);

        return promise && promiseToSuspension(promise);
    }
};

export default HtmlPanelFactory;

/*!defClass(anvil,HtmlTemplate,Container)!*/

/*
 * TO TEST:
 *
 *  - New props: html
 *  - Methods: add_component
 *  - Child layout props: slot
 *
 */
