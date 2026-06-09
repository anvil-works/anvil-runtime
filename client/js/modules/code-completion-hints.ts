import { buildNativeClass, pyFunc, pyNewableType, pyObject, pyStr } from "@Sk";

interface DummyObject extends pyObject {}

const DummyObject: pyNewableType<DummyObject> = buildNativeClass("DummyObject", {
    constructor: function () {},
    slots: {
        tp$getattr(_attr, _canSuspend) {
            return this;
        },
        tp$call(args) {
            // Oh, this is really gross - but it makes for passthrough decorators
            return args[0] || this;
        },
    },
});

const codeCompletionHints = () => {
    return {
        __name__: new pyStr("code_completion_hints"),
        __getattr__: new pyFunc(() => new DummyObject()),
    };
};

export default codeCompletionHints;
