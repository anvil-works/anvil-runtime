import { checkNone, checkString, isTrue, pyCall, pyFunc, pyNone, pyStr, pyType, toJs, toPy } from "@Sk";
import PyDefUtils from "PyDefUtils";
import DateRangePicker from "@runtime/modules/daterangepicker";
import { getCssPrefix } from "@runtime/runner/legacy-features";
import { PyModMap, datetimeMod, tzMod } from "@runtime/runner/py-util";
import { ClassicComponent, ClassicComponentConstructor } from "./ClassicComponent";
import { dateFormat, datePickerLocale, parsePickerDate, pythonDateToDate } from "./date-picker-dates";

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

interface DatePickerAnvil {
    elements: { input: HTMLInputElement; icon: HTMLElement };
    picker: HTMLInputElement;
    selectedDate: Date | null;
    dateRangePicker: DateRangePicker | null;
}

interface DatePicker extends ClassicComponent<DatePickerAnvil> {}

const DatePickerFactory = (pyModule: PyModMap) => {
    const ClassicComponent = pyModule["ClassicComponent"] as ClassicComponentConstructor;

    const pyDatetime = datetimeMod.datetime as pyType;
    const pyDate = datetimeMod.date as pyType;
    // Keep invalid property values until the getter, as the existing API does.
    const propValToDate = (v: any, props: any, format: string): Date | null => {
        if (!isTrue(v)) return null;
        if (checkString(v)) {
            return v.toString() === "now" ? new Date() : parsePickerDate(v.toString(), format);
        }
        if (v instanceof pyDatetime && !isTrue(props["pick_time"])) {
            throw new Sk.builtin.ValueError(
                "Cannot display a datetime object on a DatePicker without setting pick_time to True."
            );
        }
        return v instanceof pyDate ? pythonDateToDate(v) : null;
    };

    function updatePicker(self: DatePicker) {
        const props = self._anvil.props;
        const defaultFormat = isTrue(props["pick_time"]) ? "%c" : "%x";
        const rawFormat = props["format"].toString() || defaultFormat;
        const format = dateFormat(rawFormat);
        const minDate = propValToDate(props["min_date"], props, format);
        const maxDate = propValToDate(props["max_date"], props, format);

        // Set initial date
        self._anvil.selectedDate = propValToDate(props["date"], props, format);
        const selectedDate = self._anvil.selectedDate;
        const initialDate = selectedDate && !isNaN(selectedDate.getTime()) ? selectedDate : null;

        const locale = datePickerLocale();
        const options = {
            minDate,
            maxDate,
            // The following may have been modified.
            locale: {
                format: rawFormat,
                daysOfWeek: locale.daysOfWeek,
                monthNames: locale.months,
                firstDay: locale.firstDay,
            },
            timePicker: isTrue(props["pick_time"]),
            // We should probably expose properties for the following.
            timePickerIncrement: 1,
            date: initialDate,
        };

        // Clear input value
        self._anvil.picker.value = "";

        // Create new DateRangePicker instance
        self._anvil.dateRangePicker?.remove();

        // Sk.builtin.print(["Creating new DateRangePicker"]);
        self._anvil.dateRangePicker = new DateRangePicker(self._anvil.picker, options, (d) => {
            self._anvil.selectedDate = d;
            self._anvil.dataBindingWriteback(self, "date").finally(() => {
                return PyDefUtils.raiseEventAsync({}, self, "change");
            });
        });
    }

    pyModule["DatePicker"] = PyDefUtils.mkComponentCls<DatePicker>(pyModule, "DatePicker", {
        properties: PyDefUtils.assembleGroupProperties<DatePicker>(
            /*!componentProps(DatePicker)!2*/ [
                "text",
                "layout",
                "layout_margin",
                "interaction",
                "appearance",
                "tooltip",
                "user data",
            ],
            {
                foreground: {
                    pyVal: true,
                    set: (s, e, v) => {
                        s._anvil.elements.input.style.color = s._anvil.elements.icon.style.color =
                            PyDefUtils.getColor(v);
                    },
                },
                background: {
                    pyVal: true,
                    set: (s, e, v) => {
                        s._anvil.elements.input.style.background = PyDefUtils.getColor(v);
                    },
                },
                font_size: {
                    pyVal: true,
                    set(s, e, pyV) {
                        const v = toJs(pyV);
                        if (typeof v === "number") {
                            s._anvil.picker.style.fontSize = v + "px";
                        } else {
                            s._anvil.picker.style.fontSize = "";
                        }
                    },
                },
                align: {
                    pyVal: true,
                    set(s, e, pyV) {
                        const v = pyV.toString();
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
                    pyVal: true,
                    set(s, e, v) {
                        const disabled = !isTrue(v);
                        s._anvil.elements.input.disabled = disabled;
                        s._anvil.elements.icon.classList.toggle("anvil-disabled", disabled);
                    },
                },
                date: /*!componentProp(DatePicker)!1*/ {
                    name: "date",
                    type: "string",
                    description: "The date selected on this component.",
                    defaultValue: pyStr.$empty,
                    exampleValue: "2001-01-01 14:57",
                    allowBindingWriteback: true,
                    dataBindingProp: true,
                    suggested: true,
                    pyVal: true,
                    set(s, e, v) {
                        updatePicker(s);
                    },
                    get(self, e) {
                        if (ANVIL_IN_DESIGNER) {
                            return self._anvil.props["date"];
                        }
                        if (!self._anvil.selectedDate) {
                            return pyNone;
                        }

                        const date = self._anvil.selectedDate;
                        if (isNaN(date.getTime())) throw new Sk.builtin.ValueError("Invalid date");
                        const dateArray = [
                            date.getFullYear(),
                            date.getMonth() + 1,
                            date.getDate(),
                            date.getHours(),
                            date.getMinutes(),
                            date.getSeconds(),
                            date.getMilliseconds() * 1000,
                        ];

                        if (isTrue(self._anvil.props["pick_time"])) {
                            const tzinfo = pyCall(tzMod.tzoffset, [], ["minutes", toPy(-date.getTimezoneOffset())]);
                            return pyCall(pyDatetime, [...dateArray.map((x) => toPy(x)), tzinfo]);
                        } else {
                            return pyCall(
                                pyDate,
                                dateArray.slice(0, 3).map((x: number) => toPy(x))
                            );
                        }
                    },
                    getJS(self, e) {
                        return toJs(self._anvil.props["date"]);
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
                    defaultValue: pyStr.$empty,
                    exampleValue: "2020-12-31",
                    pyVal: true,
                    set(s, e, v) {
                        updatePicker(s);
                    },
                },

                /*!componentProp(DatePicker)!1*/
                placeholder: {
                    name: "placeholder",
                    type: "string",
                    description: "A string to display when the DatePicker is empty.",
                    defaultValue: pyStr.$empty,
                    pyVal: true,
                    exampleValue: "Choose a date",
                    set(s, e, pyV) {
                        const v = checkNone(pyV) ? "" : pyV.toString();
                        s._anvil.elements.input.setAttribute("placeholder", v);
                    },
                    important: true,
                },
            }
        ),

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
            const inputAttrs: Record<string, string> = !isTrue(props.enabled) ? { disabled: "" } : {};
            const iconClass = !isTrue(props.enabled) ? " anvil-disabled" : "";
            return (
                <PyDefUtils.OuterElement className="anvil-datepicker" {...{ font_size, ...props }}>
                    <input
                        refName="input"
                        className={`${prefix}form-control ${prefix}to-disable ` + inputClass}
                        style={inputStyle + color}
                        placeholder={placeholder}
                        {...inputAttrs}
                    />
                    <i refName="icon" className={"fa fa-calendar" + iconClass} style={color} />
                </PyDefUtils.OuterElement>
            );
        },

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew<DatePicker>(ClassicComponent, (self) => {
                self._anvil.picker = self._anvil.elements.input;
                self._anvil.elements.icon.addEventListener("click", () => {
                    if (isTrue(self._anvil.getProp("enabled"))) {
                        self._anvil.picker.focus();
                    }
                });
                self._anvil.dateRangePicker = null;

                updatePicker(self);
            });

            /*!defMethod(_)!2*/ ("Set the keyboard focus to this DatePicker");
            $loc["focus"] = new pyFunc(function focus(self: DatePicker) {
                self._anvil.picker.focus();
                return pyNone;
            });
        },
    });
};

export default DatePickerFactory;

/*!defClass(anvil,DatePicker,Component)!*/
