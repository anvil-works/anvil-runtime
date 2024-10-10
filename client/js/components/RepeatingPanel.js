"use strict";

import { getCssPrefix } from "@runtime/runner/legacy-features";
import { chainOrSuspend, pyCallOrSuspend, pyFalse, pyNone, pyStr, pyTrue } from "@Sk";
import {getFormInstantiator} from "../runner/instantiation";
import { notifyComponentMounted } from "./Component";
import { Mutex } from "@runtime/runner/py-util";

/*#
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
  Let's say you want to refresh the entire RepeatingPanel when a button is clicked in the template form - you could use `add_event_handler` to bind an event called `x-refresh-panel` to the RepeatingPanel, then call `self.parent.raise_event('x-refresh')`.

  ```python
  self.repeating_panel_1.items = app_tables.people.search()
  ```
  A common use of RepeatingPanels is to create a table, with one row for each row in a data table.
  For example, if you had a table called 'people' with columns 'name' and 'age', you could drop two labels into the RepeatingPanel and assign the `text` of the first label to `self.item['name']` and the `text` of the second label to `self.item['age']`.
  The labels in each row line up, causing a column effect. To create column headers, you can drop a ColumnPanel above the RepeatingPanel and put labels in as appropriate.

  ![Screenshot](img/screenshots/repeating-panel-table.png)

*/

var PyDefUtils = require("PyDefUtils");
const { pyCall } = require("../PyDefUtils");

module.exports = (pyModule, componentsModule) => {

    const { checkNone, checkString } = Sk.builtin;
    const { isTrue } = Sk.misceval;


    pyModule["RepeatingPanel"] = PyDefUtils.mkComponentCls(pyModule, "RepeatingPanel", {
        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(RepeatingPanel)!2*/ ["appearance", "layout", "layout_margin", "tooltip", "user data"], {
            item_template: /*!componentProp(RepeatingPanel)!1*/ {
                name: "item_template",
                type: "form",
                defaultValue: Sk.builtin.none.none$,
                exampleValue: "Form1",
                description: "The name of the form to repeat for every item",
                pyVal: true,
                set(s, e, v) {
                    return lockingCall(s, () => (window.anvilRuntimeVersion === 2) ? setItemTemplateV2(s, e, v) : setItemTemplateV3(s, v));
                },
                important: true,
            },

            items: /*!componentProp(RepeatingPanel)!1*/ {
                name: "items",
                type: "object",
                pyVal: true,
                defaultValue: Sk.builtin.none.none$,
                dataBindingProp: true,
                //exampleValue: "XXX TODO",
                suggested: true,
                description: "A list of items for which the 'item_template' will be instantiated.",
                set(s, e, v) {
                    return lockingCall(s, () => setItems(s, e, v));
                },
            },
        }),

        events: PyDefUtils.assembleGroupEvents("RepeatingPanel", /*!componentEvents(RepeatingPanel)!1*/ ["universal"]),

        element: (props) => { 
            const prefix = getCssPrefix();
            return (
                <PyDefUtils.OuterElement className={`anvil-designer-component-namespace ${prefix}repeating-panel` }{...props}>
                    <div refName="items" className={`${prefix}hide-while-paginating`}></div>
                </PyDefUtils.OuterElement>
            );
         },

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["ClassicComponent"], (self) => {
                // we use composition with Container to implement some basic Container functions
                self._anvil.itemsElement = $(self._anvil.elements.items);
                self._anvil.pyHiddenContainer = PyDefUtils.pyCall(pyModule["ClassicContainer"]);
                self._anvil.pyHiddenContainer._anvil.overrideParentObj = self;
                self._anvil.itemCache = [];
                self._anvil.componentCache = [];

                // Are we being instantiated from YAML? If so, remember which is "our" app package so we can import
                // from it when given ambiguous item_template strings.
                const dependencyTrace = componentsModule.newPythonComponent.dependencyTrace;
                if (dependencyTrace?.depId) {
                    // NB: window.anvilAppDependencies isn't defined in the (old) designer
                    self._anvil.defaultAppPackage = window.anvilAppDependencies?.[dependencyTrace.depId]?.package_name;
                }

                self._anvil.pagination = {
                    startAfter: null,
                    rowQuota: Infinity,
                };
                self._anvil.itemsCounter = 0;
                self._anvil.lastPagination = [];
                self._anvil.paginate = paginate.bind(self, self);

                return Sk.misceval.chain(
                    // can only set these now since we need the hidden Container to be defined
                    self._anvil.setProp("items", self._anvil.props["items"]),
                    () => self._anvil.setProp("item_template", self._anvil.props["item_template"])
                );
            });

            /*!defMethod(_)!2*/ "Get the list of components created by this Repeating Panel. Each will be an instance of 'item_template', one for each item in 'items'."
            $loc["get_components"] = new Sk.builtin.func(function get_components(self) {
                return PyDefUtils.pyCall(self._anvil.pyHiddenContainer.tp$getattr(new Sk.builtin.str("get_components")));
            });

            /*!defMethod(,event_name,**event_args)!2*/ "Trigger the 'event_name' event on all children of this component. Any keyword arguments are passed to the handler function."
            $loc["raise_event_on_children"] = PyDefUtils.funcFastCall(function raise_event_on_children(args, kwargs) {
                const [self, eventName] = args;
                return PyDefUtils.pyCallOrSuspend(self._anvil.pyHiddenContainer.tp$getattr(new Sk.builtin.str("raise_event_on_children")), [eventName], kwargs);
            });

            $loc["__serialize__"] = PyDefUtils.mkSerializePreservingIdentity((self) => {
                const v = [];
                Object.entries(self._anvil.props).forEach(([propName, propVal]) => {
                    v.push(new Sk.builtin.str(propName), propVal);
                });
                v.push(new Sk.builtin.str("_default_app_package"), Sk.ffi.toPy(self._anvil.defaultAppPackage ?? null));
                return new Sk.builtin.dict(v);
            });

            $loc["__new_deserialized__"] = PyDefUtils.mkNewDeserializedPreservingIdentity((self, pyData) => {
                const pop = pyData.tp$getattr(new Sk.builtin.str("pop"));
                self._anvil.defaultAppPackage = PyDefUtils.pyCall(pop, [new Sk.builtin.str("_default_app_package"), Sk.builtin.none.none$]).valueOf();
                PyDefUtils.setAttrsFromDict(self, pyData);
            });
        },
    });



    // Returning undefined means we've fallen off the end of the items iterator
    // Walks along the iterator of items and caches the item at each iteration
    const getItemAt = (self, idx) => {
        if (!self._anvil.pyIterator)
            return undefined;

        self._anvil.itemCache ??= [];
        // If we already have this item in the cache, return it.

        if (idx < self._anvil.itemCache.length)
            return self._anvil.itemCache[idx];

        // We don't already have it in the cache, so walk along the iterator until we do, then return that.

        return Sk.misceval.chain(Sk.misceval.iterFor(self._anvil.pyIterator, (pyItem, i) => {

                self._anvil.itemCache.push(pyItem);

                if (i >= idx)
                    return new Sk.misceval.Break();
                else 
                    return i + 1;
            }, /* i = */ self._anvil.itemCache.length),
            () => self._anvil.itemCache[idx],
        );
    };


    const removeAllTemplateInstancesAfter = (self, firstTemplateInstanceToRemove) => {
        if (checkNone(firstTemplateInstanceToRemove)) {
            return;
        }
        let removing = false;
        return Sk.misceval.iterArray(self._anvil.lastPagination, ([,,,templateInstance]) => {

            if (removing || templateInstance === firstTemplateInstanceToRemove) {
                removing = true;
                return PyDefUtils.pyCallOrSuspend(templateInstance.tp$getattr(new Sk.builtin.str("remove_from_parent")));
            }
        });
    }

    let paginate = (self, updatedChild=null) => {

        if (ANVIL_IN_DESIGNER) { return [0, null, true]; }

        const prefix = getCssPrefix();


        if (updatedChild?._anvil?.pagination) {
            const i = self._anvil.lastPagination.findIndex(([,,,templateInstance]) => templateInstance == updatedChild);
            self._anvil.lastPagination[i][1] = updatedChild._anvil.pagination.rowsDisplayed;

            if (self._anvil.pagination.startAfter && self._anvil.pagination.startAfter[0] === i) {
                // We currently start after this component. Update our idea of where *it* starts.
                self._anvil.pagination.startAfter[2] = updatedChild._anvil.pagination.startAfter;
            }
        }

        self._anvil.pagination.rowsDisplayed = 0;
        self._anvil.pagination.stoppedAt = null;
        self._anvil.pagination.done = true;


        const [stoppedIdx, itemsCounterWhenStopped, childStartAfter, childDone] = self._anvil.pagination.startAfter || [0, self._anvil.itemsCounter, null, false];
        let idx = stoppedIdx + (childDone === true ? 1 : 0);
        let idxOnPage = 0;

        const adder = pyModule["ClassicContainer"]._doAddComponent;
        const addComponent = (pyC) => {
            // pyC is always a new component so we can skip validateChild
            self._anvil.elements.items.appendChild(pyC._anvil.domNode);
            if (self._anvil.dataGrid && pyC._anvil) {
                pyC._anvil.dataGrid = self._anvil.dataGrid;
            } 
            return adder(self._anvil.pyHiddenContainer, pyC, {}, {isMounted: false});
        };

        if (!self._anvil.constructItemTemplate) {
            // We have no template. It's either none, or we failed to find one based on the name
            PyDefUtils.pyCall(self._anvil.pyHiddenContainer.tp$getattr(new Sk.builtin.str("clear")));
            if (self._anvil.templateFormName) {
                let message = "";
                if (self._anvil.missingDependency) {
                    message = "Dependency missing: ";
                }
                message += "No such form '" + self._anvil.templateFormName + "'";

                const pyC = PyDefUtils.pyCall(pyModule["InvalidComponent"], [], ["text", new Sk.builtin.str(message)]);
                return Sk.misceval.chain(addComponent(pyC), () => [0, null, true]);
            } else {
                // Form constructor is None - don't render anything.
                return [0, null, true];
            }
        }

        if (self._anvil.itemsCounter !== itemsCounterWhenStopped) {
            self._anvil.pagination.rowsDisplayed = 0;
            self._anvil.pagination.stoppedAt = null;
            self._anvil.pagination.done = "INVALID";
            return [self._anvil.pagination.rowsDisplayed, self._anvil.pagination.stoppedAt, self._anvil.pagination.done];
        }


        const currentPagination = [];
        currentPagination.pyIterator = self._anvil.pyIterator;
        currentPagination.constructItemTemplate = self._anvil.constructItemTemplate;

        self._anvil.element.addClass(prefix + "paginating");

        return Sk.misceval.chain(
            undefined,
            // remove components from the repeating panel
            () =>
                PyDefUtils.whileOrSuspend(
                    () => true,
                    () => {
                        // Work our way through all our components, removing until we find the starting point or run out.
                        let lp = self._anvil.lastPagination[0];
                        if (!lp) {
                            // We have run out of existing components.
                            return new Sk.misceval.Break();
                        }

                        const [currentItemIdx, currentItemRowsDisplayed, currentItemStartAfter, templateInstance] = lp;

                        const lastPagination = self._anvil.lastPagination;

                        if (
                            lastPagination.pyIterator === self._anvil.pyIterator &&
                            lastPagination.constructItemTemplate === self._anvil.constructItemTemplate
                        ) {
                            // We are still looking at the same iterator, so we might be able to keep something.

                            if (currentItemIdx === idx) {
                                // We have reached where we left off. Stop here.
                                return new Sk.misceval.Break();
                            }
                        }

                        // Remove this component and try the next.
                        self._anvil.lastPagination.shift();
                        return PyDefUtils.pyCallOrSuspend(templateInstance.tp$getattr(new Sk.builtin.str("remove_from_parent")));
                    }
                ),
            // Any components left at this point must start at the right index. They may need repaginating, depending on our new row quota and whether they were done.
            () =>
                PyDefUtils.whileOrSuspend(
                    () => true,
                    () => Sk.misceval.chain(getItemAt(self, idx), (pyItem) => {
                        const startAfterThisComponent = stoppedIdx === idx;

                        if (pyItem === undefined) {
                            // we've run out of items
                            idx++;
                            idxOnPage++;
                            return new Sk.misceval.Break();
                        }

                        if (self._anvil.pagination.rowsDisplayed >= self._anvil.pagination.rowQuota) {
                            self._anvil.pagination.done = false;
                            idx++;
                            idxOnPage++;
                            return new Sk.misceval.Break();
                        }

                        // If the item currently displayed on the page at this index is the right one, and used less than the row quota we have remaining, leave it there and move on.
                        // Otherwise, remove it (and all subsequent items) and recreate.
                        const [currentItemIdx, currentItemRowsDisplayed, currentItemStartAfter, templateInstance] = self._anvil.lastPagination[
                            idxOnPage
                        ] || [-1, 0, null, Sk.builtin.none.none$];

                        const chainFns = [];

                        if (currentItemIdx === idx) {
                            // We are already displaying the right item at this position. Repaginate it if necessary.
                            if (templateInstance._anvil?.pagination) {
                                if (
                                    currentItemRowsDisplayed <= self._anvil.pagination.rowQuota - self._anvil.pagination.rowsDisplayed &&
                                    templateInstance._anvil.pagination.done === true &&
                                    currentItemStartAfter === templateInstance._anvil.pagination.startAfter &&
                                    (!startAfterThisComponent || childStartAfter === templateInstance._anvil.pagination.startAfter)
                                ) {
                                    // This item displayed fewer rows than we have quota for now, and it was done. Move on, but update its new row quota, just in case it decides to expand.
                                    templateInstance._anvil.pagination.rowQuota =
                                        self._anvil.pagination.rowQuota - self._anvil.pagination.rowsDisplayed;
                                    self._anvil.pagination.rowsDisplayed += currentItemRowsDisplayed;
                                    self._anvil.pagination.stoppedAt = [
                                        idx,
                                        self._anvil.itemsCounter,
                                        templateInstance._anvil.pagination.stoppedAt,
                                        templateInstance._anvil.pagination.done,
                                    ];
                                    if (templateInstance._anvil.pagination.done === "INVALID") {
                                        self._anvil.pagination.done = "INVALID";
                                    } else {
                                        self._anvil.pagination.done = self._anvil.pagination.done === true && templateInstance._anvil.pagination.done;
                                    }
                                    currentPagination.push([idx, currentItemRowsDisplayed, currentItemStartAfter, templateInstance]);
                                } else {
                                    // We need to repaginate this item. It either wasn't done (previously ran out of quota) or was done but used too many rows for our new quota.
                                    templateInstance._anvil.pagination.rowQuota =
                                        self._anvil.pagination.rowQuota - self._anvil.pagination.rowsDisplayed;
                                    if (startAfterThisComponent) {
                                        templateInstance._anvil.pagination.startAfter = childStartAfter;
                                    }
                                    chainFns.push(() => templateInstance._anvil.paginate());
                                    chainFns.push(([rows, stoppedAt, done]) => {
                                        self._anvil.pagination.rowsDisplayed += rows;
                                        self._anvil.pagination.stoppedAt = [idx, self._anvil.itemsCounter, stoppedAt, done];
                                        if (done === "INVALID") {
                                            self._anvil.pagination.done = "INVALID";
                                        } else {
                                            self._anvil.pagination.done = self._anvil.pagination.done === true && done;
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
                            chainFns.push(
                                () => {
                                    if (!self._anvil.componentCache) {
                                        self._anvil.componentCache = [];
                                    }
                                    const componentCache = self._anvil.componentCache.slice(0);
                                    if (idx < componentCache.length) {
                                        return componentCache[idx];
                                    }
                                    return Sk.misceval.chain(self._anvil.constructItemTemplate(pyItem), (component) => {
                                            self._anvil.componentCache.push(component);
                                            return component;
                                    });
                                },
                                (pyComponent) => {
                                    return Sk.misceval.chain(addComponent(pyComponent), () => {
                                        if (pyComponent._anvil?.paginate) {
                                            pyComponent._anvil.pagination = {
                                                startAfter: startAfterThisComponent ? childStartAfter : null,
                                                rowQuota: self._anvil.pagination.rowQuota - self._anvil.pagination.rowsDisplayed,
                                            };
                                            return Sk.misceval.chain(pyComponent._anvil.paginate(), ([rowsDisplayed, stoppedAt, done]) => {
                                                self._anvil.pagination.rowsDisplayed += rowsDisplayed;
                                                self._anvil.pagination.stoppedAt = [idx, self._anvil.itemsCounter, stoppedAt, done];
                                                if (done === "INVALID") {
                                                    self._anvil.pagination.done = "INVALID";
                                                } else {
                                                    self._anvil.pagination.done = self._anvil.pagination.done === true && done;
                                                }

                                                currentPagination.push([
                                                    idx,
                                                    rowsDisplayed,
                                                    startAfterThisComponent ? childStartAfter : null,
                                                    pyComponent,
                                                ]);
                                            });
                                        } else {
                                            currentPagination.push([idx, 0, null, pyComponent]);
                                        }
                                    });
                                }
                            );
                        }

                        chainFns.push(() => {
                            idx++;
                            idxOnPage++;
                        });

                        return Sk.misceval.chain(undefined, ...chainFns);
                    })
                ),
            () => {
                // We've now displayed all the rows we have quota for. It may be that all of them matched the cache, in which case there may be remaining rows displayed that we don't have quota for. Remove them.
                if (self._anvil.lastPagination.length >= idxOnPage) {
                    // There are left-over rows that we no-longer have quota for.
                    return removeAllTemplateInstancesAfter(self, self._anvil.lastPagination[idxOnPage - 1][3]);
                }
            },
            () => {
                self._anvil.lastPagination = currentPagination;

                if (PyDefUtils.logPagination)
                    console.log(
                        "RepeatingPanel displayed",
                        self._anvil.pagination.rowsDisplayed,
                        "rows.",
                        self._anvil.pagination.done ? "Done" : "Interrupted",
                        "at",
                        self._anvil.pagination.stoppedAt
                    );
                if (PyDefUtils.logPagination) console.groupEnd();
            },
            () => {
                const parent = self._anvil.parent?.pyObj;
                if (updatedChild?._anvil?.pagination && parent?._anvil?.paginate) {
                    return Sk.misceval.chain(parent._anvil.paginate(self), () => [
                        self._anvil.pagination.rowsDisplayed,
                        self._anvil.pagination.stoppedAt,
                        self._anvil.pagination.done,
                    ]);
                } else {
                    return [self._anvil.pagination.rowsDisplayed, self._anvil.pagination.stoppedAt, self._anvil.pagination.done];
                }
            },
            (r) => {
                self._anvil.element.removeClass(prefix + "paginating");
                return Sk.misceval.chain(
                    null,
                    () => {
                        const fns = self._anvil.pyHiddenContainer._anvil.components.map(
                            ({ component: c }) =>
                                () =>
                                    notifyComponentMounted(c)
                        );
                        return chainOrSuspend(pyNone, ...fns);
                    },
                    () => r
                );
            }
        );
    }

    const repaginateWithParent = (self) => {
        const parent = self._anvil.parent?.pyObj;
        if (parent?._anvil?.paginate) {
            return Sk.misceval.chain(self._anvil.paginate(), ([rows, stoppedAt, done]) => {
                return parent._anvil.paginate(self);
            });
        } else {
            return paginate(self);
        }
    };

    const lockingCall = (self, fn) => {
        if (ANVIL_IN_DESIGNER) {
            // We don't care about thread-safe-ness in the designer.
            return fn();
        } else {
            self._anvil.componentCache = [];
            self._anvil.mutex ??= new Mutex();
            return self._anvil.mutex.runWithLock(fn);
        }
    };


    // either the template is None, an empty str, a str, or Component
    // assign the templateFormName, constructItemTemplate and calls repaginate
    const setItemTemplateV2 = (s, e, v) => {
        if (!isTrue(v)) {
            s._anvil.templateFormName = "";
            s._anvil.constructItemTemplate = undefined;
            return repaginateWithParent(s);
        } else if (checkString(v)) { // Ideally, we would check for isinstance(anvil.Component), but anvil.Component is magically different in dependencies...
            v = v.toString();

            s._anvil.templateFormName = v;
            s._anvil.constructItemTemplate = undefined;

            if (ANVIL_IN_DESIGNER) {
                Sk.misceval.callsim(s.tp$getattr(new Sk.builtin.str("_refresh_form")));
                return;
            }

            s._anvil.missingDependency = false;

            let [, logicalDepId, className] = v.match(/^(?:([^:]*):)?([^:]*)$/) || [];
            const depId = logicalDepId ? window.anvilAppDependencyIds[logicalDepId] : null;
            const appPackage = depId ? window.anvilAppDependencies[depId]?.package_name : (s._anvil.defaultAppPackage || window.anvilAppMainPackage);
            if (logicalDepId && (!depId || !appPackage)) {
                console.error("Dependency not found when setting RepeatingPanel template: ", logicalDepId, "->", depId, "->", appPackage);
                s._anvil.missingDependency = true;
                return;
            }
            const qualifiedFormName = `${appPackage}.${className}`;
            return Sk.misceval.chain(
                Sk.misceval.tryCatch(
                    () =>
                        Sk.misceval.chain(Sk.importModule(qualifiedFormName, undefined, true), () => {
                            const dots = qualifiedFormName.split(".").slice(1);
                            const className = dots[dots.length - 1];

                            const pyFormMod = Sk.sysmodules.mp$subscript(new Sk.builtin.str(qualifiedFormName));
                            const pyFormClass = pyFormMod && pyFormMod.tp$getattr(new Sk.builtin.str(className));

                            s._anvil.constructItemTemplate = (pyItem) => Sk.misceval.callsimOrSuspendArray(pyFormClass, [], ["item", pyItem]);
                        }),
                    function catchErr(e) {
                        console.error(e);
                        if (window.onerror) {
                            window.onerror(undefined, undefined, undefined, undefined, e);
                        }
                    }
                ),
                () => repaginateWithParent(s)
            );
        } else {
            s._anvil.templateFormName = "";
            s._anvil.constructItemTemplate = (pyItem) => Sk.misceval.callsimOrSuspendArray(v, [], ["item", pyItem]);
            return repaginateWithParent(s);
        }
    };

    // v3 runtime has a much nicer way of dealing with this
    const setItemTemplateV3 = (self, template) => {
        self._anvil.templateFormName = Sk.builtin.checkString(template) ? template.toString() : "";
        self._anvil.constructItemTemplate = undefined;
        return Sk.misceval.chain(
            Sk.misceval.tryCatch(() => Sk.misceval.chain(
                getFormInstantiator({requestingComponent: self}, template),
                instantiate => {
                    console.log("Got instantiator:", instantiate);
                    self._anvil.constructItemTemplate = pyItem => instantiate(["item", pyItem]);
                }
            ), (err) => {
                console.error(err);
                if (window.onerror) {
                    window.onerror(undefined, undefined, undefined, undefined, err);
                }
            }),
            () => repaginateWithParent(self)
        );
    };

    const setItems = (s, e, v) => {
        s._anvil.itemsCounter++;
        s._anvil.itemCache = [];
        if (checkNone(v)) {
            s._anvil.pyIterator = Sk.abstr.iter(new Sk.builtin.list([]));
        } else {
            s._anvil.pyIterator = Sk.abstr.iter(v);
        }
        return repaginateWithParent(s);
    };


};
/*!defClass(anvil,RepeatingPanel,Component)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout, text, appearance
 *  - Override set: text
 *  - Event groups: universal
 *
 */
