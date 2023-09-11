import { diagnosticData } from "./diagnostics";
import { WebsocketFallback, connect } from "./websocket";

async function sendLogDataHttp(logData: any) {
    const formData = new FormData();
    formData.append("json-data", JSON.stringify(logData));
    try {
        await fetch(`${window.anvilAppOrigin}/_/server-call-http`, {
            method: "POST",
            body: formData,
        });
    } catch {
        console.log("SendLog http failed;", logData);
    }
}

let sendLogData = async (logData: any) => {
    try {
        const ws = await connect();
        ws.send(JSON.stringify(logData));
    } catch (e) {
        if (e instanceof WebsocketFallback) {
            console.log("SendLog failed; Falling back to HTTP;", logData);
            sendLogData = sendLogDataHttp;
            sendLogDataHttp(logData);
        } else {
            console.log("SendLog failed;", logData);
        }
    }
};

export async function sendLog(logData: any) {
    logData.type = "LOG";
    if (logData.error) {
        logData.error.wsdata = diagnosticData;
    }
    sendLogData(logData);
}
