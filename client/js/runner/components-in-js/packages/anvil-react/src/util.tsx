/** @jsx React.createElement */

import React from "react";

interface ItemProps<T> {
    item: T;
    idx: number;
    fn: (item: T, idx: number) => JSX.Element;
}
const Item = <T,>({ item, idx, fn }: ItemProps<T>) => fn(item, idx);

interface ForProps<T> {
    each: T[];
    keyFn?: (item: T) => string | number;
    children: () => JSX.Element;
}

export const For = <T,>({ each, children, keyFn }: ForProps<T>) =>
    each.map((item, idx) => <Item key={keyFn?.(item) ?? idx} {...{ item, idx }} fn={children} />);
