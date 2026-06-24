import type { pyIterator, pyObject } from "@Sk";
import { pyIteratorFactory } from "@Sk";

/** Wrap a JavaScript iterable as a Skulpt iterator. */
export function pyIteratorFromIterable<TPy extends pyObject>(iterable: Iterable<TPy>): pyIterator<TPy>;
export function pyIteratorFromIterable<T, TPy extends pyObject>(
    iterable: Iterable<T>,
    mapValue: (value: T) => TPy
): pyIterator<TPy>;
export function pyIteratorFromIterable<T, TPy extends pyObject>(
    iterable: Iterable<T>,
    mapValue?: (value: T) => TPy
): pyIterator<TPy> {
    const jsIterator = iterable[Symbol.iterator]();
    return new pyIteratorFactory(() => {
        const { value, done } = jsIterator.next();
        return done ? undefined : mapValue ? mapValue(value) : (value as unknown as TPy);
    });
}
