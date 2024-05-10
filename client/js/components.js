"use strict";

const { anvilMod } = require("@runtime/runner/py-util");

/* This file defines the system components available to apps, as Python classes.
   These are the runtime (non-designer) versions. */

// Each component is a Skulpt class, implemented in Javascript.
// A component has a anvil_get_html_element() method, which
// returns a jquery object representing a detached div containing
// the object.
// A lot of the containers, however, make assumptions about pyComponent._anvil.element
// being present. They shouldn't.


/*#
id: component_list
docs_url: /docs/client/components/basic
title: Basic components
description: |
  This is a list of the basic components available in Anvil.

  To see the available properties and events of each component, create one in the
  designer and examine it in the property table. (Hover your mouse over the
  name of each property or event for more information.)

lineBetweenIncludes: true
includes: [button, label, richtext, link, checkbox, radiobutton, dropdown, datepicker, textbox, textarea, timer, spacer, image, fileloader, googlemap, plot, youtubevideo, canvas, repeatingpanel]
*/


// This function defines the system components in the Skulpt Python module
// provided as its argument
module.exports.defineSystemComponents = function defineSystemComponents(pyModule) {

    pyModule["ComponentProperty"] = Sk.misceval.buildClass(pyModule, ($gbl, $loc) => {

        $loc["__init__"] = new Sk.builtin.func((self, name) => {
            self._anvil = { propName: name };
        });

        $loc["__get__"] = new Sk.builtin.func( (self, obj, type) => {
            return obj === Sk.builtin.none.none$ ? self :obj._anvil.getProp(self._anvil.propName);
        });

        $loc["__set__"] = new Sk.builtin.func( (self, obj, pyVal) => {
            return obj._anvil.setProp(self._anvil.propName, pyVal);
        });

    }, "ComponentProperty", []);

    pyModule["CustomComponentProperty"] = Sk.misceval.buildClass(pyModule, ($gbl, $loc) => {

        $loc["__init__"] = new Sk.builtin.func((self, name, defaultPyValue) => {
            self._anvil = { 
                propName: String(name), // N.B. We don't use name for anything right now.
                defaultPyVal: defaultPyValue,
            };
        });

        $loc["__get__"] = new Sk.builtin.func( (self, obj, type) => {
            if (!obj || obj === Sk.builtin.none.none$)
              return self;

            return (obj.anvil$customProps?.[self._anvil.propName]) || self._anvil.defaultPyVal;
        });

        $loc["__set__"] = new Sk.builtin.func( (self, obj, pyVal) => {
            if (!obj || obj === Sk.builtin.none.none$) {
                throw new Error("Cannot set custom component property value on null object.");
            }
            obj.anvil$customProps ??= {};
            obj.anvil$customProps[self._anvil.propName] = pyVal;
            return Sk.builtin.none.none$;
        });

    }, "CustomComponentProperty", []);


    require("./components/ClassicComponent")(pyModule);

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

    require("./components/ClassicContainer")(pyModule);

    require("./components/RichText")(pyModule);

    if (!window.isIE) {
        require("./components/GoogleMap")(pyModule);
    } else {
        console.warn("Google Maps is no longer supported in Internet Explorer");
    }

    require("./components/Plot")(pyModule);

    require("./components/LinearPanel")(pyModule);

    require("./components/RepeatingPanel")(pyModule, module.exports);

    require("./components/Paginator")(pyModule);

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
    return Sk.misceval.callsimArray(anvilMod["InvalidComponent"], [], ["text", new Sk.builtin.str(message)]);
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
        let [, logicalDepId, formName, className] = m[1].match(/^(?:([^:]*):)?((?:.*\.)?([^.]*))$/);
        let depId = logicalDepId ? window.anvilAppDependencyIds[logicalDepId] : null;
        let appPackageName = window.anvilAppMainPackage;

        if (logicalDepId && !depId) {
            console.error("Logical dep ID " + logicalDepId + " not found");
            pyComponent = mkInvalidComponent(anvilMod, "Missing dependency for form '" + formName + "'");
        }

        depId = depId || module.exports.newPythonComponent.dependencyTrace?.depId;

        if (depId && !pyComponent) {
            let dep = dependencies[depId];
            if (!dep) {
                console.error("Dependency mapped but not found: " + depId + " (logical " + logicalDepId + ")");
                pyComponent = mkInvalidComponent(anvilMod, "Dependency missing for form '" + formName + "'");
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
                        pyComponent._anvil.element.addClass("anvil-custom-component anvil-designer-component-namespace anvil-designer-namespace-region");
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
        let cls;
        const designName = "Design"+component.type;
        if (designName in anvilMod) {
            cls = anvilMod[designName];
        } else if (component.type in anvilMod) {
            cls = anvilMod[component.type];
        }

        if (!cls) {
            pyComponent = mkInvalidComponent(anvilMod, "No such component: \"" + component.type + "\"");
        } else {
            // Prepend a magic kwarg that tells this component to ignore property exceptions - these all came from the YAML (designer), so are not the user's fault.
            kwa = ["__ignore_property_exceptions", true].concat(kwa);
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
            
            if (Sk.builtin.isinstance(pyComponent, anvilMod["RepeatingPanel"]).v && ANVIL_IN_DESIGNER) {
                pyComponent._anvil.dependencies = dependencies;
                pyComponent._anvil.forms = otherFormsSpec;
                pyComponent._anvil.formInstanceIndex = formInstanceIndex;
                pyComponent._anvil.parentForm = newPythonComponent.formTrace;
                Sk.misceval.callsim(pyComponent.tp$getattr(new Sk.builtin.str("_refresh_form")), repeatingPanelInstanceIndex);
            }

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
