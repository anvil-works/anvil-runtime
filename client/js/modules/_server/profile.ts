import type { ResponseData } from "./handlers";

let profilePrintColor = "transparent";

export interface ServerProfile {
    children?: ServerProfile[];
    description: string;
    "start-time": number;
    "end-time": number;
}

export class Profile {
    children: Profile[] = [];
    endTime?: number;
    duration?: number;
    origin?: string;
    response?: ResponseData;

    constructor(readonly description: string, readonly startTime: number = Date.now()) {}
    append(description: string, startTime: number = Date.now(), endTime?: number) {
        const child = new Profile(description, Math.round(startTime));
        if (endTime) {
            child.endTime = Math.round(endTime);
            child.duration = child.endTime - child.startTime;
        }
        this.children.push(child);
        return child;
    }
    end() {
        if (!this.endTime) {
            for (const child of this.children) {
                child.end();
            }
            const endTime = (this.endTime = Date.now());
            this.duration = endTime - this.startTime;
        }
    }
    print() {
        this.end();
        const oldPrintColor = profilePrintColor;

        if (this.origin === "Server (Native)") {
            profilePrintColor = "#cfc";
        } else if (this.origin == "Server (Python)") {
            profilePrintColor = "#ffb";
        }

        let childDuration = 0;
        for (const child of this.children) {
            childDuration += child.duration ?? 0;
        }
        let msg = `${this.description} (${this.duration} ms`;
        if (this.children.length > 0) {
            msg += `, ${this.duration! - childDuration} ms lost)`;

            console.groupCollapsed("%c" + msg, "background:" + profilePrintColor);
            for (const child of this.children) {
                child.print();
            }
            if (this.response) {
                console.log("%cResponse:", "background:#ddd;", this.response);
            }
            console.groupEnd();
        } else {
            msg += ")";
            console.log("%c" + msg, "background:" + profilePrintColor);
        }
        profilePrintColor = oldPrintColor;
    }

    mergeServerProfile(serverProfile: ServerProfile) {
        const { description, "start-time": startTime, "end-time": endTime } = serverProfile;
        this.append(description, startTime, endTime);
        for (const child of serverProfile.children ?? []) {
            this.mergeServerProfile(child);
        }
    }
}

export function profileStart(description: string, startTime?: number) {
    return new Profile(description, startTime);
}
