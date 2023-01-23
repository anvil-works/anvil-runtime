declare module "../" {
    export interface Suspension {
        $isSuspension: true;
    }
    export interface SuspensionConstructor {
        new (): Suspension;
    }

    export interface BreakConstructor {
        new (brValue?: any): Break;
    }

    export interface Break {
        readonly brValue: any;
    }
}

export {};
