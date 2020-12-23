"use strict";

/**
id: repeatingpanel
docs_url: /docs/client/components/repeating-panel
title: RepeatingPanel
tooltip: Learn more about RepeatingPanel
description: |

  <div class="tutorial-link">
    Watch our RepeatingPanel tutorial<br>
    <a href="/blog/storing-and-displaying-data"><i class="fa fa-play"></i> Play video</a>
  </div>

  RepeatingPanels are a mechanism for displaying the same UI elements repeatedly on the page. Typical uses for RepeatingPanels
  might be: a TODO list, a list of tickets in a ticketing system, a series of profiles in a dating website.

  A RepeatingPanel creates a form for each of a list of items. It uses a template to generate a form for each item in the list.

  ```python
     self.repeating_panel = RepeatingPanel()

     # You can use a search iterator from data tables
     self.repeating_panel.items = app_tables.people.search()

     # You can use a flat list
     self.repeating_panel.items = ['a', 'b', 'c']

     # You can use a more complex data structure... anything that can be iterated over
     self.repeating_panel.items = (
       {'name': 'Joe', 'age': 14},
       {'name': 'Sally', 'age': 8}
     )
  ```
  The list of items is specified by setting the RepeatingPanel's `items` property to any iterable.

  ```python
  self.repeating_panel_1.item_template = "PeopleTemplate"
  self.repeating_panel_1.items = [
    {'name': 'Joe', 'age': 14},
    {'name': 'Sally', 'age': 8}
  ]
  # self.repeating_panel_1 now contains two instances of
  # the PeopleTemplate form. The first has its `item`
  # property set to {'name': 'Joe', 'age': 14}
  # (ready for use in data bindings); the second
  # has its `item` property set to
  # {'name': 'Sally', 'age': 8}
  ```
  There are two ways to specify what to use as the template. When you create a new RepeatingPanel in the form designer, Anvil will automatically create a new form called something like `ItemTemplate1`.
  You can either modify `ItemTemplate1` as you would any normal form, or double-click on the RepeatingPanel to drop components directly into it.

  Alternatively, you can attach any form you like to a RepeatingPanel. For example, let's say we have a form called `PeopleTemplate`.
  If we set the RepeatingPanel's `item_template` to `"PeopleTemplate"`, it will create a new instance of `PeopleTemplate` for every element in its `items` list.

  Each form instance is created with its `self.item` set to its corresponding element in the list. You can use `self.item` in data bindings or in the code for the template form.

  The template has access to its parent RepeatingPanel in the code via `self.parent`.
  This can be useful if you want actions in the template form to have an impact on the whole RepeatingPanel.
  Let's say you want to refresh the entire RepeatingPanel when a button is clicked in the template form - you could use `set_event_handler` to bind an event called `x-refresh-panel` to the RepeatingPanel, then call `self.parent.raise_event('x-refresh')`.

  ```python
  self.repeating_panel_1.items = app_tables.people.search()
  ```
  A common use of RepeatingPanels is to create a table, with one row for each row in a data table.
  For example, if you had a table called 'people' with columns 'name' and 'age', you could drop two labels into the RepeatingPanel and assign the `text` of the first label to `self.item['name']` and the `text` of the second label to `self.item['age']`.
  The labels in each row line up, causing a column effect. To create column headers, you can drop a ColumnPanel above the RepeatingPanel and put labels in as appropriate.

  ![Screenshot](img/screenshots/repeating-panel-table.png)

*/

var PyDefUtils = require("PyDefUtils");

module.exports = function(pyModule, componentsModule) {

    pyModule["RepeatingPanel"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var properties = PyDefUtils.assembleGroupProperties(/*!componentProps(RepeatingPanel)!2*/["appearance", "layout", "tooltip", "user data"], {});

        // Returning undefined means we've fallen off the end of the items iterator
        let getItemAt = (self, idx) => {
            if (!self._anvil.pyIterator)
                return undefined;

            if (!self._anvil.itemCache)
                self._anvil.itemCache = [];

            // If we already have this item in the cache, return it.

            if (idx < self._anvil.itemCache.length)
                return self._anvil.itemCache[idx];

            // We don't already have it in the cache, so walk along the iterator until we do, then return that.

            return Sk.misceval.chain(Sk.misceval.iterFor(self._anvil.pyIterator, (pyItem, i) => {

                    self._anvil.itemCache.push(pyItem);

                    if (i >= idx)
                        return Sk.misceval.Break();
                    else 
                        return i + 1;
                }, /* i = */ self._anvil.itemCache.length),
                () => self._anvil.itemCache[idx],
            );
        };


        let removeAllTemplateInstancesAfter = (self, firstTemplateInstanceToRemove) => {
            if (firstTemplateInstanceToRemove == Sk.builtin.none.none$) {
                return;
            }
            let removing = false;
            return Sk.misceval.iterFor(Sk.abstr.iter(new Sk.builtin.list(self._anvil.lastPagination)), ([,,,templateInstance]) => {

                if (removing || templateInstance == firstTemplateInstanceToRemove) {
                    removing = true;
                    return Sk.misceval.callsimOrSuspend(templateInstance.tp$getattr(new Sk.builtin.str("remove_from_parent")));
                }
            });
        }

        let paginate = (self, updatedChild=null) => {

            if (self._inDesigner) { return [0, null, true]; }


            if (updatedChild && updatedChild._anvil.pagination) {
                let i = self._anvil.lastPagination.findIndex(([,,,templateInstance]) => templateInstance == updatedChild);
                self._anvil.lastPagination[i][1] = updatedChild._anvil.pagination.rowsDisplayed;

                if (self._anvil.pagination.startAfter && self._anvil.pagination.startAfter[0] == i) {
                    // We currently start after this component. Update our idea of where *it* starts.
                    self._anvil.pagination.startAfter[2] = updatedChild._anvil.pagination.startAfter;
                }
            }

            self._anvil.pagination.rowsDisplayed = 0;
            self._anvil.pagination.stoppedAt = null;
            self._anvil.pagination.done = true;


            let [stoppedIdx, itemsCounterWhenStopped, childStartAfter, childDone] = self._anvil.pagination.startAfter || [0, self._anvil.itemsCounter, null, false];
            let idx = stoppedIdx + (childDone==true ? 1 : 0);
            let idxOnPage = 0;

            var adder = self._anvil.pyHiddenContainer.tp$getattr(new Sk.builtin.str("add_component"));
            var addComponent = function(pyC) {
                self._anvil.itemsElement.append(pyC._anvil.element);
                return Sk.misceval.callsimOrSuspend(adder, pyC);
            };

            if (!self._anvil.formConstructor || self._anvil.formConstructor == Sk.builtin.none.none$) {
                // We have no constructor. It's either none, or we failed to find one based on the name
                Sk.misceval.callsim(self._anvil.pyHiddenContainer.tp$getattr(new Sk.builtin.str("clear")));
                if (self._anvil.templateFormName) {
                    var message = "";
                    if (self._anvil.missingDependency) {
                        message = "Dependency missing: ";
                    }
                    message += "No such form '" + self._anvil.templateFormName + "'";

                    var pyC = Sk.misceval.call(pyModule["InvalidComponent"], undefined, undefined, [new Sk.builtin.str("text"), new Sk.builtin.str(message)]);
                    return Sk.misceval.chain(addComponent(pyC),
                        () => [0, null, true]);
                } else {
                    // Form constructor is None - don't render anything.
                    return[0, null, true];
                }
            }

            if (self._anvil.itemsCounter != itemsCounterWhenStopped) {
                self._anvil.pagination.rowsDisplayed = 0;
                self._anvil.pagination.stoppedAt = null;
                self._anvil.pagination.done = "INVALID";
                return [self._anvil.pagination.rowsDisplayed, self._anvil.pagination.stoppedAt, self._anvil.pagination.done];
            }


            let currentPagination = [];
            currentPagination.pyIterator = self._anvil.pyIterator;

            self._anvil.element.addClass("paginating");

            return Sk.misceval.chain(undefined,
                () => PyDefUtils.whileOrSuspend(() => true, () => {
                    // Work our way through all our components, removing until we find the starting point or run out.
                    let lp = self._anvil.lastPagination[0];
                    if (!lp) {
                        // We have run out of existing components.
                        return Sk.misceval.Break();
                    }

                    let [currentItemIdx, currentItemRowsDisplayed, currentItemStartAfter, templateInstance] = lp;

                    if (self._anvil.lastPagination.pyIterator == self._anvil.pyIterator) {
                        // We are still looking at the same iterator, so we might be able to keep something.

                        if (currentItemIdx == idx) {
                            // We have reached where we left off. Stop here.
                            return Sk.misceval.Break();
                        }
                    }


                    // Remove this component and try the next.
                    self._anvil.lastPagination.shift();
                    return Sk.misceval.callsimOrSuspend(templateInstance.tp$getattr(new Sk.builtin.str("remove_from_parent")));

                }),
                // Any components left at this point must start at the right index. They may need repaginating, depending on our new row quota and whether they were done.
                () => PyDefUtils.whileOrSuspend(() => true, () => {
                    let pyItemOrSuspension = getItemAt(self, idx);
                    let startAfterThisComponent = stoppedIdx == idx;

                    if (pyItemOrSuspension === undefined) {
                        idx++;
                        idxOnPage++;
                        return Sk.misceval.Break();
                    }

                    if (self._anvil.pagination.rowsDisplayed >= self._anvil.pagination.rowQuota) {
                        self._anvil.pagination.done = false;
                        idx++;
                        idxOnPage++;
                        return Sk.misceval.Break();
                    }

                    // If the item currently displayed on the page at this index is the right one, and used less than the row quota we have remaining, leave it there and move on.
                    // Otherwise, remove it (and all subsequent items) and recreate.
                    let [currentItemIdx, currentItemRowsDisplayed, currentItemStartAfter, templateInstance] = self._anvil.lastPagination[idxOnPage] || [-1, 0, null, Sk.builtin.none.none$];

                    let chainFns = [];

                    if (currentItemIdx == idx) {
                        // We are already displaying the right item at this position. Repaginate it if necessary.
                        if (templateInstance._anvil.pagination) {
                            if (currentItemRowsDisplayed <= self._anvil.pagination.rowQuota - self._anvil.pagination.rowsDisplayed && templateInstance._anvil.pagination.done == true && currentItemStartAfter == templateInstance._anvil.pagination.startAfter && (!startAfterThisComponent || childStartAfter == templateInstance._anvil.pagination.startAfter)) {
                                // This item displayed fewer rows than we have quota for now, and it was done. Move on, but update its new row quota, just in case it decides to expand.
                                templateInstance._anvil.pagination.rowQuota = self._anvil.pagination.rowQuota - self._anvil.pagination.rowsDisplayed;
                                self._anvil.pagination.rowsDisplayed += currentItemRowsDisplayed;
                                self._anvil.pagination.stoppedAt = [idx, self._anvil.itemsCounter, templateInstance._anvil.pagination.stoppedAt, templateInstance._anvil.pagination.done];
                                if (templateInstance._anvil.pagination.done == "INVALID") {
                                    self._anvil.pagination.done = "INVALID";
                                } else {
                                    self._anvil.pagination.done = self._anvil.pagination.done == true && templateInstance._anvil.pagination.done;
                                }
                                currentPagination.push([idx, currentItemRowsDisplayed, currentItemStartAfter, templateInstance]);
                            } else {
                                // We need to repaginate this item. It either wasn't done (previously ran out of quota) or was done but used too many rows for our new quota.
                                templateInstance._anvil.pagination.rowQuota = self._anvil.pagination.rowQuota - self._anvil.pagination.rowsDisplayed;
                                if (startAfterThisComponent) {
                                    templateInstance._anvil.pagination.startAfter = childStartAfter;
                                }
                                chainFns.push(() => templateInstance._anvil.paginate());
                                chainFns.push(([rows, stoppedAt, done]) => {
                                    self._anvil.pagination.rowsDisplayed += rows;
                                    self._anvil.pagination.stoppedAt = [idx, self._anvil.itemsCounter, stoppedAt, done];
                                    if (done == "INVALID") {
                                        self._anvil.pagination.done = "INVALID";
                                    } else {
                                        self._anvil.pagination.done = self._anvil.pagination.done == true && done;
                                    }
                                    currentPagination.push([idx, rows, childStartAfter, templateInstance]);
                                });
                            }
                        } else {
                            currentPagination.push([currentItemIdx, currentItemRowsDisplayed, currentItemStartAfter, templateInstance]);
                        }

                    } else {
                        // Any remaining components should not be here.
                        chainFns.push(() => removeAllTemplateInstancesAfter(self, templateInstance));

                        // We know we have some row quota available, so create the next template instance and paginate it.
                        chainFns.push(() => pyItemOrSuspension, pyItem => Sk.misceval.callOrSuspend(self._anvil.formConstructor, undefined, undefined, [new Sk.builtin.str("item"), pyItem]),
                            pyComponent => {
                                pyComponent._anvil.delayAddedToPage = true;
                                return Sk.misceval.chain(addComponent(pyComponent),
                                    () => {
                                        if (pyComponent._anvil.paginate) {

                                            pyComponent._anvil.pagination = {
                                                startAfter: startAfterThisComponent ? childStartAfter : null,
                                                rowQuota: self._anvil.pagination.rowQuota - self._anvil.pagination.rowsDisplayed,
                                            };
                                            return Sk.misceval.chain(pyComponent._anvil.paginate(),
                                                ([rowsDisplayed, stoppedAt, done]) => {
                                                    self._anvil.pagination.rowsDisplayed += rowsDisplayed;
                                                    self._anvil.pagination.stoppedAt = [idx, self._anvil.itemsCounter, stoppedAt, done];
                                                    if (done == "INVALID") {
                                                        self._anvil.pagination.done = "INVALID";
                                                    } else {
                                                        self._anvil.pagination.done = self._anvil.pagination.done == true && done;
                                                    }

                                                    currentPagination.push([idx, rowsDisplayed, startAfterThisComponent ? childStartAfter : null, pyComponent]);
                                                }
                                            );
                                        } else {
                                            currentPagination.push([idx, 0, null, pyComponent]);
                                        }
                                    }
                                );
                            }
                        )
                    }

                    return Sk.misceval.chain(undefined,
                        ...chainFns.concat(() => {
                            idx++;
                            idxOnPage++;
                        })
                    );
                }),
                () => {
                    // We've now displayed all the rows we have quota for. It may be that all of them matched the cache, in which case there may be remaining rows displayed that we don't have quota for. Remove them.
                    if (self._anvil.lastPagination.length >= idxOnPage) {
                        // There are left-over rows that we no-longer have quota for.
                        return removeAllTemplateInstancesAfter(self, self._anvil.lastPagination[idxOnPage-1][3]);
                    }
                },
                () => {
                    self._anvil.lastPagination = currentPagination;

                    if (PyDefUtils.logPagination) console.log("RepeatingPanel displayed", self._anvil.pagination.rowsDisplayed, "rows.", self._anvil.pagination.done ? "Done" : "Interrupted", "at", self._anvil.pagination.stoppedAt);
                    if (PyDefUtils.logPagination) console.groupEnd();
                },
                () => {
                    let parent = self._anvil.parent && self._anvil.parent.pyObj;
                    if (updatedChild && updatedChild._anvil.pagination && parent && parent._anvil.paginate) {

                        return Sk.misceval.chain(parent._anvil.paginate(self),
                            () => [self._anvil.pagination.rowsDisplayed, self._anvil.pagination.stoppedAt, self._anvil.pagination.done]
                        );
                    } else {
                        return [self._anvil.pagination.rowsDisplayed, self._anvil.pagination.stoppedAt, self._anvil.pagination.done];
                    }
                },
                r => {
                    self._anvil.element.removeClass("paginating");
                    return Sk.misceval.chain(
                        null,
                        () => {
                            if (self._anvil.onPage) return self._anvil.pyHiddenContainer._anvil.addedToPage();
                        },
                        () => r
                    );
                },
            );
        }

        let repaginateWithParent = function(self) {
            let parent = self._anvil.parent && self._anvil.parent.pyObj;
            if (parent && parent._anvil.paginate) {

                return Sk.misceval.chain(self._anvil.paginate(),
                    ([rows, stoppedAt, done]) => {
                        return parent._anvil.paginate(self);
                    },
                );
            } else {
                return paginate(self);
            }
        };

        let lockingCall = (self, fn) => {
            if (self._inDesigner) {
                // We don't care about thread-safe-ness in the designer.
                return fn()
            } else {
                if (!self._anvil.lock) 
                    self._anvil.lock = Promise.resolve();
                self._anvil.lock = self._anvil.lock.then(() => PyDefUtils.asyncToPromise(fn, true));
                return PyDefUtils.suspensionFromPromise(self._anvil.lock);
            }
        }

        let setItemTemplate = (s, e, v) => {

            if (!v || v == Sk.builtin.none.none$) {
                s._anvil.templateFormName = "";
                s._anvil.formConstructor = undefined;
            } else if (v.ob$type && Sk.builtin.isinstance(v, Sk.builtin.str).v) { // Ideally, we would check for isinstance(anvil.Component), but anvil.Component is magically different in dependencies...
                v = Sk.ffi.remapToJs(v);

                s._anvil.templateFormName = v;
                s._anvil.formConstructor = undefined;

                if (s._inDesigner) {
                    s._inDesigner.refreshForm();
                    return;
                }

                s._anvil.missingDependency = false;
                if (v) {
                    let [, depId, className] = v.match(/^(?:([^:]*):)?([^:]*)$/) || [];
                    depId = depId || s._anvil.depId;
                    if (depId) {
                        var dep = window.anvilAppDependencies[depId];
                        if (!dep) {
                            console.error("Dependency not found when setting RepeatingPanel template: " + depId);
                            s._anvil.missingDependency = true;
                            return;
                        }
                    }
                    var qualifiedFormName = depId ? `${dep.package_name}.${className}` : `${window.anvilAppMainPackage}.${className}`;
                    return Sk.misceval.chain(
                        Sk.misceval.tryCatch(function() {

                            return Sk.misceval.chain(
                                Sk.importModule(qualifiedFormName, undefined, true),
                                function() {

                                    let dots = qualifiedFormName.split(".").slice(1);
                                    let className = dots[dots.length-1];

                                    let pyFormMod = Sk.sysmodules.mp$subscript(new Sk.builtin.str(qualifiedFormName));
                                    let pyFormClass = pyFormMod && pyFormMod.tp$getattr(new Sk.builtin.str(className));

                                    s._anvil.formConstructor = pyFormClass;
                                });
                        }, function(e) {
                            console.error(e);
                            if(window.onerror) { window.onerror(undefined, undefined, undefined, undefined, e); }
                        }),
                        () => repaginateWithParent(s)
                    );
                }

            } else {
                s._anvil.templateFormName = "";
                s._anvil.formConstructor = v;
                return repaginateWithParent(s);
            }
        }

        let setItems = (s,e,v) => {
            if (!v || v == Sk.builtin.none.none$) {
                s._anvil.pyIterator = Sk.abstr.iter(new Sk.builtin.list([]));
            } else {
                s._anvil.pyIterator = Sk.abstr.iter(v);
            }
            delete s._anvil.itemCache;
            s._anvil.itemsCounter++;

            return repaginateWithParent(s);
        }

        /*!componentProp(RepeatingPanel)!1*/
        properties.push({name: "item_template",
            type: "form",
            defaultValue: "",
            exampleValue: "Form1",
            description: "The name of the form to repeat for every item",
            pyVal: true,
            set: (s,e,v) => lockingCall(s, () => setItemTemplate(s,e,v)),
        });

        /*!componentProp(RepeatingPanel)!1*/
        properties.push({name: "items", type: "object",
            pyVal: true,
            defaultValue: Sk.builtin.none.none$,
            //exampleValue: "XXX TODO",
            suggested: true,
            description: "A list of items for which the 'item_template' will be instantiated.",
            set: (s,e,v) => lockingCall(s, () => setItems(s,e,v)),
        });

        $loc["__init__"] = PyDefUtils.mkInit(function init(self) {

            self._anvil.element = $('<div class="component-namespace repeating-panel"></div>');
            self._anvil.itemsElement = $('<div>').addClass("hide-while-paginating").appendTo(self._anvil.element);

            self._anvil.pyHiddenContainer = Sk.misceval.callsim(pyModule["Container"]);
            self._anvil.pyHiddenContainer._anvil.overrideParentObj = self;
            self._anvil.pageEvents = {
                add: () => { self._anvil.pyHiddenContainer._anvil.parent = self._anvil.parent; return self._anvil.pyHiddenContainer._anvil.addedToPage(); },
                remove: () => { return self._anvil.pyHiddenContainer._anvil.removedFromPage(); },
                show: () => { return self._anvil.pyHiddenContainer._anvil.shownOnPage(); },
            };

            self._anvil.dataBindingProp = "items";

            self._anvil.depId = (componentsModule.newPythonComponent.dependencyTrace &&
                                 componentsModule.newPythonComponent.dependencyTrace.depId);

            self._anvil.pagination = {
                startAfter: null,
                rowQuota: Infinity,
            }
            self._anvil.itemsCounter = 0;
            self._anvil.lastPagination = [];
            self._anvil.paginate = paginate.bind(self, self);

        }, pyModule, $loc, properties, PyDefUtils.assembleGroupEvents("RepeatingPanel", /*!componentEvents(RepeatingPanel)!1*/["universal"]), pyModule["Component"]);

        /*!defMethod(_)!2*/ "Get the list of components created by this Repeating Panel. Each will be an instance of 'item_template', one for each item in 'items'."
        $loc["get_components"] = new Sk.builtin.func(function(self) {
            return Sk.misceval.callsim(self._anvil.pyHiddenContainer.tp$getattr(new Sk.builtin.str("get_components")));
        });

        /*!defMethod(,event_name,**event_args)!2*/ "Trigger the 'event_name' event on all children of this component. Any keyword arguments are passed to the handler function."
        $loc["raise_event_on_children"] = new Sk.builtin.func(PyDefUtils.withRawKwargs(function(eventArgs, self, pyEventName) {
            return Sk.misceval.callOrSuspend(self._anvil.pyHiddenContainer.tp$getattr(new Sk.builtin.str("raise_event_on_children")), undefined, undefined, eventArgs, pyEventName);
        }));

        $loc["__serialize__"] = PyDefUtils.mkSerializePreservingIdentity((self) => {
            let v = [];
            for (let n in self._anvil.props) {
                v.push(new Sk.builtin.str(n), self._anvil.props[n]);
            }
            v.push(new Sk.builtin.str("_dep_id"), Sk.ffi.remapToPy(self._anvil.depId || null));
            return new Sk.builtin.dict(v);
        });

        $loc["__new_deserialized__"] = PyDefUtils.mkNewDeserializedPreservingIdentity((self, pyData) => {
            let pop = pyData.tp$getattr(new Sk.builtin.str("pop"));
            self._anvil.depId = Sk.misceval.callsim(pop, new Sk.builtin.str("_dep_id"), Sk.builtin.none.none$).v;
            PyDefUtils.setAttrsFromDict(self, pyData);
        });

    }, /*!defClass(anvil,RepeatingPanel,Component)!*/ 'RepeatingPanel', [pyModule["Component"]]);
};

/*
 * TO TEST:
 *
 *  - Prop groups: layout, text, appearance
 *  - Override set: text
 *  - Event groups: universal
 *
 */
