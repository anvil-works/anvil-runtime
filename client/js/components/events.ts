const handled: { [type: string]: Set<EventTarget | null> } = {};

export function setHandled({ target, type }: { target: EventTarget; type: string }) {
    const targets = (handled[type] ??= new Set());
    targets.add(target);
    setTimeout(() => targets.delete(target));
}

export function isHandled({ target, type }: { target: EventTarget; type: string }) {
    return handled[type]?.has(target);
}
