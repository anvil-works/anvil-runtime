"use strict";

import { getCssPrefix } from "@runtime/runner/legacy-features";
import { warn } from "@runtime/runner/warnings";
import { pyCall, pyDict, pyMappingProxy, pyStr, remapToJsOrWrap, toPy } from "@Sk";
import { pyPropertyFromGetSet, s_add_component, s_clear } from "../runner/py-util";
import { Slot } from "../runner/python-objects";
import { validateChild } from "./Container";
import { isInvisibleComponent } from "./helpers";

var PyDefUtils = require("PyDefUtils");

module.exports = (pyModule) => {



    pyModule["HtmlPanel"] = pyModule["HtmlTemplate"] = PyDefUtils.mkComponentCls(pyModule, "HtmlTemplate", {
        base: pyModule["ClassicContainer"],

        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(HtmlTemplate)!1*/ ["user data", "tooltip", "appearance"], {
            html: /*!componentProp(HtmlTemplate)!1*/{
                name: "html",
                type: "html",
                defaultValue: Sk.builtin.str.$empty,
                exampleValue: "<b>Hello</b>",
                description: "The HTML from which this panel is defined",
                pyVal: true,
                important: true,
                initialize: true,
                set(s, e, v) {
                    const components = s._anvil.components;
                    const domNode = s.anvil$hooks.domElement;
                    let rv;

                    components.forEach(({component}) => {
                        component.anvil$hooks.domElement.remove();
                    });

                    v = v.toString();
                    const m = v.match(/^@theme:(.*)$/);
                    if (m) {
                        v = pyModule["HtmlTemplate"].$_anvilThemeAssets[m[1]] || "";
                    }
                    try {
                        setInnerHTML(domNode, v);
                    } catch (exc) {
                        console.log("Probably irrelevant HTML/Javascript-parsing exception:", exc);
                    }

                    // Loading CSS can cause height changes
                    for (const link of domNode.querySelectorAll("link")) {
                        link.addEventListener("load", (e) => {
                            PyDefUtils.updateHeight?.();
                        });
                    }

                    s._anvil.scripts = Array.from(domNode.querySelectorAll("script")).map((script) => {
                        const textContent = script.textContent;
                        script.textContent = "";
                        const src = script.src;
                        if (src) script.removeAttribute("src");
                        // we will add the textConent and src in the pageEvents.add callback
                        // this is to prevent jquery append doing it for us!
                        const isAsync = script.getAttribute("async") != null;
                        // because firefox sets the async property to true for dynamically created scripts
                        // div.innerHtml = "<script src='..'></script>" in firefox async is true, chrome it's false
                        // https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script#compatibility_notes
                        return { script, textContent, src, isAsync };
                    });
                    // we need to store these now and add them dom when the component is added to the dom
                    // unless we're already on the page
                    if (s._anvil.onPage) {
                        rv = loadScripts(s);
                    }

                    s._anvil.pyElements = new pyMappingProxy(
                        new pyDict(
                            [].concat(
                                ...Array.from(domNode.querySelectorAll("[anvil-name]")).map((elt) => [
                                    new pyStr(elt.getAttribute("anvil-name")),
                                    toPy(elt),
                                ])
                            )
                        )
                    );

                    const slots = (s._anvil.slots = {});
                    domNode.querySelectorAll("[anvil-slot]").forEach((element) => {
                        element.classList.add("anvil-inline-container"); // is this right?
                        const slotName = element.getAttribute("anvil-slot");
                        if (slotName) {
                            slots[slotName] = slots[slotName] || {
                                element,
                                hide_if_empty: [],
                                show_if_empty: [],
                                components: []
                            };
                        }
                    });

                    domNode.querySelectorAll("[anvil-slot-repeat]").forEach((element) => {
                        s._anvil.slots[element.getAttribute("anvil-slot-repeat")] = {
                            element,
                            hide_if_empty: [],
                            show_if_empty: [],
                            repeat: true,
                            components: [],
                        };
                    });

                    domNode.querySelectorAll("[anvil-hide-if-slot-empty], [anvil-if-slot-empty]").forEach((elt) => {
                        let slot = slots[elt.getAttribute("anvil-hide-if-slot-empty")];
                        if (slot) {
                            slot.hide_if_empty.push(elt);
                            elt.classList.add("anvil-force-hidden");
                        }
                        slot = slots[elt.getAttribute("anvil-if-slot-empty")];
                        if (slot) {
                            slot.show_if_empty.push(elt);
                        }
                    });

                    const savedSlotComponents = new Map/*<string,{components: Component[], pySlot: Slot}>*/();

                    // 1. Remove all components currently in pyLayoutSlots
                    for (const [pyName, pySlot] of s._anvil.pyLayoutSlots?.$items() || []) {
                        const savedComponents = [...pySlot._slotState.components];
                        const clear = pySlot.tp$getattr(s_clear);
                        Sk.misceval.callsimArray(clear); // TODO suspend.
                        savedSlotComponents.set(pyName.toString(), {
                            components: savedComponents,
                            pySlot,
                        });
                    }

                    // 2. Nuke pyLayoutSlots
                    s._anvil.pyLayoutSlots = new Sk.builtin.dict();

                    // Add all the non-slot components to the dom
                    components.forEach((c) => {
                        const component = c.component;
                        addComponentToDomWithStableCleanup(s, component, c.layoutProperties["slot"]);
                    });

                    // 3. Rebuild pyLayoutSlots
                    const slotsSoFar = [];
                    for (const [name, htmlSlot] of Object.entries(s._anvil.slots)) {
                        const oldSlot = savedSlotComponents.get(name);
                        const slot = oldSlot?.pySlot || new Slot(
                            () => s,
                            0,
                            {slot: name},
                            false, // TODO: Infer oneComponent from HTML slot attributes
                            undefined, // TODO: Infer templates from HTML slot
                        );

                        // The following lines of code need, more than any other lines of code, to be in this order.

                        s._anvil.pyLayoutSlots.mp$ass_subscript(new pyStr(name), slot);
                        slot._slotState.earlierSlots = [...slotsSoFar];
                        slotsSoFar.push(slot);

                        const addComponent = slot.tp$getattr(s_add_component);
                        for (const component of oldSlot?.components || []) {
                            pyCall(addComponent, [component]);
                        }
                    }
                    return rv;
                },
            },
        }),

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
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["ClassicContainer"], (self) => {
                // Store this on self so we can call it from DesignHtmlPanel
                self._anvil.addComponentToDom = addComponentToDomWithStableCleanup;

                self._anvil.slots ||= {};
                self._anvil.scripts ||= [];

                self._anvil.pyLayoutSlots ||= new Sk.builtin.dict();

                self._anvil.pyElements ||= new Sk.builtin.dict();
                self._anvil.pyElementsOverwrite = undefined; // the '.element' property was introduced in 2023, so we need to make sure it's overwritable

                self._anvil.element.on("_anvil-call", (e, resolve, reject, fn, ...args) => {
                    const err = (msg) => {
                        const ex = new Sk.builtin.Exception(msg);
                        ex.traceback = [{ filename: "<template>", lineno: "<unknown>" }];
                        window.onerror(null, null, null, null, ex);
                        reject(msg);
                    };

                    e.stopPropagation();

                    const pyFn = self.tp$getattr(new Sk.builtin.str(fn));
                    if (pyFn === undefined) {
                        err("Attempted to call non-existent method from Javascript: <" + Sk.abstr.typeName(self) + " object> has no attribute '" + fn + "'.");
                        return;
                    }

                    const pyArgs = new Array(args.length);
                    for (let i = 0; i < args.length; i++) {
                        try {
                            pyArgs[i] = PyDefUtils.unwrapOrRemapToPy(args[i]);
                        } catch (e) {
                            err("Could not convert argument " + i + " (type '" + typeof args[i] + "') to Python when calling '" + fn + "' from JavaScript.");
                            return;
                        }
                    }

                    PyDefUtils.callAsync
                        .apply(null, [pyFn, undefined, undefined, undefined].concat(pyArgs))
                        .then((r) => {
                            let jsR = undefined;
                            try {
                                jsR = remapToJsOrWrap(r);
                            } catch (e) {
                                // ignore - throw below
                            }

                            if (jsR === undefined) {
                                err("Could not convert return value from function '" + fn + "' to JavaScript. Return value was of type '" + r.tp$name + "'");
                                return;
                            }

                            resolve(jsR);
                        })
                        .catch((e) => {
                            reject(e);
                        });
                });


                self._anvil.pageEvents = {
                    add() {
                        return loadScripts(self);
                    }
                };

            });

            $loc["slots"] = pyPropertyFromGetSet((self) => self._anvil.pyLayoutSlots);

            /*!defAttr()!1*/ ({name: "dom_nodes", type: "dict", description: "A read-only dictionary allowing you to look up the DOM node by name for any HTML tag in this component's HTML that has an anvil-name= attribute."});
            $loc["dom_nodes"] = pyPropertyFromGetSet(
                (self) => self._anvil.pyElementsOverwrite ?? self._anvil.pyElements,
                (self, value) => {
                    self._anvil.pyElementsOverwrite = value;
                }
            );

            /*!defMethod(_,component,[slot="default"])!2*/ "Add a component to the named slot of this HTML templated panel. If no slot is specified, the 'default' slot will be used."
            $loc["add_component"] = new PyDefUtils.funcWithKwargs(function (kwargs, self, component) {
                validateChild(component);

                return Sk.misceval.chain(
                    component.anvil$hooks.setupDom(),
                    () => {
                        if (isInvisibleComponent(component)) {
                            return pyModule["ClassicContainer"]._doAddComponent(self, component);
                        }
                        const callbacks = addComponentToDomWithStableCleanup(self, component, kwargs["slot"], kwargs["index"]);

                        return pyModule["ClassicContainer"]._doAddComponent(self, component, kwargs, callbacks);
                    });
            });

            const removeFromParentStr = new Sk.builtin.str("remove_from_parent");
            /*!defMethod(_,[slot="default"])!2*/ "clear the HTML template of all components or clear a specific slot of components."
            $loc["clear"] = new PyDefUtils.funcWithKwargs(function (kwargs, self) {
                const components = self._anvil.components.slice(0);
                const slot = kwargs["slot"];
                const fns = [];
                components.forEach((c) => {
                    if (!slot || c.layoutProperties["slot"] === slot) {
                        fns.push(() => PyDefUtils.pyCallOrSuspend(c.component.tp$getattr(removeFromParentStr)));
                    }
                });
                fns.push(() => Sk.builtin.none.none$);
                return Sk.misceval.chain(undefined, ...fns);
            });

            /*!defMethod(_,js_function_name,*args)!2*/ "Call a Javascript function"
            $loc["call_js"] = new Sk.builtin.func(PyDefUtils.callJs);
        },

    });

    pyModule["HtmlTemplate"].$_anvilThemeAssets = {};



    // keep a stable reference to the cleanup functions
    function addComponentToDomWithStableCleanup(self, pyComponent, ...args) {
        const cleanupMap = (self._anvil.childCleanupMap ??= new Map());
        const { detachDom, setVisibility } = _addComponentToDom(self, pyComponent, ...args);
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
    function _addComponentToDom(self, pyComponent, slotName, index) {

        const celt = pyComponent.anvil$hooks.domElement;
        const isDropzone = celt.hasAttribute("anvil-dropzone");

        const delEmptyMarkers = (slot, has_components) => {
            slot.show_if_empty.forEach((elt) => {
                elt.classList.toggle("anvil-force-hidden", has_components);
            });
            slot.hide_if_empty.forEach((elt) => {
                elt.classList.toggle("anvil-force-hidden", !has_components);
            });
        };

        // Unless index is undefined, we're inserting before a particular component in this slot.
        // We want to identify this component, find its container component, and insert before it.

        let insertingBeforeComponentInSlot;
        if (index !== undefined) {
            // Find the next component after `index` that's in this slot
            for (let i=index; i < self._anvil.components.length; i++) {
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
            const idxInSlot = slot.components.findIndex(({component}) => component === insertingBeforeComponentInSlot);
            const insertingBeforeElement = idxInSlot !== -1 && slot.components[idxInSlot].carrierElement;

            let detachDom, setVisibility;

            const slotRecord = {component: pyComponent, carrierElement: pyComponent.anvil$hooks.domElement};
            if (idxInSlot === -1) {
                slot.components.push(slotRecord);
            } else {
                slot.components.splice(idxInSlot, 0, slotRecord);
            }

            if (slot.repeat) {
                const s_copy = slotRecord.carrierElement = slotElt.cloneNode(true);
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
                    return Sk.builtin.none.none$;
                };
                let visibleDisplayState = s_copy.style.display;
                setVisibility = (v) => {
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
                    return Sk.builtin.none.none$;
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
                insertingBeforeComponentInSlot.anvil$hooks.domElement.insertAdjacentElement("beforebegin", celt);
            } else {
                self._anvil.elements.outer.appendChild(celt);
            }
            return { detachDom: () => celt.remove() };
        } else {
            return _addComponentToDom(self, pyComponent, "default", index);
        }
    }

    const wrapMap = {

        // Table parts need to be wrapped with `<table>` or they're
        // stripped to their contents when put in a div.
        // XHTML parsers do not magically insert elements in the
        // same way that tag soup parsers do, so we cannot shorten
        // this by omitting <tbody> or other required elements.
        thead: [ "table" ],
        col: [ "colgroup", "table" ],
        tr: [ "tbody", "table" ],
        td: [ "tr", "tbody", "table" ]
    };
    
    wrapMap.tbody = wrapMap.tfoot = wrapMap.colgroup = wrapMap.caption = wrapMap.thead;
    wrapMap.th = wrapMap.td;

    const rTagName = /<([a-z][^/\0>\x20\t\r\n\f]*)/i;

    function setInnerHTML(domNode, htmlString) {
        // Wrap map to handle special cases
        domNode.innerHTML = "";

        const tagName = rTagName.exec(htmlString)?.[1].toLowerCase();

        if (!tagName) {
            return (domNode.innerHTML = htmlString);
        }
        const wrap = wrapMap[tagName];
        if (!wrap) {
            return (domNode.innerHTML = htmlString);
        }
        let tmp = document.createElement("div");
        let j = wrap.length;
        while (--j > -1) {
            tmp = tmp.appendChild(document.createElement(wrap[j]));
        }
        tmp.innerHTML = htmlString;
        domNode.append(...tmp.childNodes);
    }


    function loadScripts(self) {
        let promise;
        const scripts = self._anvil.scripts;
        self._anvil.scripts = [];

        scripts.forEach(({script: oldScript, textContent, src, isAsync}) => {
            if (src) oldScript.src = src;
            
            const newScript = document.createElement("script");
            newScript.async = isAsync;
            newScript.textContent = textContent;
            for (const attr of oldScript.attributes) {
                newScript.setAttribute(attr.name, attr.value);
            }
            // this is a varaition on what jQuery does 
            // it means that functions exist in the window name space when we add them to the dom
            // just adding the component to the dom isn't enough
            // since the script tags were initially added via the jquery html mechanism
            const parentNode = oldScript.isConnected ? oldScript.parentNode : null;
            // The parentNode might be null if the html was replaced before being added to the screen
            // This might happen if anvil.js was used and the innerHTML was changed via dom manipulation
            // if there is no parentNode or domNode.isConnected === false
            // then we shouldn't add the scripts to the dom. (polyfill for isConnected below)
            if (promise) {
                promise = promise.then(() => parentNode?.replaceChild(newScript, oldScript));
            } else {
                parentNode?.replaceChild(newScript, oldScript);
            }
            if (parentNode && src && (oldScript.type || "").toLowerCase() !== "module" && !isAsync) {
                const p = new Promise((resolve) => {
                    newScript.onload = resolve;
                    newScript.onerror = () => {
                        warn(`Warning: failed to load script with src: ${oldScript.src}`);
                        console.error(`error loading ${oldScript.src}`);
                        resolve();
                    };
                });
                promise = promise ? promise.then(() => p) : p;
            }
        });

        
        return promise && Sk.misceval.promiseToSuspension(promise);
    }

};

/*!defClass(anvil,HtmlTemplate,Container)!*/

/*
 * TO TEST:
 *
 *  - New props: html
 *  - Methods: add_component
 *  - Child layout props: slot
 *
 */

// It doesn't look like isConnected get's polyfilled so do it here
// this is the official polyfill from MDN - remove this when we stop supporting IE
if (!("isConnected" in Node.prototype)) {
    Object.defineProperty(Node.prototype, "isConnected", {
        get() {
            return !this.ownerDocument || !(this.ownerDocument.compareDocumentPosition(this) & this.DOCUMENT_POSITION_DISCONNECTED);
        },
    });
}

// It doesn't look like remove() get's polyfilled so do it here - https://anvil.works/forum/t/detect-internet-explorer/9675
// this is the official polyfill from MDN - remove this when we stop supporting IE
(function (arr) {
    arr.forEach(function (item) {
      if (Object.prototype.hasOwnProperty.call(item, 'remove')) {
        return;
      }
      Object.defineProperty(item, 'remove', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: function remove() {
          this.parentNode && this.parentNode.removeChild(this);
        }
      });
    });
  })([Element.prototype, CharacterData.prototype, DocumentType.prototype].filter(Boolean));