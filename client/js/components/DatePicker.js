"use strict";

var PyDefUtils = require("PyDefUtils");

/**
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

module.exports = function(pyModule) {

    var datetime = Sk.importModule("datetime");

    // See http://momentjs.com/docs/#/displaying/format/
    var pythonformatToMomentJS = {
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

    var convertFormat = function(f) {
        for (var k in pythonformatToMomentJS) {
            f = f.replace(new RegExp(k, "g"), pythonformatToMomentJS[k])
        }
        return f;
    }

    var updatePicker = function(self, e) {
        var props = self._anvil.props;
        var picker = e.find("input");

        if (props['pick_time'] && Sk.ffi.remapToJs(props['pick_time'])) {
            var defaultFormat = "%c"
        } else {
            var defaultFormat = "%x"
        }

        var format = convertFormat(props['format'] ? Sk.ffi.remapToJs(props['format']) || defaultFormat : defaultFormat);

        // Takes a string or a date or a datetime and converts into a moment().
        var propValToMoment = function(v) {
            if (v == "" || v == null || Sk.ffi.remapToJs(v) == "" || v == Sk.builtin.none.none$) {
                return null;
            } else if (v instanceof Sk.builtin.str) {
                var date = Sk.ffi.remapToJs(v);
                if (date == "now") {
                    return moment();
                } else {
                    return moment(date, [format, moment.ISO_8601]);
                }
            } else if (Sk.misceval.isTrue(Sk.builtin.isinstance(v, datetime.tp$getattr(new Sk.builtin.str("datetime"))))) {
                if (!props['pick_time'].v) {
                    throw new Sk.builtin.Exception("Cannot display a datetime object on a DatePicker without setting pick_time to True.")
                }
                var strftime = v.tp$getattr(new Sk.builtin.str("strftime"));
                var pyStr = Sk.misceval.callsim(strftime, Sk.ffi.remapToPy("%Y-%m-%d %H:%M:%S.%f%z"));
                return moment(Sk.ffi.remapToJs(pyStr));
            } else if (Sk.misceval.isTrue(Sk.builtin.isinstance(v, datetime.tp$getattr(new Sk.builtin.str("date"))))) {
                var strftime = v.tp$getattr(new Sk.builtin.str("strftime"));
                var pyStr = Sk.misceval.callsim(strftime, Sk.ffi.remapToPy("%Y-%m-%d"));
                return moment(Sk.ffi.remapToJs(pyStr));
            }
        }

        var minDate = propValToMoment(props['min_date']);
        var maxDate = propValToMoment(props['max_date']);

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

            // The following may have been modified.
            locale: {
                format: format,
            },
            timePicker: props['pick_time'] && Sk.ffi.remapToJs(props['pick_time']),

            // We should probably expose properties for the following.
            singleDatePicker: true,
            showDropdowns: true,
            timePickerIncrement: 1,
        };

        picker.val('');
        picker.daterangepicker(self._anvil.pickerConfig);
        picker.off("apply.daterangepicker");
        picker.on("apply.daterangepicker", function(e) {
            self._anvil.dateMoment = $(e.target).data("daterangepicker").startDate;
            self._anvil.dataBindingWriteback(self, "date").finally(function() {
                picker.val(self._anvil.dateMoment.format(format));
                return PyDefUtils.raiseEventAsync({}, self, "change");
            });
        });
        picker.off("change");
        picker.on("change", function() {
            self._anvil.dateMoment = picker.val() == "" ? null : picker.data("daterangepicker").startDate;
            self._anvil.dataBindingWriteback(self, "date").finally(function() {
                return PyDefUtils.raiseEventAsync({}, self, "change");
            })
        });

        self._anvil.dateMoment = propValToMoment(props['date']);
        if (self._anvil.dateMoment) {
            picker.data("daterangepicker").setStartDate(self._anvil.dateMoment);
            picker.data("daterangepicker").setEndDate(self._anvil.dateMoment);
            picker.val(self._anvil.dateMoment.format(format));
        }
    }

	pyModule["DatePicker"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {


        var properties = PyDefUtils.assembleGroupProperties(/*!componentProps(DatePicker)!2*/["text", "layout", "interaction", "appearance", "tooltip", "user data"], {
            foreground: {
                set: (s,e,v) => {
                    let m = (""+v).match(/^theme:(.*)$/);
                    if (m) {
                        v = s._anvil.themeColors[m[1]] || '';
                    }
                    e.find("input,i").css("color", v);
                }
            },
            background: {
                set: (s,e,v) => {
                    let m = (""+v).match(/^theme:(.*)$/);
                    if (m) {
                        v = s._anvil.themeColors[m[1]] || '';
                    }
                    e.find("input").css("background", v);
                }
            },
            font_size: {
                set: (s,e,v) => {
                    e.find("input").addBack().css("font-size", (typeof(v) == "number") ? (""+v+"px") : "");
                }
            },
            align: {
                set: (s,e,v) => {
                    e.find("input").css("text-align", v).removeClass("align-left align-center align-right");
                    if (["left","center","right"].indexOf(v) > -1) {
                        e.find("input").addClass("align-"+v);
                    }
                }
            }
        });

        properties = properties.filter(p => p.name != "text");


        /*
         * timePickerIncrement minute_increment (5)
        /*

        /*!componentProp(DatePicker)!1*/
        properties.push({
            name: "date",
            type: "string",
            description: "The date selected on this component.",
            defaultValue: "",
            exampleValue: "2001-01-01 14:57",
            allowBindingWriteback: true,
            suggested: true,
            pyVal: true,
            set: function(s, e, v) { updatePicker(s, e); },
            get: function(self, e) {

                if (!self._anvil.dateMoment || self._anvil.dateMoment == Sk.builtin.none.none$) {
                    return Sk.builtin.none.none$;
                }

                var dateArray = self._anvil.dateMoment.toArray();
                dateArray[6] *= 1000; // Python works in microseconds, momentJS works in milliseconds.
                dateArray[1] += 1; // Python months are 0-indexed

                // The datePicker gives us moments that are already in the timezone of the browser.
                var tz = PyDefUtils.getModule("anvil.tz");
                var tzinfo = Sk.misceval.call(tz.tp$getattr(new Sk.builtin.str("tzoffset")), undefined, undefined, ["minutes", Sk.ffi.remapToPy(self._anvil.dateMoment.utcOffset())]);

                if (Sk.ffi.remapToJs(self._anvil.props['pick_time'])) {
                    return Sk.misceval.apply(datetime.tp$getattr(new Sk.builtin.str("datetime")), undefined, undefined, undefined, Sk.ffi.remapToPy(dateArray).v.concat([tzinfo]));
                } else {
                    return Sk.misceval.apply(datetime.tp$getattr(new Sk.builtin.str("date")), undefined, undefined, undefined, Sk.ffi.remapToPy(dateArray.slice(0,3)).v);
                }
            },
            getJS: function(self, e) {
                return Sk.ffi.remapToJs(self._anvil.props['date']);
            },
        });

        /*!componentProp(DatePicker)!1*/
        properties.push({
            name: "format",
            type: "string",
            description: "The format in which to display the selected date.",
            defaultValue: "",
            exampleValue: "%Y-%m-%d, %H:%M",
            set: function(s, e, v) { updatePicker(s, e); },
        });

        /*!componentProp(DatePicker)!1*/
        properties.push({
            name: "pick_time",
            type: "boolean",
            description: "Whether the user should be able to select a time as well as a date",
            defaultValue: false,
            exampleValue: true,
            set: function(s, e, v) { updatePicker(s, e); },
        });

        /*!componentProp(DatePicker)!1*/
        properties.push({
            name: "min_date",
            type: "string",
            description: "The minimum date the user can select.",
            defaultValue: "",
            exampleValue: "1995-07-31",
            set: function(s, e, v) { updatePicker(s, e); },
        });

        /*!componentProp(DatePicker)!1*/
        properties.push({
            name: "max_date",
            type: "string",
            description: "The maximum date the user can select.",
            defaultValue: "",
            exampleValue: "2020-12-31",
            set: function(s, e, v) { updatePicker(s, e); },
        });

        /*!componentProp(DatePicker)!1*/
        properties.push({
            name: "placeholder",
            type: "string",
            description: "A string to display when the DatePicker is empty.",
            defaultValue: "",
            exampleValue: "Choose a date",
            set: function(s, e, v) { e.find("input.placehold-this").attr("placeholder", v || null); },
        });


        var events = PyDefUtils.assembleGroupEvents(/*!componentEvents()!2*/ "DatePicker", ["universal"]);

        /*!componentEvent(DatePicker)!1*/
        events.push({name: "change", description: "When the selected date changes",
                     parameters: [], important: true, defaultEvent: true});


		$loc["__init__"] = PyDefUtils.mkInit(function init(self) {
            self._anvil.pickerConfig = { };
            self._anvil.element = $('<div class="anvil-datepicker" />')
                .append($('<input type="text" class="form-control to-disable placehold-this"/>'))
                .append($('<i class="fa fa-calendar" />').on("click", function() {
                    self._anvil.element.find("input").trigger("focus");
                }));

            self._anvil.dataBindingProp = "date";
        }, pyModule, $loc, properties, events, pyModule["Component"]);

        /*!defMethod(_)!2*/ "Set the keyboard focus to this component"
        $loc["focus"] = new Sk.builtin.func(function(self) {
            self._anvil.element.find("input").trigger("focus");
        });


    }, /*!defClass(anvil,DatePicker,Component)!*/ 'DatePicker', [pyModule["Component"]]);
};