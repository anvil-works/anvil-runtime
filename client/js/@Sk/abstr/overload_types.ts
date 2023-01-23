import type { pyNewableType, pyObject } from "..";

// Because Typescript infers the last overload - but when we extend an interface it goes to the top
// https://github.com/microsoft/TypeScript/issues/48458

// For some reason:
// type T = pyNewableType<pyObject>;
// takes a different path to
// interface T { new(...args: any[]): pyObject }
// search me why - but this disgusting overload seems to work and takes account of both cases

export type ConstructorOverloadParameters<T extends abstract new (...args: any) => any> = T extends {
    new (...args: infer A1): infer R1;
    new (...args: any): any;
    new (...args: any): any;
    new (...args: any): any;
}
    ? R1 extends pyObject
        ? A1
        : T extends {
              new (...args: A1): infer R1;
              new (...args: any): any;
              new (...args: any): any;
          }
        ? R1 extends pyObject
            ? A1
            : T extends {
                  new (...args: infer A1): infer R1;
                  new (...args: any): any;
              }
            ? R1 extends pyObject
                ? A1
                : T extends {
                      new (...args: infer A1): infer R1;
                  }
                ? R1 extends pyObject
                    ? A1
                    : never
                : never
            : never
        : never
    : T extends {
          new (...args: infer A): infer R;
          new (...args: any): any;
          new (...args: any): any;
      }
    ? A
    : T extends {
          new (...args: infer A): infer R;
          new (...args: any): any;
      }
    ? A
    : T extends { new (...args: infer A): infer R }
    ? A
    : never;

export type InstanceOverloadType<T extends abstract new (...args: any) => any> = T extends {
    new (...args: any): infer R1;
    new (...args: any): any;
    new (...args: any): any;
    new (...args: any): infer R4;
}
    ? R1 extends pyObject
        ? R1
        : T extends {
              new (...args: any): infer R1;
              new (...args: any): any;
              new (...args: any): any;
          }
        ? R1 extends pyObject
            ? R1
            : T extends {
                  new (...args: any): infer R1;
                  new (...args: any): any;
              }
            ? R1 extends pyObject
                ? R1
                : T extends {
                      new (...args: any): infer R1;
                  }
                ? R1 extends pyObject
                    ? R1
                    : never
                : never
            : never
        : never
    : never;

// // Tests
// interface X {
//     new(s: string): pyObject
// }

// type IX = InstanceOverloadType<X>
// type CX = ConstructorOverloadParameters<X>

// type T = pyNewableType<pyObject>;
// type I = InstanceOverloadType<T>;
// type C = ConstructorOverloadParameters<T>;
