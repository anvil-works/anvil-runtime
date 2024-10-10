"use strict";

const { getCssPrefix } = require("@runtime/runner/legacy-features");
var PyDefUtils = require("PyDefUtils");


/*#
id: dropdown
docs_url: /docs/client/components/basic#dropdown
module: Anvil Components
kind: class
title: DropDown
tooltip: Learn more about DropDowns
description: |
  ```python
  # Create a DropDown
  b = DropDown(items=["Item 1", "Item 2"])
  ```
  This is an Anvil drop-down. Drag and drop onto your form, or create one in code with the `DropDown` constructor:
  ![Screenshot](img/screenshots/dropdown.png)
  If the `items` property can be a list of strings (`["One", "Two", "Three"]`), or a list of 2-tuples (`[("First Option", 0), ("Second Option", 1)]`).
  If you use a list of strings, the `selected_value` property always returns the currently selected string.
  ```python
  # Assuming 'worksheet' is a Google Sheet with columns 'name' and 'age':
  self.drop_down_1.items = [(r["name"],r) for r in worksheet.rows]
  # Later, probably in the DropDown 'change' event handler:
  row = self.drop_down_1.selected_value
  self.lbl_name.text = row["name"]
  self.lbl_age.text = row["age"]
  ```
  If you use a list of 2-tuples (`[("First Option", 0), ("Second Option", 1)]`) then the first element of each tuple is displayed in the drop down box. When a value is selected, the _second_ element of the tuple becomes the `selected_value` property.
  This is particularly useful if you wish to, for instance, choose from a list of spreadsheet rows:
  ```python
  # Construct a list of items
  self.drop_down_1.items = []
  for lunch in ['burger', 'burrito', 'bolognese']:
    self.drop_down_1.items.append(lunch)
  # Make the new list live in the UI
  self.drop_down_1.items = self.drop_down_1.items
  ```
  DropDown `items` are updated in the UI when the `items` attribute is set using the `=` operator. If you're using `append` to construct a new `items` list, run the `=` operator to make the change live:
*/

module.exports = (pyModule) => {
    const { isTrue } = Sk.misceval;

    pyModule["DropDown"] = PyDefUtils.mkComponentCls(pyModule, "DropDown", {
        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(DropDown)!2*/ ["layout", "layout_margin", "interaction", "text", "appearance", "user data", "tooltip"], {
            align: {
                defaultValue: new Sk.builtin.str("full"),
                options: ["left", "center", "right", "full"],
                set(s, e, v) {
                    v = v.toString();
                    if (v === "full") {
                        s._anvil.elements.form.style.width = "100%";
                        s._anvil.elements.select.style.width = "100%";
                    } else {
                        s._anvil.elements.form.style.width = "";
                        s._anvil.elements.select.style.width = "";
                        s._anvil.elements.outer.style.textAlign = v;
                    }
                    s._anvil.domNode.classList.toggle("anvil-inlinable", v !== "full");
                },
                description: "The position of this dropdown in the available space.",
                important: true,
            },
            text: {
                omit: true,
            },
            font: {
                set(s, e, v) {
                    s._anvil.elements.select.style.fontFamily = v.toString();
                },
            },
            bold: {
                set(s, e, v) {
                    s._anvil.elements.select.style.fontWeight = isTrue(v) ? "bold" : "";
                },
            },
            italic: {
                set(s, e, v) {
                    s._anvil.elements.select.style.fontStyle = isTrue(v) ? "italic" : "";
                },
            },
            underline: {
                set(s, e, v) {
                    s._anvil.elements.select.style.textDecoration = isTrue(v) ? "underline" : "";
                },
            },
            background: {
                set(s, e, v) {
                    s._anvil.elements.select.style.backgroundColor = PyDefUtils.getColor(v);
                },
            },
            foreground: {
                set(s, e, v) {
                    s._anvil.elements.select.style.color = PyDefUtils.getColor(v);
                },
            },
            /*!componentProp(DropDown)!1*/
            items: {
                name: "items",
                type: "text[]",
                description: "The items to display in this dropdown.",
                defaultValue: new Sk.builtin.list([]), // this will be copied on initialization
                exampleValue: [
                    ["One", 1],
                    ["Two", 2],
                ],
                important: true,
                priority: 10,
                pyVal: true,
                initialize: true,
                set(self, e, pyVal) {
                    return updateItems(self, e, pyVal); // So as not to blow up gendoc.
                },
                get(self, e) {
                    return self._anvil.pyItems || new Sk.builtin.list([]);
                },
            },

            /*!componentProp(DropDown)!1*/
            selected_value: {
                name: "selected_value",
                type: "object",
                suggested: true,
                description: "The value of the currently selected item. Can only be set at runtime.",
                hideFromDesigner: true,
                important: true,
                priority: 10,
                pyVal: true,
                allowBindingWriteback: true,
                dataBindingProp: true,
                set(self, e, pyVal) {
                    const items = self._anvil.jsItems || [];
                    for (let i = 0; i < items.length; i++) {
                        const [, itemVal] = items[i];
                        if (Sk.misceval.richCompareBool(itemVal, pyVal, "Eq")) {
                            self._anvil.invalidItemElement.detach();
                            e.find("select").val(i);
                            delete self._anvil.cachedInvalidValue;
                            return;
                        }
                    }

                    if (self._anvil.getPropJS("include_placeholder") && pyVal === Sk.builtin.none.none$) {
                        e.find("select").val(-2);
                        delete self._anvil.cachedInvalidValue;
                    } else {
                        e.find("select").append(self._anvil.invalidItemElement).val(-1);
                        self._anvil.cachedInvalidValue = pyVal;
                    }
                },
                get(self, e) {
                    if (self._anvil.cachedInvalidValue) {
                        return self._anvil.cachedInvalidValue;
                    }

                    const idx = e.find("select").val();
                    const item = self._anvil.jsItems[idx];

                    return item ? item[1] : Sk.builtin.none.none$;
                },
            },

            /*!componentProp(DropDown)!1*/
            include_placeholder: {
                name: "include_placeholder",
                type: "boolean",
                description: "Whether to add a placeholder item to the list with value None",
                defaultValue: Sk.builtin.bool.false$,
                pyVal: true,
                important: true,
                set(s, e, v) {
                    s._anvil.select.val(-3); // Make sure nothing is selected
                    return updateItems(s, e, s._anvil.pyItems);
                },
            },

            /*!componentProp(DropDown)!1*/
            placeholder: {
                name: "placeholder",
                type: "string",
                description: "The text to be displayed when the selected_value is None.",
                showInDesignerWhen: "include_placeholder",
                defaultValue: Sk.builtin.str.$empty,
                pyVal: true,
                important: true,
                exampleValue: "Choose an item...",
                set(s, e, v) {
                    return updateItems(s, e, s._anvil.pyItems);
                },
            },
        }),

        events: PyDefUtils.assembleGroupEvents("DropDown", /*!componentEvents(DropDown)!1*/ ["universal"], {
            /*!componentEvent(DropDown)!1*/
            change: { name: "change", description: "When an item is selected", parameters: [], important: true, defaultEvent: true },
        }),

        element({ font, bold, italic, underline, background, foreground, ...props }) {
            const selectStyle = PyDefUtils.getOuterStyle({ font, bold, italic, underline, background, foreground });
            let inlineable = "anvil-inlinable";

            let width = "";
            if (props.align.toString() === "full") {
                width = "width: 100%;";
                delete props.align;
                inlineable = "";
            }

            const selectAttrs = !isTrue(props.enabled) ? {disabled: ""} : {};
            const prefix = getCssPrefix();

            return (
                <PyDefUtils.OuterElement className={inlineable + " anvil-dropdown"} {...props}>
                    <form refName="form" className={`${prefix}form-inline`} {...(width ? { style: width } : {})}>
                        <select refName="select" className={`${prefix}form-control ${prefix}to-disable`} style={selectStyle + width} {...selectAttrs}></select>
                    </form>
                </PyDefUtils.OuterElement>
            );
        },

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["ClassicComponent"], (self) => {
                self._anvil.invalidItemElement = $("<option />").text("<Invalid value>").val(-1);

                self._anvil.select = $(self._anvil.elements.select).on("change", (e) => {
                    if (self._anvil.getPropJS("enabled")) {
                        // Search me why this is needed, but it is.
                        delete self._anvil.cachedInvalidValue;
                        self._anvil.invalidItemElement.detach();
                        self._anvil.dataBindingWriteback(self, "selected_value").finally(() => PyDefUtils.raiseEventAsync({}, self, "change"));
                    }
                });
                // only set this now since we need invalidItemElement to exist
                const selected_value = self._anvil.props["selected_value"];
                if (selected_value !== undefined) {
                    return self._anvil.setProp("selected_value", selected_value);
                }
            });

            /*!defMethod(_)!2*/ "Set the keyboard focus to this component"
            $loc["focus"] = new Sk.builtin.func(function focus(self) {
                self._anvil.select.trigger("focus");
                return Sk.builtin.none.none$;
            });
        },
    });

    let updateItems = (self, e, pyVal) => {
        var s = e.find("select");
        var currentPyVal = self._anvil.jsItems && self._anvil.jsItems[s.val()];
        currentPyVal = currentPyVal && currentPyVal[1];

        s.empty();

        return Sk.misceval.chain(Sk.misceval.arrayFromIterable(pyVal, true), (arr) => {
            pyVal = new Sk.builtin.list(arr);
            self._anvil.pyItems = pyVal;
            let foundSelectedValue = false;

            if (isTrue(self._anvil.getProp("include_placeholder"))) {
                s.append($("<option />").text(self._anvil.getProp("placeholder").toString()).val(-2));
                s.val(-2);
                foundSelectedValue = true;
                if (self._anvil.cachedInvalidValue === Sk.builtin.none.none$) {
                    delete self._anvil.cachedInvalidValue;
                }
            }
            const jsItems = (self._anvil.jsItems = []);
            let itemVal, itemKey;
            arr.forEach((item, i) => {
                if (Sk.builtin.checkString(item)) {
                    itemKey = item;
                    itemVal = item;
                    jsItems.push([itemKey, itemVal]);
                    s.append($("<option />").text(itemKey.toString()).val(i));
                } else if (!(item instanceof Sk.builtin.list || item instanceof Sk.builtin.tuple)) {
                    throw new Sk.builtin.TypeError("'items' must be a list of strings or tuples");
                } else {
                    item = Sk.misceval.arrayFromIterable(item); // any iterable that doesn't suspend
                    if (item.length !== 2 || !Sk.builtin.checkString(item[0])) {
                        throw new Sk.builtin.TypeError(
                            `Dropdown item tuples must be of the form ('label', value), (at item ${i} got ${Sk.misceval.objectRepr(
                                new Sk.builtin.tuple(item)
                            )})`
                        );
                    }
                    [itemKey, itemVal] = item;
                    jsItems.push(item);
                    s.append($("<option />").text(itemKey.toString()).val(i));
                }
                if (self._anvil.cachedInvalidValue && Sk.misceval.richCompareBool(self._anvil.cachedInvalidValue, itemVal, "Eq")) {
                    s.val(i);
                    delete self._anvil.cachedInvalidValue;
                    foundSelectedValue = true;
                } else if (currentPyVal && Sk.misceval.richCompareBool(currentPyVal, itemVal, "Eq")) {
                    s.val(i);
                    foundSelectedValue = true;
                }
            });
            if (!foundSelectedValue && jsItems.length > 0) {
                s.val(0);
                delete self._anvil.cachedInvalidValue; // Just in case
            }
        });
    };
};

/*!defClass(anvil,DropDown,Component)!*/

/*
 * TO TEST:
 *
 *  - ?
 *
 */

 