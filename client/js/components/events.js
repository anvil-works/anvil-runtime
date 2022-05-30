const handled = {};

export function setHandled({ target, type }) {
    const targets = (handled[type] ??= new Set());
    targets.add(target);
    setTimeout(() => targets.delete(target));
}

export function isHandled({ target, type }) {
    return handled[type]?.has(target);
}
