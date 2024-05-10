/// <reference types="web" />
// above line forces ts server to prioritize web over node - see tsconfig

// Courtesy of https://github.com/total-typescript/ts-reset

type NonFalsy<T> = T extends false | 0 | "" | null | undefined | 0n ? never : T;

interface Array<T> {
    // because Array.prototype.filter should do the right thing for filter(Boolean)
    filter(predicate: BooleanConstructor, thisArg?: any): NonFalsy<T>[];
}

interface ReadonlyArray<T> {
    filter(predicate: BooleanConstructor, thisArg?: any): NonFalsy<T>[];
}

interface ArrayConstructor {
    isArray(arg: any): arg is ReadonlyArray<unknown> | Array<unknown>;
}
