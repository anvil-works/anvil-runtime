"use strict";

var PyDefUtils = require("PyDefUtils");

module.exports = (pyModule) => {


    const inDesigner = window.anvilInDesigner;

    pyModule["HtmlPanel"] = pyModule["HtmlTemplate"] = PyDefUtils.mkComponentCls(pyModule, "HtmlTemplate", {
        base: pyModule["Container"],

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
                    components.forEach((c) => {
                        c.component._anvil.element.detach();
                    });
                    v = v.toString();
                    const m = v.match(/^@theme:(.*)$/);
                    if (m) {
                        v = pyModule["HtmlTemplate"].$_anvilThemeAssets[m[1]] || "";
                    }
                    try {
                        e.html(v);
                    } catch (exc) {
                        console.log("Probably irrelevant HTML/Javascript-parsing exception:", exc);
                    }

                    // Loading CSS can cause height changes
                    e.find("link").on("load", (e) => {
                        if (PyDefUtils.updateHeight) PyDefUtils.updateHeight();
                    });

                    s._anvil.scripts = Array.from(e.find("script")).map((script) => {
                        const textContent = script.textContent;
                        script.textContent = "";
                        const src = script.src;
                        if (src) script.removeAttribute("src");
                        // we will add the textConent and src in the pageEvents.add callback
                        // this is to prevent jquery append doing it for us!
                        return {script, textContent, src};
                    });
                    // we need to store these now and add them dom when the component is added to the dom

                    const slots = (s._anvil.slots = {});
                    const outer = s._anvil.elements.outer;
                    outer.querySelectorAll("[anvil-slot]").forEach((element) => {
                        element.classList.add("anvil-inline-container"); // is this right?
                        const slotName = element.getAttribute("anvil-slot");
                        slots[slotName] = slots[slotName] || { element, hide_if_empty: [], show_if_empty: [], components: [] };
                    });

                    outer.querySelectorAll("[anvil-slot-repeat]").forEach((element) => {
                        s._anvil.slots[element.getAttribute("anvil-slot-repeat")] = {
                            element,
                            hide_if_empty: [],
                            show_if_empty: [],
                            repeat: true,
                            components: [],
                        };
                    });

                    outer.querySelectorAll("[anvil-hide-if-slot-empty], [anvil-if-slot-empty]").forEach((elt) => {
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

                    components.forEach((c) => {
                        const component = c.component;
                        const removeFn = addComponentToDom(s, component, c.layoutProperties["slot"]);
                        if (component.parent) {
                            component.parent.removeFn = removeFn;
                        }
                    });
                },
            },
        }),

        events: PyDefUtils.assembleGroupEvents("HTML panel", /*!componentEvents(HtmlTemplate)!1*/ ["universal"]),

        element: (props) => <PyDefUtils.OuterElement className="html-templated-panel anvil-container anvil-always-inline-container" {...props} />,

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
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["Container"], (self) => {
                // Store this on self so we can call it from DesignHtmlPanel
                self._anvil.addComponentToDom = addComponentToDom;

                self._anvil.slots || (self._anvil.slots = {});
                self._anvil.scripts || (self._anvil.scripts = []);

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
                                jsR = PyDefUtils.remapToJsOrWrap(r);
                            } catch (e) {}

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
                    beforeAdd() {
                        let promise;
                        self._anvil.scripts.forEach(({script: oldScript, textContent, src}) => {
                            if (src) oldScript.src = src;
                            
                            const newScript = document.createElement("script");
                            newScript.textContent = textContent;
                            for (let attr of oldScript.attributes) {
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
                                promise.then(() => parentNode?.replaceChild(newScript, oldScript));
                            } else {
                                parentNode?.replaceChild(newScript, oldScript);
                            }
                            if (parentNode && oldScript.src && (oldScript.type || "").toLowerCase() !== "module" && !oldScript.async) {
                                const p = new Promise((resolve) => {
                                    newScript.onload = resolve;
                                    newScript.onerror = () => {
                                        Sk.builtin.print([new Sk.builtin.str(`Warning: failed to load script with src: ${oldScript.src}`)])
                                        console.error(`error loading ${oldScript.src}`);
                                        resolve();
                                    };
                                });
                                if (promise) {
                                    promise.then(() => p);
                                } else {
                                    promise = p;
                                }
                            }
                        });

                        self._anvil.scripts = [];
                        return promise && Sk.misceval.promiseToSuspension(promise);
                    }
                };

            });


            /*!defMethod(_,component,[slot="default"])!2*/ "Add a component to the named slot of this HTML templated panel. If no slot is specified, the 'default' slot will be used."
            $loc["add_component"] = new PyDefUtils.funcWithKwargs(function (kwargs, self, component) {
                pyModule["Container"]._check_no_parent(component);

                let removeFn;
                return Sk.misceval.chain(
                    undefined,
                    () => {
                        if (component._anvil.metadata.invisible) {
                            return;
                        }
                        removeFn = addComponentToDom(self, component, kwargs["slot"]);
                    },
                    () => Sk.misceval.callsimOrSuspend(pyModule["Container"].prototype.add_component, self, component, kwargs),
                    () => {
                        let rmFn = component._anvil.parent.remove;
                        component._anvil.parent.remove = () => {
                            if (removeFn) removeFn();
                            return rmFn();
                        };
                        return Sk.builtin.none.none$;
                    }
                );
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


    // Returns removeFn
    function addComponentToDom(self, pyComponent, slotName) {
        const celt = pyComponent._anvil.domNode;

        const delEmptyMarkers = (slot, has_components) => {
            slot.show_if_empty.forEach((elt) => {
                elt.classList.toggle("anvil-force-hidden", has_components);
            });
            slot.hide_if_empty.forEach((elt) => {
                elt.classList.toggle("anvil-force-hidden", !has_components);
            });
        };

        // Is there a spec for this slot
        const slot = self._anvil.slots[slotName];

        if (slot) {
            const slotElt = slot.element;
            if (!slot.components.length) {
                // we only need to do this if we are an empty slot
                delEmptyMarkers(slot, true);
            }
            slot.components.push(pyComponent);

            if (slot.repeat) {
                const s_copy = slotElt.cloneNode(true);
                s_copy.removeAttribute("anvil-slot-repeat");
                s_copy.setAttribute("anvil-slot-repeated", slotName);
                const dropZone = s_copy.querySelector("[anvil-slot]");
                if (dropZone) {
                    dropZone.appendChild(celt);
                    if (inDesigner) {
                        // the designer users this
                        $(dropZone).data("anvil-slot-repeat-parent", $(s_copy));
                    }
                } else {
                    s_copy.appendChild(celt);
                }
                slotElt.insertAdjacentElement("beforebegin", s_copy);
                return () => {
                    s_copy.remove();
                    slot.components = slot.components.filter((c) => c !== pyComponent);
                    if (!slot.components.length) {
                        delEmptyMarkers(slot, false);
                    }
                    return Sk.builtin.none.none$;
                };
            } else {
                slotElt.appendChild(celt);
                return () => {
                    slot.components = slot.components.filter((c) => c !== pyComponent);
                    if (!slot.components.length) {
                        delEmptyMarkers(slot, false);
                    }
                    return Sk.builtin.none.none$;
                };
            }
        }


        if (slotName === "default") {
            // fall-through to appending to ourselves!
            self._anvil.elements.outer.appendChild(celt);
        } else {
            return addComponentToDom(self, pyComponent, "default");
        }
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
      if (item.hasOwnProperty('remove')) {
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