"use strict";

var PyDefUtils = require("PyDefUtils");

module.exports = function(pyModule) {

/**
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
    pyModule["DropDown"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var properties = PyDefUtils.assembleGroupProperties(/*!componentProps(DropDown)!2*/
            ["layout", "interaction", "text", "appearance", "user data", "tooltip"],
            {
                align: {
                    defaultValue: "full",
                    enum: ["left", "center", "right", "full"],
                    set: function(s,e,v) {
                        if (v == "full") {
                            e.find("form,select").css("width", "100%");
                        } else {
                            e.find("form,select").css("width", "");
                            e.css("text-align", v);
                        }
                    },
                    description: "The position of this dropdown in the available space.",
                    important: true
                },
                text: {
                    omit: true,
                },
                font_size: {
                    set: function(s,e,v) { e.css("font-size", typeof(v)=='number' ? (""+(+v)+"px") : ""); }
                },
                font: {
                    set: function(s,e,v) { e.find("select").css("font-family", v); }
                },
                bold: {
                    set: function(s,e,v) { e.find("select").css("font-weight", v ? "bold" : "normal"); }
                },
                italic: {
                    set: function(s,e,v) { e.find("select").css("font-style", v ? "italic" : "normal"); }
                },
                underline: {
                    set: function(s,e,v) { e.find("select").css("text-decoration", v ? "underline" : "none"); }
                },
                background: {
                    set: function(s,e,v) { 
                        let m = (""+v).match(/^theme:(.*)$/);
                        if (m) {
                            v = s._anvil.themeColors[m[1]] || '';
                        }
                        e.find("select").css("background-color", v); 
                    }
                },
                foreground: {
                    set: function(s,e,v) { 
                        let m = (""+v).match(/^theme:(.*)$/);
                        if (m) {
                            v = s._anvil.themeColors[m[1]] || '';
                        }
                        e.find("select").css("color", v); 
                    }
                },
            }
        );

        let updateItems = (self, e, pyVal) => {
            var s = e.find("select");
            var currentPyVal = self._anvil.jsItems && self._anvil.jsItems[s.val()];
            currentPyVal = currentPyVal && currentPyVal[1];

            s.empty();
            return Sk.misceval.chain(Sk.misceval.arrayFromIterable(pyVal, true), 
            (arr) => {
                pyVal = new Sk.builtin.list(arr);
                self._anvil.pyItems = pyVal;
                var foundSelectedValue = false;

                if (self._anvil.getPropJS("include_placeholder")) {
                    s.append($("<option/>").text(self._anvil.getPropJS("placeholder")).val(-2));
                    s.val(-2);
                    foundSelectedValue = true;
                    if (self._anvil.cachedInvalidValue == Sk.builtin.none.none$) {
                        delete self._anvil.cachedInvalidValue;
                    }
                }
                const jsItems = self._anvil.jsItems = [];
                let itemVal, itemKey;
                arr.forEach((item, i) => {
                    if (Sk.builtin.checkString(item)) {
                        itemKey = item;
                        itemVal = item;
                        jsItems.push([itemKey, itemVal]);
                        s.append($("<option/>").text(itemKey.toString()).val(i));
                    } else if (!(item instanceof Sk.builtin.list || item instanceof Sk.builtin.tuple)) {
                        throw new Sk.builtin.TypeError("'items' must be a list of strings or tuples");
                    } else {
                        item = Sk.misceval.arrayFromIterable(item); // list and tuples won't suspend
                        if (item.length !== 2 || !Sk.builtin.checkString(item[0])) {
                            throw new Sk.builtin.TypeError("Dropdown item tuples must be of the form ('label', value)");
                        }
                        [itemKey, itemVal] = item;
                        jsItems.push(item);
                        s.append($("<option/>").text(itemKey.toString()).val(i));
                    }
                    if (self._anvil.cachedInvalidValue && Sk.misceval.richCompareBool(self._anvil.cachedInvalidValue, itemVal, "Eq")) {
                        s.val(i);
                        delete self._anvil.cachedInvalidValue;
                        foundSelectedValue = true;
                    } else if (currentPyVal && Sk.misceval.richCompareBool(currentPyVal, itemVal, "Eq")) {
                        s.val(i);
                        foundSelectedValue = true;
                    }
                })
                if (!foundSelectedValue && jsItems.length > 0) {
                    s.val(0);
                    delete self._anvil.cachedInvalidValue; // Just in case
                }
            });
        }

        /*!componentProp(DropDown)!1*/
        properties.push({
            name: "items",
            type: "text[]",
            description: "The items to display in this dropdown.",
            defaultValue: new Sk.builtin.list([]),
            exampleValue: [["One", 1], ["Two", 2]],
            important: true,
            priority: 10,
            pyVal: true,
            set: function(self,e,pyVal) {
                return updateItems(self,e,pyVal); // So as not to blow up gendoc.
            },
            get: function(self, e) {
                return self._anvil.pyItems || new Sk.builtin.list([]);
            }
        });

        /*!componentProp(DropDown)!1*/
        properties.push({
            name: "selected_value",
            type: "object",
            suggested: true,
            description: "The value of the currently selected item. Can only be set at runtime.",
            defaultValue: Sk.builtin.none.none$,
            hideFromDesigner: true,
            important: true,
            priority: 10,
            pyVal: true,
            allowBindingWriteback: true,
            set: function(self,e,pyVal) {
                if (pyVal === null) {
                    return; // INIT
                }

                const items = self._anvil.jsItems || [];
                for (let i = 0; i < items.length; i++) {
                    const [,itemVal] = items[i];
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
            get: function(self,e) {
                if (self._anvil.cachedInvalidValue) {
                    return self._anvil.cachedInvalidValue;
                }
                
                const idx = e.find("select").val();
                const item = self._anvil.jsItems[idx];

                return item ? item[1] : Sk.builtin.none.none$;
            }
        });

        /*!componentProp(DropDown)!1*/
        properties.push({
            name: "include_placeholder",
            type: "boolean",
            description: "Whether to add a placeholder item to the list with value None",
            defaultValue: false,
            important: true,
            set: (s,e,v) => {
                e.find("select").val(-3); // Make sure nothing is selected
                return updateItems(s,e,s._anvil.pyItems)
            },
        });

        /*!componentProp(DropDown)!1*/
        properties.push({
            name: "placeholder",
            type: "string",
            description: "The text to be displayed when the selected_value is None.",
            showInDesignerWhen: "include_placeholder",
            defaultValue: "",
            important: true,
            exampleValue: "Choose an item...",
            set: function(s,e,v) {
                return updateItems(s,e,s._anvil.pyItems)
            },
        });



        //TODO: Remove "text" property properly

        /*! componentProp(DropDown)!1*/ // This is deliberately broken to prevent the "justify" property from being documented.
        /*properties.push({name: "justify", type: "string", enum: ["left", "center", "right", "full"],
             description: "The position of the radio button",
             set: function(s,e,v) {

                 e.find("input").prop("checked", v);
             },
             get: function(s,e) { return e.find("input").prop("checked"); }});
        */

        var events = PyDefUtils.assembleGroupEvents("DropDown", /*!componentEvents(DropDown)!1*/ ["universal"]);

        events.push(/*!componentEvent(DropDown)!1*/
            {name: "change", description: "When an item is selected",
             parameters: [], important: true, defaultEvent: true}
        );

        $loc["__init__"] = PyDefUtils.mkInit(function init(self) {
            self._anvil.element = $('<div class="anvil-inlinable anvil-dropdown"><form class="form-inline"><select class="form-control to-disable"></select></form><div>');
            self._anvil.invalidItemElement = $("<option/>").text("<Invalid value>").val(-1);

            self._anvil.element.find('select').on("change", function(e) {
                if (self._anvil.getPropJS('enabled')) { // Search me why this is needed, but it is.
                  delete self._anvil.cachedInvalidValue;
                  self._anvil.invalidItemElement.detach();
                  self._anvil.dataBindingWriteback(self, "selected_value").finally(function() {
                      return PyDefUtils.raiseEventAsync({}, self, "change");
                  });
                }
            });

            self._anvil.dataBindingProp = "selected_value";
        },
        pyModule, $loc, properties, events, pyModule["Component"]);

        /*!defMethod(_)!2*/ "Set the keyboard focus to this component"
        $loc["focus"] = new Sk.builtin.func(function(self) {
            self._anvil.element.find("select").trigger("focus");
        });


    }, /*!defClass(anvil,DropDown,Component)!*/ 'DropDown', [pyModule["Component"]]);
};

/*
 * TO TEST:
 *
 *  - ?
 *
 */
