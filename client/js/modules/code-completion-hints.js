const DummyObject = Sk.abstr.buildNativeClass("DummyObject", {
    constructor: function () {},
    slots: {
        tp$getattr(attr, canSuspend) {
            return this;
        },
        tp$call(args, kws) {
            // Oh, this is really gross - but it makes for passthrough decorators
            return args[0] || this;
        }
    }
});

module.exports = function() {
    return {
        __name__: new Sk.builtin.str("code_completion_hints"),
        __getattr__: new Sk.builtin.func(() => new DummyObject()),
    };
};