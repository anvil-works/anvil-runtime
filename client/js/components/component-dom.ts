import type { Component } from "./Component";

export const COMPONENT_ROOT_ATTR = "data-anvil-runtime-component";
export const COMPONENT_ROOT_SELECTOR = `[${COMPONENT_ROOT_ATTR}]`;

const componentByElement = new WeakMap<Element, Component>();

export function getDomPyComponent<T = unknown>(domNode: Element | null | undefined): T | undefined {
    return (domNode && componentByElement.get(domNode)) as T | undefined;
}

export function isComponentElement(element: Element | null | undefined): element is Element {
    return !!getDomPyComponent(element);
}

function matchesSelector(element: Element, selector?: string) {
    return !selector || element.matches(selector);
}

export function markComponentElement(component: Component, element: Element) {
    element.setAttribute(COMPONENT_ROOT_ATTR, "");
    componentByElement.set(element, component);
}

export function unmarkComponentElement(component: Component, element: Element) {
    if (componentByElement.get(element) !== component) {
        return;
    }
    componentByElement.delete(element);
    element.removeAttribute(COMPONENT_ROOT_ATTR);
}

export function findComponentElements(root: ParentNode | null | undefined, selector?: string): Element[] {
    if (!root) {
        return [];
    }
    return Array.from(root.querySelectorAll(COMPONENT_ROOT_SELECTOR)).filter(
        (element) => isComponentElement(element) && matchesSelector(element, selector)
    );
}

export function findChildComponentElements(parent: Element | null | undefined, selector?: string): Element[] {
    if (!parent) {
        return [];
    }
    return Array.from(parent.children).filter(
        (element) =>
            element.hasAttribute(COMPONENT_ROOT_ATTR) &&
            isComponentElement(element) &&
            matchesSelector(element, selector)
    );
}

export function closestComponentFromElement(element: Element | null | undefined): Component | undefined {
    for (let current = element; current; ) {
        const componentElement = current.closest(COMPONENT_ROOT_SELECTOR);
        if (!componentElement) {
            return;
        }

        const component = getDomPyComponent<Component>(componentElement);
        if (component) {
            return component;
        }
        // The marker is a searchable DOM attribute, so it can be cloned or
        // serialized without the WeakMap identity; skip those stale markers.
        current = componentElement.parentElement;
    }
}
