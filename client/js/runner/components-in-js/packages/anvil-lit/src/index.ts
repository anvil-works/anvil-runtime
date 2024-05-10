import { CustomComponentSpec } from "@runtime/components/Component";
import { JsComponent, JsComponentAPI, JsComponentConstructor } from "@runtime/runner/components-in-js/public-api";

// @ts-ignore
const { _jsComponentApi } = window.anvil;
const {
    designerApi,
    notifyMounted,
    notifyUnmounted,
    notifyVisibilityChange,
    raiseAnvilEvent,
    registerJsComponent,
    registerToolboxSection,
    subscribeAnvilEvent,
} = _jsComponentApi as JsComponentAPI;

type Constructor<T> = { new (): T };

interface LitSpec<I> extends CustomComponentSpec {
    tagName: string;
    elementClass: Constructor<I>;
}

const attributes = ["style"];

function mkProperty<I>(jsComponent: JsComponentConstructor, litClass: Constructor<I>, name: string) {
    if (name in litClass.prototype && !attributes.includes(name)) {
        Object.defineProperty(jsComponent.prototype, name, {
            get() {
                return this._anvilDomElement[name];
            },
            set(v) {
                this._anvilDomElement[name] = v;
            },
        });
    } else {
        Object.defineProperty(jsComponent.prototype, name, {
            get() {
                return this._anvilDomElement.getAttribute(name);
            },
            set(v) {
                this._anvilDomElement.setAttribute(name, v);
            },
        });
    }
}

function mkComponentClass<I>(spec: LitSpec<I>) {
    const { tagName, elementClass, properties = [], events = [] } = spec;

    class LitComponent implements JsComponent {
        _anvilDomElement = document.createElement(tagName);
        constructor() {
            for (const { name } of events) {
                this._anvilDomElement.addEventListener(name, () => {
                    raiseAnvilEvent(this, name);
                });
            }
        }
        _anvilSetupDom(): HTMLElement | Promise<HTMLElement> {
            return this._anvilDomElement;
        }
        static _anvilEvents = events;
        static _anvilProperties = properties;
    }
    for (const { name } of properties) {
        mkProperty(LitComponent, elementClass, name);
    }
    return LitComponent;
}

function mkLitComponent<I>(spec: LitSpec<I>) {
    const cls = mkComponentClass(spec);
    return registerJsComponent(cls, spec);
}

export default mkLitComponent;
