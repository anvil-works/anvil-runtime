"use strict";

import type { Kws, Suspension, pyCallable, pyNoneType, pyObject, pyType } from "@Sk";
import {
    buildPyClass,
    chainOrSuspend,
    isTrue,
    pyCall,
    pyCallOrSuspend,
    pyFunc,
    pyGetAttr,
    pyIsInstance,
    pyNone,
    pyRepr,
    pyStr,
    toPy,
    tryCatchOrSuspend,
} from "@Sk";
import { PyModMap, anvilMod, s_add_component } from "@runtime/runner/py-util";
import ButtonFactory from "./components/Button";
import CanvasFactory from "./components/Canvas";
import CheckBoxFactory from "./components/CheckBox";
import ClassicComponentFactory from "./components/ClassicComponent";
import ClassicContainerFactory from "./components/ClassicContainer";
import ColumnPanelFactory from "./components/ColumnPanel";
import DataGridFactory from "./components/DataGrid";
import DataRowPanelFactory from "./components/DataRowPanel";
import DatePickerFactory from "./components/DatePicker";
import DropDownFactory from "./components/DropDown";
import FileLoaderFactory from "./components/FileLoader";
import FlowPanelFactory from "./components/FlowPanel";
import GoogleMap from "./components/GoogleMap";
import GridPanelFactory from "./components/GridPanel";
import HtmlPanelFactory from "./components/HtmlPanel";
import ImageFactory from "./components/Image";
import InvalidComponentFactory from "./components/InvalidComponent";
import LabelFactory from "./components/Label";
import LinearPanelFactory from "./components/LinearPanel";
import LinkFactory from "./components/Link";
import PaginatorFactory from "./components/Paginator";
import PlotFactory from "./components/Plot";
import RadioButtonFactory from "./components/RadioButton";
import RepeatingPanelFactory from "./components/RepeatingPanel";
import RichTextFactory from "./components/RichText";
import SimpleCanvas from "./components/SimpleCanvas";
import SpacerFactory from "./components/Spacer";
import TextAreaFactory from "./components/TextArea";
import TextBoxFactory from "./components/TextBox";
import TimerFactory from "./components/Timer";
import XYPanelFactory from "./components/XYPanel";
import YouTubeVideoFactory from "./components/YouTubeVideo";

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
export function defineSystemComponents(pyModule: PyModMap) {
    pyModule["ComponentProperty"] = buildPyClass(
        pyModule,
        ($gbl, $loc) => {
            $loc["__init__"] = new pyFunc((self: pyObject, name: pyObject) => {
                self._anvil = { propName: name.toString() };
                return pyNone;
            });

            $loc["__get__"] = new pyFunc((self: pyObject, obj: pyObject, type: pyObject | pyNoneType) => {
                return obj === pyNone ? self : obj._anvil.getProp(self._anvil.propName);
            });

            $loc["__set__"] = new pyFunc((self: pyObject, obj: pyObject, pyVal: pyObject) => {
                return obj._anvil.setProp(self._anvil.propName, pyVal);
            });
        },
        "ComponentProperty",
        []
    );

    pyModule["CustomComponentProperty"] = buildPyClass(
        pyModule,
        ($gbl, $loc) => {
            $loc["__init__"] = new pyFunc((self: pyObject, name: pyObject, defaultPyValue: pyObject) => {
                self._anvil = {
                    propName: String(name), // N.B. We don't use name for anything right now.
                    defaultPyVal: defaultPyValue,
                };
                return pyNone;
            });

            $loc["__get__"] = new pyFunc((self: pyObject, obj?: pyObject, type?: pyObject) => {
                if (!obj || obj === pyNone) return self;

                return obj.anvil$customProps?.[self._anvil.propName] || self._anvil.defaultPyVal;
            });

            $loc["__set__"] = new pyFunc((self: pyObject, obj: pyObject | undefined, pyVal: pyObject) => {
                if (!obj || obj === pyNone) {
                    throw new Error("Cannot set custom component property value on null object.");
                }
                obj.anvil$customProps ??= {};
                obj.anvil$customProps[self._anvil.propName] = pyVal;
                return pyNone;
            });
        },
        "CustomComponentProperty",
        []
    );

    ClassicComponentFactory(pyModule);

    SpacerFactory(pyModule);

    LabelFactory(pyModule);

    ButtonFactory(pyModule);

    CheckBoxFactory(pyModule);

    RadioButtonFactory(pyModule);

    DropDownFactory(pyModule);

    DatePickerFactory(pyModule);

    TextBoxFactory(pyModule);

    TextAreaFactory(pyModule);

    TimerFactory(pyModule);

    CanvasFactory(pyModule);

    SimpleCanvas(pyModule);

    ImageFactory(pyModule);

    YouTubeVideoFactory(pyModule);

    FileLoaderFactory(pyModule);

    ClassicContainerFactory(pyModule);

    RichTextFactory(pyModule);

    if (!window.isIE) {
        GoogleMap(pyModule);
    } else {
        console.warn("Google Maps is no longer supported in Internet Explorer");
    }

    PlotFactory(pyModule);

    LinearPanelFactory(pyModule);

    RepeatingPanelFactory(pyModule, componentHelpers);

    PaginatorFactory(pyModule);

    DataGridFactory(pyModule);

    DataRowPanelFactory(pyModule);

    XYPanelFactory(pyModule);

    GridPanelFactory(pyModule);

    ColumnPanelFactory(pyModule);

    HtmlPanelFactory(pyModule);

    FlowPanelFactory(pyModule);

    InvalidComponentFactory(pyModule);

    LinkFactory(pyModule);
}

// Create helpers object for components that need legacy exports

const tracedNewPythonComponent = newPythonComponent as NewPythonComponentFn;

const componentHelpers = {
    defineSystemComponents,
    withFormTrace,
    withDependencyTrace,
    newPythonComponent: tracedNewPythonComponent,
};

export type ComponentHelpers = typeof componentHelpers;

type StringMap<T = unknown> = Record<string, T>;
type ComponentSpec = {
    name: string;
    type: string;
    properties: StringMap;
    layout_properties: StringMap;
    components: ComponentSpec[];
    event_bindings?: unknown;
    data_bindings: unknown[];
};
type FormSpec = {
    class_name: string;
    components: ComponentSpec[];
    container: ComponentSpec;
    properties?: { name: string; default_value: unknown }[];
};
type DependencySpec = { package_name: string; forms: FormSpec[] };
type FormTrace = { name: string; prev?: FormTrace };
type DependencyTrace = { depId: string | null; prev?: DependencyTrace };
type NewPythonComponentFn = typeof newPythonComponent & {
    formTrace?: FormTrace;
    dependencyTrace?: DependencyTrace;
};

const mkInvalidComponent = function (anvilMod: PyModMap, message: string) {
    return pyCall(anvilMod["InvalidComponent"], [], ["text", new pyStr(message)]);
};

export function withFormTrace(formName: string, f: () => pyObject | Suspension) {
    const formTrace = { name: formName, prev: tracedNewPythonComponent.formTrace };
    tracedNewPythonComponent.formTrace = formTrace;

    return tryCatchOrSuspend(
        function () {
            return chainOrSuspend(f(), function (r) {
                tracedNewPythonComponent.formTrace = formTrace.prev;
                return r;
            });
        },
        function (e) {
            tracedNewPythonComponent.formTrace = formTrace.prev;
            throw e;
        }
    );
}

export function withDependencyTrace(depId: string | null, f: () => pyObject | Suspension) {
    let depTrace = { depId: depId, prev: tracedNewPythonComponent.dependencyTrace };
    tracedNewPythonComponent.dependencyTrace = depTrace;

    return tryCatchOrSuspend(
        function () {
            return chainOrSuspend(f(), function (r) {
                tracedNewPythonComponent.dependencyTrace = tracedNewPythonComponent.dependencyTrace?.prev;
                return r;
            });
        },
        function (e) {
            tracedNewPythonComponent.dependencyTrace = tracedNewPythonComponent.dependencyTrace?.prev;
            throw e;
        }
    );
}

// Create the Python object representing a component from its YAML
// definition. Registers all components by name in the
// componentsByName[] array
export function newPythonComponent(
    component: ComponentSpec,
    componentsByName: StringMap<pyObject>,
    childrenByName: StringMap<pyObject[]> | undefined,
    eventBindingsByName: StringMap | undefined,
    formInstanceIndex: StringMap<pyObject[]>,
    pyContainer: pyObject | null,
    otherFormsSpec: FormSpec[] | undefined,
    dependencies: StringMap<DependencySpec>,
    repeatingPanelInstanceIndex: pyObject,
    dataBindings: unknown[] | undefined = undefined
) {
    // Construct the component, passing on any YAML properties as kwargs.

    let kwa: Kws = [];
    for (const k in component.properties) {
        if (component.properties[k] === undefined) continue;

        kwa.push(k);
        kwa.push(toPy(component.properties[k]));
    }

    let pyComponent: pyObject | Suspension | undefined = undefined;

    component.type = component.type.replace(/MultiColumnPanel$/, "ColumnPanel");

    const m = component.type.match(/^form:(.*)$/);
    if (m) {
        // It's a custom component!
        let [, logicalDepId, formName, className] = m[1].match(/^(?:([^:]*):)?((?:.*\.)?([^.]*))$/)!;
        let depId = logicalDepId ? window.anvilAppDependencyIds[logicalDepId] : null;
        let appPackageName = window.anvilAppMainPackage;

        if (logicalDepId && !depId) {
            console.error("Logical dep ID " + logicalDepId + " not found");
            pyComponent = mkInvalidComponent(anvilMod, "Missing dependency for form '" + formName + "'");
        }

        depId = depId || tracedNewPythonComponent.dependencyTrace?.depId || null;

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
        for (let t = tracedNewPythonComponent.formTrace; t; t = t.prev) {
            if (t.name == fullPackageName) {
                nested = true;
                break;
            }
        }

        if (nested && !pyComponent) {
            pyComponent = mkInvalidComponent(anvilMod, 'Cannot nest "' + fullPackageName + '" inside itself');
        } else if (otherFormsSpec && !pyComponent) {
            // we've been given the skeletons, so don't look for the real things
            let formSpec: FormSpec | null = null;

            let forms = depId ? dependencies[depId].forms : otherFormsSpec;

            for (let fs of forms) {
                if (fs.class_name == formName) {
                    formSpec = fs;
                    break;
                }
            }

            if (!formSpec) {
                pyComponent = mkInvalidComponent(
                    anvilMod,
                    'No such form: "' + (depId ? fullPackageName : formName) + '"'
                );
            } else {
                let spec = $.extend(
                    { name: "", components: formSpec.components, layout_properties: component.layout_properties },
                    formSpec.container
                ) as ComponentSpec;

                let nestedComponentsByName: StringMap<pyObject> = {};
                const resolvedFormSpec = formSpec;
                pyComponent = chainOrSuspend(
                    withDependencyTrace(depId, () =>
                        withFormTrace(fullPackageName, function () {
                            return newPythonComponent(
                                spec,
                                nestedComponentsByName,
                                {},
                                {},
                                formInstanceIndex,
                                null,
                                otherFormsSpec,
                                dependencies,
                                repeatingPanelInstanceIndex
                            );
                        })
                    ),
                    function (pyComponent: pyObject) {
                        if (pyComponent._anvil.componentSpec.name != "") {
                            formInstanceIndex[fullPackageName] = formInstanceIndex[fullPackageName] || [];
                            formInstanceIndex[fullPackageName].push(pyComponent);
                        }
                        pyComponent._anvil.isForm = true;
                        pyComponent._anvil.customComponentForm = resolvedFormSpec;
                        pyComponent._anvil.customPropVals = {};
                        for (let pt of resolvedFormSpec.properties || []) {
                            pyComponent._anvil.customPropVals[pt.name] =
                                pt.name in component.properties ? component.properties[pt.name] : pt.default_value;
                        }
                        pyComponent._anvil.dataBindingProp = "item";
                        pyComponent._anvil.componentsByName = nestedComponentsByName;
                        pyComponent._anvil.element.addClass(
                            "anvil-custom-component anvil-designer-component-namespace anvil-designer-namespace-region"
                        );
                        return pyComponent;
                    }
                );
            }
        } else if (!pyComponent) {
            // Instantiate custom component from the actual Python classes

            // TODO detect the "No such form: FormXYZ" error here
            // (an error from import could be anything; I think we'll have to check)
            // the app yaml. Or just accept the blowup on the console (you'll still
            // get a nice InvalidComponent in the designer.)

            pyComponent = chainOrSuspend(Sk.importModule(fullPackageName, false, true), function () {
                let pyFormMod = Sk.sysmodules.mp$subscript(new pyStr(fullPackageName)) as pyObject | undefined;
                let pyFormClass = pyFormMod && pyFormMod.tp$getattr(new pyStr(className));
                if (!pyFormMod) {
                    return mkInvalidComponent(anvilMod, 'No such form: "' + (depId ? fullPackageName : formName) + '"');
                }
                if (!pyFormClass) {
                    return mkInvalidComponent(
                        anvilMod,
                        pyRepr(pyFormMod).toString() + " does not contain a class called '" + className + "'"
                    );
                }
                return withFormTrace(fullPackageName, function () {
                    let customComponentProperties = window.anvilCustomComponentProperties[depId + ":" + formName];
                    for (let pt of customComponentProperties || []) {
                        if (kwa.indexOf(pt.name) > -1) continue; // Don't overwrite properties that have actually been set.
                        if (pt.type == "object") continue; // Don't try to set "Set at runtime" object properties
                        kwa.push(pt.name);
                        kwa.push(toPy(pt.default_value));
                    }

                    return pyCallOrSuspend(pyFormClass, [], kwa);
                });
            });
        }
    } else {
        // Not a custom component (therefore a built-in one)
        let cls: pyObject | undefined;
        const designName = "Design" + component.type;
        if (designName in anvilMod) {
            cls = anvilMod[designName];
        } else if (component.type in anvilMod) {
            cls = anvilMod[component.type];
        }

        if (!cls) {
            pyComponent = mkInvalidComponent(anvilMod, 'No such component: "' + component.type + '"');
        } else {
            // Prepend a magic kwarg that tells this component to ignore property exceptions - these all came from the YAML (designer), so are not the user's fault.
            kwa = ["__ignore_property_exceptions", true as unknown as pyObject].concat(kwa);
            pyComponent = chainOrSuspend(pyCallOrSuspend(cls, [], kwa), function (pyComponent: pyObject) {
                // Check whether we're a container. If we are, add any child components.
                if (isTrue(pyIsInstance(pyComponent, anvilMod["Container"] as pyType))) {
                    const fs: ((prevRet: pyObject) => pyObject | Suspension)[] = [];

                    for (const i in component.components) {
                        fs.push(
                            function (i: string) {
                                const child = component.components[i as unknown as number];

                                return chainOrSuspend(
                                    newPythonComponent(
                                        child,
                                        componentsByName,
                                        childrenByName,
                                        eventBindingsByName,
                                        formInstanceIndex,
                                        pyComponent,
                                        otherFormsSpec,
                                        dependencies,
                                        repeatingPanelInstanceIndex,
                                        dataBindings
                                    ),
                                    function (pyChildComponent: pyObject) {
                                        if (childrenByName) {
                                            childrenByName[component.name] = childrenByName[component.name] || [];
                                            childrenByName[component.name].push(pyChildComponent);
                                        }
                                        return pyChildComponent;
                                    }
                                );
                            }.bind(null, i)
                        );
                    }

                    fs.push(function () {
                        return pyComponent;
                    });

                    return chainOrSuspend(pyComponent, ...fs);
                } else {
                    return pyComponent;
                }
            });
        }
    }

    // Do final setup
    return chainOrSuspend(pyComponent!, function (pyComponent: pyObject) {
        pyComponent._anvil.componentSpec = component;
        pyComponent._anvil.element.addClass("anvil-component");
        pyComponent._anvil.element.data("anvil-py-component", pyComponent);

        if (isTrue(pyIsInstance(pyComponent, anvilMod["RepeatingPanel"] as pyType)) && ANVIL_IN_DESIGNER) {
            pyComponent._anvil.dependencies = dependencies;
            pyComponent._anvil.forms = otherFormsSpec;
            pyComponent._anvil.formInstanceIndex = formInstanceIndex;
            pyComponent._anvil.parentForm = tracedNewPythonComponent.formTrace;
            pyCall(pyComponent.tp$getattr(new pyStr("_refresh_form")) as pyCallable, [
                repeatingPanelInstanceIndex as unknown as pyObject,
            ]);
        }

        if (pyComponent._anvil.updateDesignName) {
            pyComponent._anvil.designName = component.name;
            pyComponent._anvil.updateDesignName(pyComponent);
        }

        if (componentsByName) componentsByName[component.name] = pyComponent;

        if (eventBindingsByName) eventBindingsByName[component.name] = component.event_bindings;

        if (dataBindings) {
            for (const i in component.data_bindings) {
                const binding = Object.create(component.data_bindings[i] as object);
                binding.pyComponent = pyComponent;
                binding.component_name = component.name;
                dataBindings.push(binding);
            }
        }

        // Add this new component to the required container.
        if (pyContainer) {
            const pyAddComponent = pyGetAttr<pyCallable>(pyContainer, s_add_component);

            const kwa: Kws = [];
            for (const k in component.layout_properties) {
                const val = component.layout_properties[k];
                if (val === undefined) {
                    continue;
                }
                kwa.push(k);
                kwa.push(toPy(val));
            }

            pyCall(pyAddComponent, [pyComponent], kwa);
        }
        return pyComponent;
    });
}

/*
 * TO TEST:
 *
 *  - Methods: open_form
 *  - Classes: Media, URLMedia, DataMedia, FileMedia
 *
 */
