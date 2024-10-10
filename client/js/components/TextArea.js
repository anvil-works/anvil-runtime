"use strict";

const { getCssPrefix } = require("@runtime/runner/legacy-features");
var PyDefUtils = require("PyDefUtils");

/*#
id: textarea
docs_url: /docs/client/components/basic#textarea
title: TextArea
tooltip: Learn more about TextArea
description: |
  ```python
  c = TextArea(text="Some editable text\nacross multiple lines")
  ```

  Text areas are text boxes that can contain multiple lines of text

  ![Screenshot](img/screenshots/textarea.png)

  Set a TextArea to have focus by calling its `focus()` method. Select all its text with the `select()` method.

  The `text` property of a TextArea can trigger write-back of data bindings. This occurs before the `lost_focus` event.
*/

module.exports = (pyModule) => {
    const { isTrue } = Sk.misceval;

    pyModule["TextArea"] = PyDefUtils.mkComponentCls(pyModule, "TextArea", {
        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(TextArea)!2*/ ["layout", "layout_margin", "height", "text", "interaction", "appearance", "tooltip", "user data"], {
            text: {
                dataBindingProp: true,
                get(s, e) {
                    return new Sk.builtin.str(s._anvil.lastChangeVal);
                },
                set(s, e, v) {
                    const domNode = s._anvil.domNode;
                    v = Sk.builtin.checkNone(v) ? "" : v.toString();
                    s._anvil.lastChangeVal = v;

                    domNode.value = v;
                    if (s._anvil.taAutoExpand) {
                        setHeightToContent(s, domNode);
                    }
                },
                allowBindingWriteback: true,
                multiline: true,
                suggested: true,
                inlineEditElement: 'outer',
                group: undefined,
            },
            height: {
                set(s, e, v) {
                    v = v.toString();
                    s._anvil.taHeight = v;
                    const domNode = s._anvil.domNode;
                    if (s._anvil.taAutoExpand) {
                        setHeightToContent(s, domNode);
                    } else {
                        domNode.style.height = PyDefUtils.cssLength(v);
                    }
                },
            },
            placeholder: /*!componentProp(TextArea)!1*/ {
                name: "placeholder",
                type: "string",
                description: "The text to be displayed when the component is empty.",
                defaultValue: Sk.builtin.str.$empty,
                pyVal: true,
                exampleValue: "Enter text here",
                set(self, e, v) {
                    e.attr("placeholder", Sk.builtin.checkNone(v) ? "" : v.toString());
                },
                group: undefined,
            },
            auto_expand: /*!componentProp(TextArea)!1*/ {
                name: "auto_expand",
                type: "boolean",
                description: "If true, the text area will expand vertically to fit its contents",
                defaultValue: Sk.builtin.bool.false$,
                pyVal: true,
                set(self, e, v) {
                    self._anvil.taAutoExpand = isTrue(v) && !ANVIL_IN_DESIGNER;
                    const domNode = self._anvil.domNode;
                    if (self._anvil.taAutoExpand) {
                        setHeightToContent(self, domNode);
                    } else {
                        domNode.style.height = PyDefUtils.cssLength(self._anvil.taHeight);
                    }
                },
            },
        }),

        events: PyDefUtils.assembleGroupEvents("text area", /*!componentEvents(TextArea)!1*/ ["universal", "focus"], {
            change: /*!componentEvent(TextArea)!1*/ {
                name: "change",
                description: "When the text in this text area is edited",
                parameters: [],
                important: true,
                defaultEvent: true,
            },
        }),

        element({ placeholder, text, ...props }) {
            const prefix = getCssPrefix();
            const outerClass = PyDefUtils.getOuterClass(props);
            const outerStyle = PyDefUtils.getOuterStyle(props);
            const outerAttrs = PyDefUtils.getOuterAttrs(props);
            text = Sk.builtin.checkNone(text) ? "" : text.toString();
            placeholder = Sk.builtin.checkNone(placeholder) ? "" : placeholder.toString();
            return (
                <textarea
                    refName="outer"
                    className={`anvil-text-area ${prefix}form-control ${prefix}to-disable ${outerClass}`}
                    style={outerStyle}
                    placeholder={placeholder}
                    value={text}
                    {...outerAttrs}
                />
            );
        },

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["ClassicComponent"], (self) => {
                self._anvil.element
                    .on("propertychange change keyup paste input", function (e) {
                        const elt = self._anvil.element;
                        const lc = elt.val();
                        if (lc != self._anvil.lastChangeVal) {
                            self._anvil.lastChangeVal = elt.val();
                            PyDefUtils.raiseEventAsync({}, self, "change");
                        }

                        if (self._anvil.taAutoExpand) {
                            setHeightToContent(self, self._anvil.domNode);
                        }
                    })
                    .on("focus", function (e) {
                        PyDefUtils.raiseEventAsync({}, self, "focus");
                    })
                    .on("blur", function (e) {
                        self._anvil.dataBindingWriteback(self, "text").finally(() => setTimeout(() => PyDefUtils.raiseEventAsync({}, self, "lost_focus")));
                    });
                self._anvil.taAutoExpand = isTrue(self._anvil.props["auto_expand"]) && !ANVIL_IN_DESIGNER;
                self._anvil.taHeight = self._anvil.props["height"].toString();
                const text = self._anvil.props["text"];
                self._anvil.lastChangeVal = Sk.builtin.checkNone(text) ? "" : text.toString();

                const elt = self._anvil.element;
                const adjustHeight = () => {
                    if (self._anvil.taAutoExpand) {
                        self._anvil.taHeightDiff = elt.outerHeight() - elt.height();
                        setHeightToContent(self, self._anvil.domNode);
                    }
                }

                self._anvil.pageEvents = { add: adjustHeight, show: adjustHeight };
            });

            /*!defMethod(_)!2*/ "Set the keyboard focus to this TextArea"
            $loc["focus"] = new Sk.builtin.func(function focus(self) {
                self._anvil.element.trigger("focus");
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_)!2*/ "Select all the text in this TextArea"
            $loc["select"] = new Sk.builtin.func(function select(self, pySelectionStart, pySelectionEnd, pyDirection) {
                if (pySelectionStart && pySelectionEnd) {
                    let selectionStart = Sk.ffi.remapToJs(pySelectionStart);
                    let selectionEnd = Sk.ffi.remapToJs(pySelectionEnd);
                    let direction = pyDirection ? Sk.ffi.remapToJs(pyDirection) : undefined;
                    self._anvil.domNode.setSelectionRange(selectionStart, selectionEnd, direction);
                } else {
                    self._anvil.element.trigger("select");
                }
                return Sk.builtin.none.none$;
            });
        },
    });

    function setHeightToContent(self, domNode) {
        if (!self._anvil.getPropJS("visible")) {
            return;
        }
        const h = self._anvil.taHeight;
        let propHeight;
        if (typeof h === "number") {
            propHeight = h;
        } else if (typeof h === "string" && h.length > 0) {
            propHeight = parseFloat(h);
        } else {
            propHeight = 0;
        }

        let taDummy = self._anvil.taDummy;
        if (!taDummy) {
            taDummy = domNode.cloneNode();
            taDummy.style.position = "absolute";
            taDummy.style.top = "100%";
            taDummy.style.visibility = "hidden";
            self._anvil.taDummy = taDummy;
        }
        taDummy.style.height = 0;
        taDummy.style.width = domNode.clientWidth + "px";
        taDummy.value = domNode.value;
        document.body.appendChild(taDummy);
        domNode.style.height = PyDefUtils.cssLength(Math.max(propHeight, taDummy.scrollHeight + (self._anvil.taHeightDiff || 0)));
        taDummy.remove();
    }

}; 

/*!defClass(anvil,TextArea,Component)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout, height, interaction, text, appearance
 *  - New props: placeholder
 *  - Override set: text
 *  - Event groups: universal
 *  - New events: change
 *
 */
