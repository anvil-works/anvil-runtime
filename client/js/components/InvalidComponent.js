"use strict";

const { getCssPrefix } = require("@runtime/runner/legacy-features");
var PyDefUtils = require("PyDefUtils");

module.exports = (pyModule) => {
    pyModule["InvalidComponent"] = PyDefUtils.mkComponentCls(pyModule, "InvalidComponent", {
        properties: [
            {
                name: "text",
                pyVal: true,
                defaultValue: Sk.builtin.str.$empty,
                set(s, e, v) {
                    v = Sk.builtin.checkNone(v) ? "" : v.toString();
                    s._anvil.elements.err.textContent = v;
                },
            },
        ],
        element: ({ text }) => (
            <div refName="outer" className={`${getCssPrefix()}invalid-component`}>
                <i refName="icon" className="glyphicon glyphicon-remove"></i>
                <div refName="err" className={`${getCssPrefix()}err`}>
                    {text.toString()}
                </div>
            </div>
        ),
    });
};

/*
 * TO TEST:
 *
 *  - New props: text, width
 *
 */
