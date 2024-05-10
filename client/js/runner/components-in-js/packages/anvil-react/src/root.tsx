import React, { useMemo, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ReactComponent } from "./core";

type Listener = () => void;

interface StoreState {}

export class ExternalStore<S extends StoreState> {
    private _listeners = new Set<Listener>();
    subscribe = (listener: () => void) => {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    };
    constructor(private _state: S) {}
    getState() {
        return this._state;
    }
    setState(update: Partial<S> | ((prev: S) => Partial<S>)) {
        if (typeof update === "function") {
            update = update(this._state);
        }
        Object.assign(this._state, update);
        this._listeners.forEach((l) => l());
    }
}

export function useStoreSelector<S extends RcState, R>(store: ExternalStore<S>, selector: (state: S) => R) {
    return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

type Context = React.FC<React.PropsWithChildren>;

interface RcState {
    contexts: Context[];
    components: ReactComponent[];
}

// this is global
// components are set inside core -> _anvilNew
// there's no obvious way to nuke components - we rely on page-events firing
export const rcStore = new ExternalStore<RcState>({ contexts: [], components: [] });

function nestedContexts(contexts: Context[]): Context {
    return React.memo(function WrappedContext({ children }) {
        return contexts.reduceRight((child, Context) => <Context>{child}</Context>, children);
    });
}

export function AnvilRoot() {
    const reactContexts = useStoreSelector(rcStore, (s) => s.contexts);
    const reactComponents = useStoreSelector(rcStore, (s) => s.components);

    const ContextProviders = useMemo(() => nestedContexts(reactContexts), [reactContexts]);

    const portalNodes = useMemo(
        () =>
            reactComponents.map((c) => {
                if (!c._.portalElement) return null;
                return createPortal(c._.reactComponent(), c._.portalElement, c._.id.toString());
            }),
        [reactComponents]
    );

    return <ContextProviders>{portalNodes}</ContextProviders>;
}

const rootElement = document.createElement("div");
rootElement.style.display = "none";
rootElement.dataset.anvilReactRoot = "";
const root = createRoot(rootElement);
root.render(<AnvilRoot />);
document.body.append(rootElement);

// @ts-ignore
// window.rootElement = rootElement;
// @ts-ignore
// window.rcs = rcStore;
