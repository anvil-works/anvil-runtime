type ElementDef = Record<string, HTMLElement>;
type Child = any;

interface ElementProps {
    children?: Child[];
    className?: string;
    innerHTML?: string;
    refName?: string;
    style?: string;
    value?: string;
    [prop: string]: unknown;
}

type ElementFactory = (props: any, ...children: Child[]) => any;

const appendChild = (parent: HTMLElement, child: Child, def: ElementDef) => {
    if (Array.isArray(child)) {
        child.forEach((nestedChild) => appendChild(parent, nestedChild, def));
    } else if (typeof child === "string") {
        parent.appendChild(document.createTextNode(child));
    } else {
        const [childEl, childDef] = child;
        parent.appendChild(childEl);
        Object.assign(def, childDef);
    }
};

function createElement(tag: string | ElementFactory, _props?: ElementProps, ..._children: Child[]): any {
    if (typeof tag === "function") {
        return tag(_props, ..._children);
    }
    const { refName, children, style, className, innerHTML, ...props } = _props || {};
    const element = document.createElement(tag);
    const def: ElementDef = refName ? { [refName]: element } : {};
    _children = children ?? _children;

    if (style) {
        element.style.cssText = style;
    }
    if (className) {
        element.className = className;
    }
    if (innerHTML) {
        element.innerHTML = innerHTML;
    }

    Object.keys(props).forEach((propName) => {
        const propValue = props[propName];
        if (propName === "value") {
            (element as HTMLInputElement).value = propValue == null ? "" : propValue.toString();
        } else {
            element.setAttribute(propName, propValue as string);
        }
    });

    _children.forEach((child) => {
        if (typeof child === "string" || typeof child === "number") {
            element.appendChild(document.createTextNode(child as string));
        } else if (child === true || !child) {
            // pass
        } else {
            const [childEl, childDef] = child;
            element.appendChild(childEl);
            Object.assign(def, childDef);
        }
    });

    return [element, def];
}

export { createElement };
