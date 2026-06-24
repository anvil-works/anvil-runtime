"use strict";

import type { pyNoneType, pyObject } from "@Sk";
import { buildPyClass, pyFunc, pyNone } from "@Sk";
import { PyModMap } from "@runtime/runner/py-util";
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

    RepeatingPanelFactory(pyModule);

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

/*
 * TO TEST:
 *
 *  - Methods: open_form
 *  - Classes: Media, URLMedia, DataMedia, FileMedia
 *
 */
