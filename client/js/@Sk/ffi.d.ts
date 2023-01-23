import { pyObject } from ".";

declare module "./" {
    export interface pyProxy<T = any> extends pyObject {
        js$wrapped: T;
    }
}
