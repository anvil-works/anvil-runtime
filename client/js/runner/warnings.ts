export function warn(msg: string) {
    if (!msg.toLowerCase().startsWith("warning:")) {
        msg = "Warning: " + msg;
    }
    Sk.builtin.print([msg]);
}
