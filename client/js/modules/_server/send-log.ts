import { diagnosticData } from "./diagnostics";
import { connect } from "./websocket";

export function sendLog(logData: any) {
    logData.type = "LOG";
    if (logData.error) {
        logData.error.wsdata = diagnosticData;
    }
    connect()
        .then(function (ws: WebSocket) {
            ws.send(JSON.stringify(logData));
        })
        .catch(function () {
            console.log("SendLog failed; Should resend via HTTP", logData);
        });
}
