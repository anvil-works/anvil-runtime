const handled: { [type: string]: Set<EventTarget | null> } = {};

export function setHandled({ target, type }: Event) {
    const targets = (handled[type] ??= new Set());
    targets.add(target);
    setTimeout(() => targets.delete(target));
}

export function isHandled({ target, type }: Event) {
    return handled[type]?.has(target);
}
