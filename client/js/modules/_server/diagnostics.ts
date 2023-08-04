interface Request {
    // time: number;
}

interface DiagnosticData {
    loadTime: number;
    userAgent: string;
    events: { type: string; time: number; nSent: number; nReceived: number }[];
    requests: (Request & { time: number })[];
    nSent: number;
    nReceived: number;
}

export const diagnosticData: DiagnosticData = {
    loadTime: Date.now(),
    userAgent: navigator.userAgent,
    events: [],
    requests: [],
    nSent: 0,
    nReceived: 0,
};

export function diagnosticRequest(req: Request) {
    if (diagnosticData.requests.length > 100) {
        diagnosticData.requests = diagnosticData.requests.slice(diagnosticData.requests.length - 50);
    }
    diagnosticData.requests.push({ time: Date.now(), ...req });
}

export function diagnosticEvent(type: string) {
    const evt = { type, time: Date.now(), nSent: diagnosticData.nSent, nReceived: diagnosticData.nReceived };
    diagnosticData.events.push(evt);
    diagnosticRequest(evt);
}
