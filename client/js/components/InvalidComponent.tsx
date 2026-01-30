import { checkNone } from "@Sk";
import PyDefUtils from "PyDefUtils";
import { getCssPrefix } from "@runtime/runner/legacy-features";
import { PyModMap } from "@runtime/runner/py-util";

const InvalidComponentFactory = (pyModule: PyModMap) => {
    pyModule["InvalidComponent"] = PyDefUtils.mkComponentCls(pyModule, "InvalidComponent", {
        properties: [
            {
                name: "text",
                type: "string",
                hidden: true,
                pyVal: true,
                defaultValue: Sk.builtin.str.$empty,
                set(s, e, pyV) {
                    const v = checkNone(pyV) ? "" : pyV.toString();
                    s._anvil.elements.err.textContent = v;
                },
            },
        ],
        element: ({ text }) => (
            <div refName="root" className={`${getCssPrefix()}invalid-component`}>
                <i refName="icon" className="glyphicon glyphicon-remove"></i>
                <div refName="err" className={`${getCssPrefix()}err`}>
                    {text.toString()}
                </div>
            </div>
        ),
    });
};

export default InvalidComponentFactory;

/*
 * TO TEST:
 *
 *  - New props: text, width
 *
 */
