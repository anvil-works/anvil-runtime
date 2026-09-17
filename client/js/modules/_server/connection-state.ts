// Tracks the state of our server connection so interested parties (e.g. the IDE runner
// shim) can react - in particular, to warn that streamed background-task output may have
// been missed.
//
//   "connected"     - the websocket is open
//   "lost"          - the websocket closed or errored (it will reopen lazily on the next call)
//   "none"          - we are using HTTP transport; there is no push channel at all
//   "session-reset" - the app session was reset/replaced, so anything watched under the old
//                     session stops streaming

export type ConnectionState = "connected" | "lost" | "none" | "session-reset";

let onConnectionState: ((state: ConnectionState) => void) | null = null;
let lastState: ConnectionState | null = null;

export function setOnConnectionState(cb: (state: ConnectionState) => void) {
    onConnectionState = cb;
    // Replay the current state in case it was signalled before the hook was set
    // (e.g. "none" is signalled at module init when HTTP transport is forced).
    if (lastState !== null) cb(lastState);
}

export function signalConnectionState(state: ConnectionState) {
    // De-dupe: a websocket's close and error handlers both funnel into the same signal.
    // "session-reset" is a one-off event rather than a state, so it always fires.
    if (state === lastState && state !== "session-reset") return;
    lastState = state;
    onConnectionState?.(state);
}
