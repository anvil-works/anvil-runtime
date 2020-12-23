"use strict";

var PyDefUtils = require("PyDefUtils");

/* This file defines the system components available to apps, as Python classes.
   These are the runtime (non-designer) versions. */

// Each component is a Skulpt class, implemented in Javascript.
// A component has a anvil_get_html_element() method, which
// returns a jquery object representing a detached div containing
// the object.
// A lot of the containers, however, make assumptions about pyComponent._anvil.element
// being present. They shouldn't.


/**
id: component_list
docs_url: /docs/client/components/basic
title: Basic components
description: |
  This is a list of the basic components available in Anvil.

  To see the available properties and events of each component, create one in the
  designer and examine it in the property table. (Hover your mouse over the
  name of each property or event for more information.)

lineBetweenIncludes: true
includes: [button, label, link, checkbox, radiobutton, dropdown, datepicker, textbox, textarea, timer, spacer, image, fileloader, googlemap, plot, youtubevideo, canvas, repeatingpanel]
*/


// This function defines the system components in the Skulpt Python module
// provided as its argument
module.exports.defineSystemComponents = function defineSystemComponents(pyModule) {

    pyModule["ComponentProperty"] = Sk.misceval.buildClass(pyModule, ($gbl, $loc) => {

        $loc["__init__"] = new Sk.builtin.func((self, name) => {
            self._anvil = { propName: name };
        });

        $loc["__get__"] = new Sk.builtin.func( (self, obj, type) => {
            return obj == Sk.builtin.none.none$ ? self :obj._anvil.getProp(self._anvil.propName);
        });

        $loc["__set__"] = new Sk.builtin.func( (self, obj, pyVal) => {
            return obj._anvil.setProp(self._anvil.propName, pyVal);
        });

    }, "ComponentProperty", []);

    pyModule["CustomComponentProperty"] = Sk.misceval.buildClass(pyModule, ($gbl, $loc) => {

        $loc["__init__"] = new Sk.builtin.func((self, name, defaultPyValue) => {
            self._anvil = { 
                propName: name, // N.B. We don't use name for anything right now.
                defaultPyVal: defaultPyValue,
            };
        });

        $loc["__get__"] = new Sk.builtin.func( (self, obj, type) => {
            if (!obj || obj === Sk.builtin.none.none$)
              return self;

            return (obj._anvil.customProps && obj._anvil.customProps[self._anvil.propName]) || self._anvil.defaultPyVal;
        });

        $loc["__set__"] = new Sk.builtin.func( (self, obj, pyVal) => {
            if (!obj || obj === Sk.builtin.none.none$) {
                throw new Error("Cannot set custom component property value on null object.");
            }
            obj._anvil.customProps = obj._anvil.customProps || {};
            obj._anvil.customProps[self._anvil.propName] = pyVal;
        });

    }, "CustomComponentProperty", []);

    pyModule["Paginator"] = Sk.misceval.buildClass(pyModule, ($gbl, $loc) => {
        // TODO: Add .anvil-paginator to component element here rather than in each component.

        let getRowQuota = self => {
            let rows = self._anvil && self._anvil.getPropJS && self._anvil.getPropJS("rows_per_page");
            if (rows && rows > 0) {
                return rows;
            } else {
                return Infinity;
            }
        };

        $loc["__init__"] = new Sk.builtin.func(self => {
            self._anvil.pagination = {
                startAfter: null,
                rowQuota: getRowQuota(self),
            }

            self._anvil.updatePaginationControls = () => {
                self._anvil.element.find(".previous-page,.first-page").toggleClass("disabled", !self._anvil.paginatorPages || self._anvil.paginatorPages.length < 2);
                self._anvil.element.find(".next-page,.last-page").toggleClass("disabled", self._anvil.pagination.done == true);
            }
        })

        $loc["jump_to_first_page"] = new Sk.builtin.func(self => {
            if (self._anvil.repaginating) 
                return Sk.builtin.none.none$;
            self._anvil.repaginating = true;
            self._anvil.pagination = {
                startAfter: null,
                rowQuota: getRowQuota(self)
            }
            delete self._anvil.lastChildPagination;
            return Sk.misceval.chain(self._anvil.paginate(),
                ([rows, stoppedAt, done]) => {
                    self._anvil.paginatorPages = [{
                        startedAfter: null,
                        stoppedAt: stoppedAt,
                        done: done,
                        rowsDisplayed: rows,
                        currentPage: 0,
                        currentIndex: 0,
                    }];
                    self._anvil.repaginating = false;
                    self._anvil.updatePaginationControls();
                    return Sk.builtin.none.none$;
                }
            );
        });

        $loc["jump_to_last_page"] = new Sk.builtin.func(self => {
            if (self._anvil.repaginating) 
                return;
            self._anvil.repaginating = true;
            return Sk.misceval.chain(PyDefUtils.whileOrSuspend(
                    () => !(self._anvil.paginatorPages && self._anvil.paginatorPages.length > 0 && self._anvil.paginatorPages[self._anvil.paginatorPages.length-1].done), 
                    () => Sk.misceval.chain(undefined,
                        () => { self._anvil.repaginating = false },
                        () => Sk.misceval.callsimOrSuspend(self.tp$getattr(new Sk.builtin.str("next_page"))),
                        () => { self._anvil.repaginating = true },
                    ),
                ),
                () => {
                    self._anvil.repaginating = false; 
                    return Sk.builtin.none.none$
                },
            );
        });
        
        $loc["next_page"] = new Sk.builtin.func(self => {
            if (self._anvil.repaginating) 
                return;

            let p = self._anvil.paginatorPages && self._anvil.paginatorPages[self._anvil.paginatorPages.length - 1];
            if (p && !p.done) {
                self._anvil.repaginating = true
                self._anvil.pagination = {
                    startAfter: p.stoppedAt,
                    rowQuota: getRowQuota(self),
                }
                let newPage = {};
                self._anvil.paginatorPages.push(newPage);
                return Sk.misceval.chain(self._anvil.paginate(),
                    ([rows, stoppedAt, done]) => {

                        newPage.startedAfter = p.stoppedAt;
                        newPage.rowsDisplayed = rows;
                        newPage.stoppedAt = stoppedAt;
                        newPage.done = done;
                        newPage.currentPage = p.currentPage + 1;
                        newPage.currentIndex = p.currentIndex + rows;

                        self._anvil.repaginating = false;
                        self._anvil.updatePaginationControls();
                    }
                );
            }
        });

        $loc["previous_page"] = new Sk.builtin.func(self => {
            if (self._anvil.repaginating) 
                return;

            let p = self._anvil.paginatorPages && self._anvil.paginatorPages[self._anvil.paginatorPages.length - 2];
            if (p && !p.done) {
                self._anvil.repaginating = true
                self._anvil.pagination = {
                    startAfter: p.startedAfter,
                    rowQuota: getRowQuota(self),
                }
                self._anvil.paginatorPages.pop();
                return Sk.misceval.chain(self._anvil.paginate(),
                    ([rows, stoppedAt, done]) => {
                        self._anvil.repaginating = false;
                        self._anvil.updatePaginationControls();
                    }
                );
            }
        });

        $loc["get_page"] = new Sk.builtin.func(self => {
            let p = self._anvil.paginatorPages && self._anvil.paginatorPages[self._anvil.paginatorPages.length - 1];
            if (p) {
                return Sk.ffi.remapToPy(p.currentPage);
            }
        });

        $loc["get_first_index_on_page"] = new Sk.builtin.func(self => {
            let p = self._anvil.paginatorPages && self._anvil.paginatorPages[self._anvil.paginatorPages.length - 1];
            if (p) {
                return Sk.ffi.remapToPy(p.currentIndex);
            }
        });

        $loc["set_page"] = new Sk.builtin.func((self, page) => {
            page = parseInt(Sk.ffi.remapToJs(page));

            let closestPageBefore = self._anvil.paginatorPages && self._anvil.paginatorPages[Math.min(page, self._anvil.paginatorPages.length-1)];
            let fns = [];
            let startPage = 0;
            if (closestPageBefore) {
                startPage = closestPageBefore.currentPage;
                self._anvil.paginatorPages = self._anvil.paginatorPages.slice(0,startPage+1);

                fns.push(() => {
                    self._anvil.pagination = {
                        startAfter: closestPageBefore.startedAfter,
                        rowQuota: getRowQuota(self),
                    }
                    return self._anvil.paginate()
                });
            }

            for (let p = startPage; p < page; p++) {
                fns.push(() => Sk.misceval.callsimOrSuspend(self.tp$getattr(new Sk.builtin.str("next_page"))))
            }

            return Sk.misceval.chain(...fns);
        });

        $loc["repaginate"] = new Sk.builtin.func(self => {
            if (self._anvil.paginatorPages && self._anvil.paginatorPages.length > 1) {
                if (self._anvil.repaginating) 
                    return;
                let p = self._anvil.paginatorPages && self._anvil.paginatorPages[self._anvil.paginatorPages.length - 1];
                if (p && !p.done) {
                    self._anvil.repaginating = true
                    self._anvil.pagination = {
                        startAfter: p.startedAfter,
                        rowQuota: getRowQuota(self),
                    }
                    return Sk.misceval.chain(self._anvil.paginate(),
                        ([rows, stoppedAt, done]) => {
                            self._anvil.paginatorPages.splice(self._anvil.paginatorPages.length - 1, 1, {
                                startedAfter: p.startedAfter,
                                rowsDisplayed: rows,
                                stoppedAt: stoppedAt,
                                done: done,
                                currentPage: p.currentPage,
                                currentIndex: p.currentIndex,
                            });
                            self._anvil.repaginating = false;
                            self._anvil.updatePaginationControls();
                        }
                    );
                }

            } else {
                return Sk.misceval.callsimOrSuspend(self.tp$getattr(new Sk.builtin.str("jump_to_first_page")));
            }
        });


    }, "Paginator", []);


    require("./components/Component")(pyModule);

    require("./components/Spacer")(pyModule);

    require("./components/Label")(pyModule);

    require("./components/Button")(pyModule);

    require("./components/CheckBox")(pyModule);

    require("./components/RadioButton")(pyModule);

    require("./components/DropDown")(pyModule);

    require("./components/DatePicker")(pyModule);

    require("./components/TextBox")(pyModule);

    require("./components/TextArea")(pyModule);

    require("./components/Timer")(pyModule);

    require("./components/Canvas")(pyModule);

    require("./components/SimpleCanvas")(pyModule);

    require("./components/Image")(pyModule);

    require("./components/YouTubeVideo")(pyModule);

    require("./components/FileLoader")(pyModule);

    require("./components/Container")(pyModule);

    if (window['google']) {
        require("./components/GoogleMap")(pyModule);
    } else {
        console.warn("Google unavailable, not loading GoogleMap component.");
    }

    require("./components/Plot")(pyModule);

    require("./components/LinearPanel")(pyModule);

    require("./components/RepeatingPanel")(pyModule, module.exports);

    require("./components/DataGrid")(pyModule, module.exports);

    require("./components/DataRowPanel")(pyModule, module.exports);

    require("./components/XYPanel")(pyModule);

    require("./components/GridPanel")(pyModule);

    require("./components/ColumnPanel")(pyModule);

    require("./components/HtmlPanel")(pyModule);

    require("./components/FlowPanel")(pyModule);

    require("./components/InvalidComponent")(pyModule);

    require("./components/Link")(pyModule);

}


var mkInvalidComponent = function(anvilMod, message) {
    return Sk.misceval.call(anvilMod["InvalidComponent"], undefined, undefined, [new Sk.builtin.str("text"), new Sk.builtin.str(message)]);
}

module.exports.withFormTrace = function(formName, f) {
    var newPythonComponent = module.exports.newPythonComponent;
    var formTrace = {name: formName, prev: newPythonComponent.formTrace};
    newPythonComponent.formTrace = formTrace;

    return Sk.misceval.tryCatch(function() {
        return Sk.misceval.chain(f(), function(r) {
            newPythonComponent.formTrace = formTrace.prev;
            return r;
        });
    }, function (e) {
        newPythonComponent.formTrace = formTrace.prev;
        throw e;
    });
};

module.exports.withDependencyTrace = (depId, f) => {
    let newPythonComponent = module.exports.newPythonComponent;
    let depTrace = {depId: depId, prev: newPythonComponent.dependencyTrace};
    newPythonComponent.dependencyTrace = depTrace;

    return Sk.misceval.tryCatch(function() {
        return Sk.misceval.chain(f(), function(r) {
            newPythonComponent.dependencyTrace = newPythonComponent.dependencyTrace.prev;
            return r;
        });
    }, function (e) {
        newPythonComponent.dependencyTrace = newPythonComponent.dependencyTrace.prev;
        throw e;
    });
}


// Create the Python object representing a component from its YAML
// definition. Registers all components by name in the
// componentsByName[] array
module.exports.newPythonComponent = function newPythonComponent(component, componentsByName, childrenByName, eventBindingsByName, formInstanceIndex, pyContainer, otherFormsSpec, dependencies, repeatingPanelInstanceIndex, dataBindings=undefined) {

    // Construct the component, passing on any YAML properties as kwargs.

    var anvilMod = PyDefUtils.getModule("anvil").$d;

    var kwa = [];
    for(var k in component.properties) {
        if (component.properties[k] === undefined)
            continue;

        kwa.push(k);
        kwa.push(Sk.ffi.remapToPy(component.properties[k]));
    }

    var pyComponent = undefined;

    component.type = component.type.replace(/MultiColumnPanel$/, "ColumnPanel");

    var m = component.type.match(/^form:(.*)$/);
    if (m) {
        // It's a custom component!
        let [, depId, formName, className] = m[1].match(/^(?:([^:]*):)?((?:.*\.)?([^\.]*))$/);
        let appPackageName = window.anvilAppMainPackage;

        depId = depId || (module.exports.newPythonComponent.dependencyTrace && module.exports.newPythonComponent.dependencyTrace.depId);

        if (depId) {
            let dep = dependencies[depId];
            if (!dep) {
                console.error("Dependency not found: "+ depId);
                pyComponent = mkInvalidComponent(anvilMod, "Dependency missing: No such form '" + formName + "'");
            } else {
                appPackageName = dep.package_name;
            }
        }
        let fullPackageName = appPackageName + "." + formName;
        let nested = false;
        for (var t = newPythonComponent.formTrace; t; t = t.prev) {
            if (t.name == fullPackageName) {
                nested = true;
                break;
            }
        }

        if (nested && !pyComponent) {
            pyComponent = mkInvalidComponent(anvilMod, "Cannot nest \""+fullPackageName+"\" inside itself");

        } else if (otherFormsSpec && !pyComponent) { // we've been given the skeletons, so don't look for the real things
            var formSpec = null;

            let forms = depId ? dependencies[depId].forms : otherFormsSpec;

            for (let fs of forms) {
                if (fs.class_name == formName) {
                    formSpec = fs;
                    break;
                }
            }

            if (!formSpec) {
                pyComponent = mkInvalidComponent(anvilMod, "No such form: \""+(depId ? fullPackageName : formName)+"\"");
            } else {
                let spec = $.extend({name: "", components: formSpec.components, layout_properties: component.layout_properties}, formSpec.container);

                let nestedComponentsByName = {};
                pyComponent = Sk.misceval.chain(
                    module.exports.withDependencyTrace(depId, () => 
                        module.exports.withFormTrace(fullPackageName, function() { return newPythonComponent(spec, nestedComponentsByName, {}, {}, formInstanceIndex, null, otherFormsSpec, dependencies, repeatingPanelInstanceIndex); })
                    ),
                    function (pyComponent) {
                        if (pyComponent._anvil.componentSpec.name != "") {
                            formInstanceIndex[fullPackageName] = formInstanceIndex[fullPackageName] || [];
                            formInstanceIndex[fullPackageName].push(pyComponent);
                        }
                        pyComponent._anvil.isForm = true;
                        pyComponent._anvil.customComponentForm = formSpec;
                        pyComponent._anvil.customPropVals = {};
                        for (let pt of formSpec.properties || []) {
                            pyComponent._anvil.customPropVals[pt.name] = pt.name in component.properties ? component.properties[pt.name] : pt.default_value;
                        }
                        pyComponent._anvil.dataBindingProp = "item";
                        pyComponent._anvil.componentsByName = nestedComponentsByName;
                        pyComponent._anvil.element.addClass("anvil-custom-component component-namespace namespace-region");
                        return pyComponent;
                    }
                );
            }

        } else if (!pyComponent) { // Instantiate custom component from the actual Python classes

            // TODO detect the "No such form: FormXYZ" error here
            // (an error from import could be anything; I think we'll have to check)
            // the app yaml. Or just accept the blowup on the console (you'll still
            // get a nice InvalidComponent in the designer.)

            pyComponent = Sk.misceval.chain(
                Sk.importModule(fullPackageName, false, true),
                function () {
                    let pyFormMod = Sk.sysmodules.mp$subscript(new Sk.builtin.str(fullPackageName));
                    let pyFormClass = pyFormMod && pyFormMod.tp$getattr(new Sk.builtin.str(className));
                    if (!pyFormMod) {
                        return mkInvalidComponent(anvilMod, "No such form: \""+(depId ? fullPackageName : formName)+"\"");
                    }
                    if (!pyFormClass) {
                        return mkInvalidComponent(anvilMod, Sk.builtin.repr(pyFormMod).$jsstr() + " does not contain a class called '" + className + "'");
                    }
                    return module.exports.withFormTrace(fullPackageName, function() {
                        let customComponentProperties = window.anvilCustomComponentProperties[depId + ":" + formName];
                        for(let pt of customComponentProperties || []) {
                            if (kwa.indexOf(pt.name) > -1) continue; // Don't overwrite properties that have actually been set.
                            if (pt.type == "object") continue; // Don't try to set "Set at runtime" object properties
                            kwa.push(pt.name);
                            kwa.push(Sk.ffi.remapToPy(pt.default_value));
                        }

                        return Sk.misceval.callOrSuspend(pyFormClass, undefined, undefined, kwa);
                    });
                }
            );
        }


    } else { // Not a custom component (therefore a built-in one)
        var cls = anvilMod["Design"+component.type] || anvilMod[component.type];

        if (!cls) {
            pyComponent = mkInvalidComponent(anvilMod, "No such component: \"" + component.type + "\"");
        } else {
            // Prepend a magic kwarg that tells this component to ignore property exceptions - these all came from the YAML (designer), so are not the user's fault.
            kwa = [new Sk.builtin.str("__ignore_property_exceptions"), true].concat(kwa);
            pyComponent = Sk.misceval.chain(
                Sk.misceval.callOrSuspend(cls, undefined, undefined, kwa),
                function (pyComponent) {


                    // Check whether we're a container. If we are, add any child components.
                    if (Sk.builtin.isinstance(pyComponent, anvilMod["Container"]).v) {

                        var fs = [null];

                        for(var i in component.components) {
                            fs.push(function(i) {
                                var child = component.components[i];

                                return Sk.misceval.chain(
                                    newPythonComponent(child, componentsByName, childrenByName, eventBindingsByName, formInstanceIndex, pyComponent, otherFormsSpec, dependencies, repeatingPanelInstanceIndex, dataBindings),
                                    function (pyChildComponent) {
                                        if (childrenByName) {
                                            childrenByName[component.name] = childrenByName[component.name] || [];
                                            childrenByName[component.name].push(pyChildComponent);
                                        }
                                    }
                                );
                            }.bind(null, i));
                        }

                        fs.push(function() { return pyComponent; });

                        return Sk.misceval.chain.apply(null, fs);

                    } else {
                        return pyComponent;
                    }
                }
            );
        }
    }


    // Do final setup
    return Sk.misceval.chain(pyComponent, function (pyComponent) {
            pyComponent._anvil.componentSpec = component;
            pyComponent._anvil.element.addClass("anvil-component");
            pyComponent._anvil.element.data("anvil-py-component", pyComponent);
            
            if (Sk.builtin.isinstance(pyComponent, anvilMod["RepeatingPanel"]).v && pyComponent._inDesigner) {
                pyComponent._anvil.dependencies = dependencies;
                pyComponent._anvil.forms = otherFormsSpec;
                pyComponent._anvil.formInstanceIndex = formInstanceIndex;
                pyComponent._anvil.parentForm = newPythonComponent.formTrace;
                pyComponent._inDesigner.refreshForm(repeatingPanelInstanceIndex)
            };

            if (pyComponent._anvil.updateDesignName) {
                pyComponent._anvil.designName = component.name;
                pyComponent._anvil.updateDesignName(pyComponent);
            }

            if (componentsByName)
                componentsByName[component.name] = pyComponent;

            if (eventBindingsByName)
                eventBindingsByName[component.name] = component.event_bindings;

            if (dataBindings) {
                for (var i in component.data_bindings) {
                    var binding = Object.create(component.data_bindings[i]);
                    binding.pyComponent = pyComponent;
                    binding.component_name = component.name;
                    dataBindings.push(binding);
                }
            }

            // Add this new component to the required container.
            if (pyContainer) {
                var pyAddComponent = Sk.abstr.gattr(pyContainer,new Sk.builtin.str("add_component"));

                var kwa = [];
                for (var k in component.layout_properties) {
                    var val = component.layout_properties[k];
                    if (val === undefined) { continue; }
                    kwa.push(k);
                    kwa.push(Sk.ffi.remapToPy(val));
                }

                Sk.misceval.call(pyAddComponent, undefined, undefined, kwa, pyComponent);
            }
            return pyComponent;
        }
    );
}

/*
 * TO TEST:
 *
 *  - Methods: open_form
 *  - Classes: Media, URLMedia, DataMedia, FileMedia
 *
 */
