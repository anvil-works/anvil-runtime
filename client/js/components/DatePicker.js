"use strict";

var PyDefUtils = require("PyDefUtils");
const { datetimeMod, tzMod } = require("@runtime/runner/py-util");
const { getCssPrefix } = require("@runtime/runner/legacy-features");

/*#
id: datepicker
docs_url: /docs/client/components/basic#datepicker
title: DatePicker
tooltip: Learn more about DatePicker
description: |
    ```python
    c = DatePicker()
    ```

    The DatePicker allows users of your app to select dates and times from a drop-down calendar.

    The `date` property allows you to get and set the displayed date. Whatever you set it to, it will
    always return a `datetime.date` or `datetime.datetime` object, depending on the value of the `pick_time`
    property. You may set the `date` property in any of the following ways:

    ```python
    c = DatePicker(format="%d %m %Y")

    # Set to a string
    c.date = "27 09 2016"

    # Set to an ISO string
    c.date = "2016-09-27"

    # Set to a datetime.date
    import datetime
    c.date = datetime.date.today()

    # Set to a datetime.datetime
    c.pick_time = True
    c.date = datetime.datetime.now()
    ```

    \* To a string in the format specified by the `format` property
    \* To an ISO8601-formatted date
    \* To a `datetime.date` object
    \* To a `datetime.datetime` object (if `pick_time` is `True`)
    \* To the string `"now"`, causing the DatePicker to display the current time when it is loaded.

    The min_date and max_date properties can be set in the same ways.

    When the `pick_time` property is `True`, `date` expects and returns a `datetime.datetime` object. 
    Otherwise it expects and returns a `datetime.date` object.

    When selecting times, the returned `datetime.datetime` object has its timezone (`tzinfo`) 
    explicitly set to the timezone of the user's browser.
*/

module.exports = (pyModule) => {

    const {isTrue} = Sk.misceval;
    const {checkString} = Sk.builtin;

    const pyDatetime = datetimeMod.datetime;
    const pyDate = datetimeMod.date;
    const strftimeStr = new Sk.builtin.str("strftime");


    // See http://momentjs.com/docs/#/displaying/format/
    const pythonformatToMomentJS = {
        "%a": "ddd",
        "%A": "dddd",
        "%b": "MMM",
        "%B": "MMMM",
        "%c": "llll",
        "%d": "DD",
        "%H": "HH",
        "%I": "hh",
        "%j": "DDDD",
        "%m": "MM",
        "%M": "mm",
        "%p": "A",
        "%S": "ss",
        "%U": "ww", // This might be swapped with %W
        "%w": "e",
        "%W": "WW",
        "%x": "L",
        "%X": "LT",
        "%y": "YY",
        "%Y": "YYYY",
        "%Z": "", // TODO: Timezone name. Should use moment.timezone
        "%%": "%",
    };

    const formatRegex = /%[aAbBcdHIjmMpSUwWxXyYZ%]/g

    const convertFormat = (f) => f.replace(formatRegex, (match) => pythonformatToMomentJS[match]);

    // Takes a string or a date or a datetime and converts into a moment().
    const propValToMoment = (v, props, format) => {
        if (!isTrue(v)) {
            return null;
        } else if (checkString(v)) {
            const date = v.toString();
            if (date === "now") {
                return moment();
            } else {
                return moment(date, [format, moment.ISO_8601]);
            }
        } else if (v instanceof pyDatetime) {
            if (!isTrue(props["pick_time"])) {
                throw new Sk.builtin.ValueError("Cannot display a datetime object on a DatePicker without setting pick_time to True.");
            }
            const strftime = v.tp$getattr(strftimeStr);
            const pyStr = PyDefUtils.pyCall(strftime, [new Sk.builtin.str("%Y-%m-%d %H:%M:%S.%f%z")]);
            return moment(pyStr.toString());
        } else if (v instanceof pyDate) {
            const strftime = v.tp$getattr(strftimeStr);
            const pyStr = PyDefUtils.pyCall(strftime, [new Sk.builtin.str("%Y-%m-%d")]);
            return moment(pyStr.toString());
        }
    }


    function updatePicker(self) {
        const props = self._anvil.props;
        const defaultFormat = isTrue(props["pick_time"]) ? "%c" : "%x";
        const format = convertFormat(props["format"].toString() || defaultFormat);
        const minDate = propValToMoment(props["min_date"], props, format);
        const maxDate = propValToMoment(props["max_date"], props, format);

        self._anvil.pickerConfig = {
            timePicker24Hour: true,
            timePickerSeconds: false,
            showCustomRangeLabel: true,
            alwaysShowCalendars: false,
            autoApply: true,
            linkedCalendars: false,
            autoUpdateInput: false,
            minDate: minDate,
            maxDate: maxDate,
            drops: "auto",

            // The following may have been modified.
            locale: {
                format: format,
            },
            timePicker: isTrue(props["pick_time"]),

            // We should probably expose properties for the following.
            singleDatePicker: true,
            showDropdowns: true,
            timePickerIncrement: 1,
        };

        const picker = self._anvil.picker;

        picker.val("");
        picker.daterangepicker(self._anvil.pickerConfig);
        picker.off("apply.daterangepicker");
        picker.on("apply.daterangepicker", function (e) {
            self._anvil.dateMoment = $(e.target).data("daterangepicker").startDate;
            self._anvil.dataBindingWriteback(self, "date").finally(() => {
                picker.val(self._anvil.dateMoment.format(format));
                return PyDefUtils.raiseEventAsync({}, self, "change");
            });
        });
        picker.off("change");
        picker.on("change", () => {
            self._anvil.dateMoment = picker.val() === "" ? null : picker.data("daterangepicker").startDate;
            self._anvil.dataBindingWriteback(self, "date").finally(() => PyDefUtils.raiseEventAsync({}, self, "change"));
        });

        self._anvil.dateMoment = propValToMoment(props["date"], props, format);
        if (self._anvil.dateMoment) {
            picker.data("daterangepicker").setStartDate(self._anvil.dateMoment);
            picker.data("daterangepicker").setEndDate(self._anvil.dateMoment);
            picker.val(self._anvil.dateMoment.format(format));
        }
    }

    pyModule["DatePicker"] = PyDefUtils.mkComponentCls(pyModule, "DatePicker", {
        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(DatePicker)!2*/ ["text", "layout", "layout_margin", "interaction", "appearance", "tooltip", "user data"], {
            foreground: {
                set: (s, e, v) => {
                    s._anvil.elements.input.style.color = s._anvil.elements.icon.style.color = PyDefUtils.getColor(v);
                },
            },
            background: {
                set: (s, e, v) => {
                    s._anvil.elements.input.style.background = PyDefUtils.getColor(v);
                },
            },
            font_size: {
                set(s, e, v) {
                    v = Sk.ffi.remapToJs(v);
                    s._anvil.picker.addBack().css("font-size", typeof v === "number" ? v + "px" : "");
                },
            },
            align: {
                set(s, e, v) {
                    v = v.toString();
                    const prefix = getCssPrefix();
                    const input = s._anvil.elements.input;
                    input.classList.remove(prefix + "align-left", prefix + "align-center", prefix + "align-right");
                    input.style.textAlign = v;
                    if (["left", "center", "right"].includes(v)) {
                        input.classList.add(prefix + "align-" + v);
                    }
                },
            },
            text: {
                omit: true,
            },
            enabled: {
                set(s, e, v) {
                    v = !isTrue(v);
                    s._anvil.elements.input.disabled = v;
                    s._anvil.elements.icon.classList.toggle("anvil-disabled", v);
                },
            },
            date: /*!componentProp(DatePicker)!1*/ {
                name: "date",
                type: "string",
                description: "The date selected on this component.",
                defaultValue: Sk.builtin.str.$empty,
                exampleValue: "2001-01-01 14:57",
                allowBindingWriteback: true,
                dataBindingProp: true,
                suggested: true,
                pyVal: true,
                set(s, e, v) {
                    updatePicker(s, e);
                },
                get(self, e) {
                    if (!self._anvil.dateMoment || self._anvil.dateMoment === Sk.builtin.none.none$) {
                        return Sk.builtin.none.none$;
                    }

                    const dateArray = self._anvil.dateMoment.toArray();
                    dateArray[6] *= 1000; // Python works in microseconds, momentJS works in milliseconds.
                    dateArray[1] += 1; // Python months are 0-indexed

                    // The datePicker gives us moments that are already in the timezone of the browser.
                    if (isTrue(self._anvil.props["pick_time"])) {
                        const tzinfo = PyDefUtils.pyCall(tzMod.tzoffset, [], ["minutes", Sk.ffi.remapToPy(self._anvil.dateMoment.utcOffset())]);
                        dateArray.push(tzinfo);
                        return PyDefUtils.pyCall(
                            pyDatetime,
                            dateArray.map((x) => Sk.ffi.remapToPy(x))
                        );
                    } else {
                        return PyDefUtils.pyCall(
                            pyDate,
                            dateArray.slice(0, 3).map((x) => Sk.ffi.remapToPy(x))
                        );
                    }
                },
                getJS(self, e) {
                    return Sk.ffi.remapToJs(self._anvil.props["date"]);
                },
            },

            /*!componentProp(DatePicker)!1*/
            format: {
                name: "format",
                type: "string",
                description: "The format in which to display the selected date.",
                defaultValue: Sk.builtin.str.$empty,
                pyVal: true,
                exampleValue: "%Y-%m-%d, %H:%M",
                set(s, e, v) {
                    updatePicker(s);
                },
            },

            /*!componentProp(DatePicker)!1*/
            pick_time: {
                name: "pick_time",
                type: "boolean",
                description: "Whether the user should be able to select a time as well as a date",
                defaultValue: Sk.builtin.bool.false$,
                pyVal: true,
                exampleValue: true,
                set(s, e, v) {
                    updatePicker(s);
                },
                important: true,
            },

            /*!componentProp(DatePicker)!1*/
            min_date: {
                name: "min_date",
                type: "string",
                description: "The minimum date the user can select.",
                defaultValue: Sk.builtin.str.$empty,
                pyVal: true,
                exampleValue: "1995-07-31",
                set(s, e, v) {
                    updatePicker(s);
                },
            },

            /*!componentProp(DatePicker)!1*/
            max_date: {
                name: "max_date",
                type: "string",
                description: "The maximum date the user can select.",
                defaultValue: Sk.builtin.str.$empty,
                exampleValue: "2020-12-31",
                set(s, e, v) {
                    updatePicker(s);
                },
            },

            /*!componentProp(DatePicker)!1*/
            placeholder: {
                name: "placeholder",
                type: "string",
                description: "A string to display when the DatePicker is empty.",
                defaultValue: Sk.builtin.str.$empty,
                exampleValue: "Choose a date",
                set(s, e, v) {
                    s._anvil.elements.input.setAttribute("placeholder", isTrue(v) ? v.toString() : "");
                },
                important: true,
            },
        }),

        events: PyDefUtils.assembleGroupEvents(/*!componentEvents()!2*/ "DatePicker", ["universal"], {
            change: /*!componentEvent(DatePicker)!1*/ {
                name: "change",
                description: "When the selected date changes",
                parameters: [],
                important: true,
                defaultEvent: true,
            },
        }),

        element({ background, align, placeholder, foreground, font_size, ...props }) {
            placeholder = isTrue(placeholder) ? placeholder.toString() : "";
            const prefix = getCssPrefix();
            const color = isTrue(foreground) ? "color: " + PyDefUtils.getColor(foreground) + ";" : "";
            const inputStyle = PyDefUtils.getOuterStyle({ background, align, foreground, font_size });
            const inputClass = PyDefUtils.getOuterClass({ align });
            const inputAttrs = !isTrue(props.enabled) ? {disabled: ""} : {};
            const iconClass = !isTrue(props.enabled) ? " anvil-disabled" : "";
            return (
                <PyDefUtils.OuterElement className="anvil-datepicker" {...{ font_size, ...props }}>
                    <input refName="input" className={`${prefix}form-control ${prefix}to-disable ` + inputClass} style={inputStyle + color} placeholder={placeholder} {...inputAttrs}/>
                    <i refName="icon" className={"fa fa-calendar" + iconClass} style={color}/>
                </PyDefUtils.OuterElement>
            );
        },

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["ClassicComponent"], (self) => {
                self._anvil.picker = $(self._anvil.elements.input);
                self._anvil.elements.icon.addEventListener("click", () => {
                    if (isTrue(self._anvil.getProp("enabled"))) {
                        self._anvil.picker.trigger("focus");
                    }
                });
                self._anvil.pickerConfig = {};

                updatePicker(self);
            });

            /*!defMethod(_)!2*/ "Set the keyboard focus to this DatePicker"
            $loc["focus"] = new Sk.builtin.func(function focus(self) {
                self._anvil.picker.trigger("focus");
                return Sk.builtin.none.none$;
            });
        },
    });

};

/*!defClass(anvil,DatePicker,Component)!*/