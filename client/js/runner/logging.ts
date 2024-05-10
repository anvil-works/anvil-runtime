// This is a little stub to direct logging calls in the correct direction

let sendLogImpl = console.log;
let onStdout: (text: string, fromServer?: boolean) => void = () => {};
let onUpdateReplState: (replStateUpdate: { importTime: number}) => void = (replStateUpdate) => {};

export function provideLoggingImpl(send: (msg: object) => void) {
    sendLogImpl = send;
}

export function setHooks(hooks: { onStdout: typeof onStdout, onUpdateReplState: typeof onUpdateReplState }) {
    onStdout = hooks.onStdout;
    onUpdateReplState = hooks.onUpdateReplState;
}

let accumulatingPrints: null | string = null,
    firstMsg: number | undefined;

function flushLog() {
    if (accumulatingPrints !== null) {
        sendLogImpl({ print: accumulatingPrints });
        accumulatingPrints = null;
    }
}

export function logEvent(log: object) {
    flushLog();
    sendLogImpl(log);
}

export function stdout(text: string, fromServer?: boolean) {
    if (text != "\n") {
        if (!firstMsg) {
            firstMsg = +new Date();
        }
        console.log((fromServer ? "SERVER: " : "CLIENT: ") + text);
    }

    onStdout(text, fromServer);

    if (!fromServer) {
        if (accumulatingPrints === null) {
            accumulatingPrints = "";
            setTimeout(flushLog);
        }
        accumulatingPrints += text;
    }
}

export function updateReplState(replStateUpdate:{ importTime: number}) {
    onUpdateReplState(replStateUpdate);
}
