import { pyFunc, pyRuntimeError, pyStr } from "@Sk";

// anvil.script only exists inside a running script on the server (see anvil.server.run_script);
// on the client it is a stub that raises on any use.
export default function scriptModule() {
    return {
        __name__: new pyStr("anvil.script"),
        __getattr__: new pyFunc((pyName: pyStr) => {
            // RuntimeError rather than AttributeError so the message survives skulpt's attribute lookup
            throw new pyRuntimeError(
                `anvil.script.${pyName} is only available inside a running script on the server, not in client code`
            );
        }),
    };
}
