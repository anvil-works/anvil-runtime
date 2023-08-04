import { pyBytes, pyStr, toJs } from "@Sk";

export function pyBytesOrStr2ab(py_bytes: pyBytes | pyStr) {
    if (Sk.__future__.python3) {
        return (py_bytes as pyBytes).v.buffer;
    }
    const str = toJs(py_bytes as pyStr);
    const buf = new ArrayBuffer(str.length); // 1 byte for each char
    const bufView = new Uint8Array(buf);
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if (c > 255) {
            throw new Sk.builtin.ValueError("Cannot encode unicode character for transfer to server");
        }
        bufView[i] = c;
    }
    return buf;
}
