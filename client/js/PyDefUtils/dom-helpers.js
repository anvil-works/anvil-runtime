const appendChild = (parent, child, def) => {
    if (Array.isArray(child)) {
        child.forEach((nestedChild) => appendChild(parent, nestedChild, def));
    } else if (typeof child === "string") {
        child = document.createTextNode(child);
        parent.appendChild(child);
    } else {
        const [childEl, childDef] = child;
        parent.appendChild(childEl);
        Object.assign(def, childDef);
    }
};

function createElement(tag, _props, ..._children) {
    if (typeof tag === "function") {
        return tag(_props, ..._children);
    }
    const { refName, children, style, className, innerHTML, ...props } = _props || {};
    const element = document.createElement(tag);
    const def = { [refName]: element };
    _children = children || _children;

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
            element.value = propValue;
        } else {
            element.setAttribute(propName, propValue == null ? propValue : propValue.toString());
        }
    });

    _children.forEach((child) => {
        if (typeof child === "string" || typeof child === "number") {
            element.appendChild(document.createTextNode(child));
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
