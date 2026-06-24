import {
    buildNativeClass,
    chainOrSuspend,
    checkString,
    isTrue,
    promiseToSuspension,
    proxy,
    pyCallOrSuspend,
    pyCallable,
    pyEval,
    pyFalse,
    pyMappingProxy,
    pyNone,
    pyNotImplementedError,
    pyObject,
    pyStr,
    pySuper,
    pyTrue,
    pyTypeError,
    pyValueError,
    suspensionToPromise,
    toJs,
    toPy,
    typeName,
} from "@Sk";
import PyDefUtils from "PyDefUtils";
import {
    SanitizedScript,
    loadScripts as loadSanitizedScripts,
    sanitizeScripts,
    setInnerHTMLWithWrapping,
} from "@runtime/html-form/dom-utils";
import { Classes, Style } from "@runtime/modules/_anvil/html-styling";
import { DropModeFlags } from "@runtime/runner/python-objects";
import { designerApi } from "../runner/component-designer-api";
import { setElementVisibility } from "../runner/components-in-js/public-api/property-utils";
import { ACTIVE_CARRIER_ATTRS } from "../runner/designer-dom-attributes";
import type { FormTemplate } from "../runner/forms";
import { addFormTemplateNamedDomNodeSource, isTemplateForm } from "../runner/forms";
import {
    funcFastCall,
    initNativeSubclass,
    iterKws,
    kwsToObj,
    s_add_component,
    s_remove_from_parent,
    s_x_anvil_classic_hide,
    s_x_anvil_classic_show,
    s_x_anvil_dom_node_changed,
    s_x_anvil_page_added,
} from "../runner/py-util";
import type { AnvilHookSpec, DropZone, DroppingSpecification } from "./Component";
import {
    Component,
    IGNORE_PROPERTY_EXCEPTIONS_KW,
    getListenerCallbacks,
    notifyVisibilityChange,
    raiseEventOrSuspend,
} from "./Component";
import type { ContainerConstructor } from "./Container";
import { Container } from "./Container";

interface HtmlComponentState {
    _rootElement: HTMLElement | null;
    _activeElement: HTMLElement | null;
    html: string;
    classes: Classes;
    style: Style;
    designerStyleOverride?: string | null;
    visible: boolean;
    dropzones: Map<string, HTMLElement>;
    namedDomNodes: Map<string, Element>;
    namedDomNodesProxy: pyMappingProxy;
    componentTargets: WeakMap<pyObject, string | null>;
    eventBindings: { element: Element; eventName: string; handler: string }[];
    boundEventListeners: { element: Element; eventName: string; listener: (event: Event) => void }[];
    constructorPropertyValues: Record<string, pyObject | undefined>;
    yamlHost: FormTemplate | null;
    yamlHostRemovalRegistered: boolean;
    pendingScripts: SanitizedScript[];
    designerDropZones: Map<string, HTMLElement>;
    componentName?: string;
    _ensureRootElement(): HTMLElement;
    rootElement: HTMLElement;
    activeElement: HTMLElement;
    resetActiveElement(): void;
}

export interface HtmlComponent extends Container {
    _HtmlComponent?: HtmlComponentState;
    anvil$hookSpec: AnvilHookSpec<HtmlComponent>;
}

export interface HtmlComponentConstructor extends ContainerConstructor {
    new (): HtmlComponent;
}

const ANVIL_DOM_NODE_ATTR = "anvil:dom-node";
const ANVIL_DESIGNER_EDITABLE_TEXT_ATTR = "anvil:designer-editable-text";
const SPECIAL_ELEMENTS_SELECTOR = `anvil-dropzone,[${CSS.escape(ANVIL_DOM_NODE_ATTR)}],script`;
const ANVIL_ON_DOM_ATTR = "anvil:on-dom:";
const DEFAULT_DROPZONE_NAME = "default";
const CONSTRUCTOR_PROPERTY_NAMES = ["html", "classes", "style", "attrs", "visible", "tag"] as const;
const CONSTRUCTOR_PROPERTY_NAME_SET = new Set<string>(CONSTRUCTOR_PROPERTY_NAMES);
const hasOwnProperty = Object.prototype.hasOwnProperty;

const throwAttrsNotImplemented = (): never => {
    throw new pyNotImplementedError("HtmlComponent.attrs is not implemented yet");
};

function normalizeDropzoneTarget(target: string | null | undefined): string {
    return target || DEFAULT_DROPZONE_NAME;
}

function storedDropzoneTarget(target: string | null | undefined): string | null {
    const normalized = normalizeDropzoneTarget(target);
    return normalized === DEFAULT_DROPZONE_NAME ? null : normalized;
}

function dropzoneTargetsMatch(componentTarget: string | null | undefined, dropzoneName: string | null | undefined) {
    return normalizeDropzoneTarget(componentTarget) === normalizeDropzoneTarget(dropzoneName);
}

const ensureState = (instance: HtmlComponent): HtmlComponentState => {
    if (!instance._HtmlComponent) {
        const namedDomNodes = new Map<string, Element>();
        let state: HtmlComponentState | undefined;
        const classes = new Classes(pyNone);
        const style = new Style(pyNone, () => {
            if (ANVIL_IN_DESIGNER && state) {
                state.designerStyleOverride = undefined;
            }
        });
        state = instance._HtmlComponent = {
            _rootElement: null,
            _activeElement: null,
            html: "",
            classes,
            style,
            designerStyleOverride: undefined,
            visible: true,
            dropzones: new Map(),
            namedDomNodes,
            namedDomNodesProxy: new pyMappingProxy(proxy(namedDomNodes)),
            componentTargets: new WeakMap(),
            eventBindings: [],
            boundEventListeners: [],
            constructorPropertyValues: {},
            yamlHost: null,
            yamlHostRemovalRegistered: false,
            pendingScripts: [],
            designerDropZones: new Map(),
            componentName: undefined,
            _ensureRootElement() {
                if (!this._rootElement) {
                    const root = document.createElement("div");
                    setElementVisibility(root, this.visible);
                    this._rootElement = root;
                    this.classes.$setElement(root);
                    this.style.$setElement(root);
                }
                return this._rootElement!;
            },
            get rootElement() {
                return this._rootElement || this._ensureRootElement();
            },
            set rootElement(v: HTMLElement) {
                this._rootElement = v;
            },
            get activeElement() {
                return this._activeElement || this.rootElement;
            },
            set activeElement(v: HTMLElement) {
                this._activeElement = v;
            },
            resetActiveElement() {
                this._activeElement = null;
            },
        };
    }
    return instance._HtmlComponent;
};

export const registerHtmlComponentNamedDomNode = (instance: HtmlComponent, name: string, element: Element) => {
    const state = ensureState(instance);
    state.namedDomNodes.set(name, element);
};

export const unregisterHtmlComponentNamedDomNode = (instance: HtmlComponent, name: string, element: Element) => {
    const state = ensureState(instance);
    const existing = state.namedDomNodes.get(name);
    if (existing === element) {
        state.namedDomNodes.delete(name);
    }
};

export const getHtmlComponentForComponent = (instance: HtmlComponent): HtmlComponent => instance;

const getHtmlString = (value: pyObject | undefined) => {
    if (!value) {
        return "";
    }
    if (checkString(value)) {
        return value.toString();
    }
    return value.toString();
};

const getDesignerStyleOverride = (value: pyObject | undefined): string | null | undefined => {
    if (!ANVIL_IN_DESIGNER) {
        return undefined;
    }
    if (value === undefined || value === pyNone) {
        return null;
    }
    if (checkString(value)) {
        return value.toString();
    }
    return undefined;
};

const getActiveHtmlElementTextShape = (state: HtmlComponentState) => {
    if (state.activeElement === state.rootElement) {
        return { simple: false, nonEmpty: false };
    }

    const childNodes = state.activeElement.childNodes;
    if (childNodes.length === 0) {
        return { simple: true, nonEmpty: false };
    }
    if (childNodes.length === 1 && childNodes[0].nodeType === Node.TEXT_NODE) {
        return { simple: true, nonEmpty: !!childNodes[0].nodeValue?.trim() };
    }
    return { simple: false, nonEmpty: false };
};

const canInlineEditActiveHtmlElementText = (state: HtmlComponentState): boolean => {
    const textShape = getActiveHtmlElementTextShape(state);
    return textShape.simple && (textShape.nonEmpty || state.activeElement.hasAttribute(ANVIL_DESIGNER_EDITABLE_TEXT_ATTR));
};

const serializeDesignerHtmlElement = (element: HTMLElement): string => {
    const clone = element.cloneNode(true) as HTMLElement;
    Object.values(ACTIVE_CARRIER_ATTRS).forEach((attribute) => clone.removeAttribute(attribute));
    const text = clone.innerText;
    clone.textContent = clone.textContent;
    if (!!text.trim()) {
        clone.removeAttribute(ANVIL_DESIGNER_EDITABLE_TEXT_ATTR);
    } else {
        clone.setAttribute(ANVIL_DESIGNER_EDITABLE_TEXT_ATTR, "");
    }
    return clone.outerHTML;
};

const clearManagedRootStyling = (state: HtmlComponentState, element: HTMLElement) => {
    if (state.classes._element === element) {
        state.classes.$setTokens([]);
        state.classes.$setElement(null);
    }
    if (state.style._element === element) {
        state.style.$setEntries(new Map());
        state.style.$setElement(null);
    }
};

const hydrateRootStyling = (state: HtmlComponentState, element: HTMLElement) => {
    if (element === state.rootElement) {
        state.classes.$setElement(element);
        state.style.$setElement(element);
        state.classes.$setTokens([]);
        state.style.$setEntries(new Map());
        return;
    }

    state.classes.$setElement(element, true);
    state.style.$setElement(element, true);
};

const removeBoundEventListeners = (state: HtmlComponentState) => {
    state.boundEventListeners.forEach(({ element, eventName, listener }) => {
        element.removeEventListener(eventName, listener);
    });
    state.boundEventListeners.length = 0;
};

const loadPendingScriptsIfMounted = (instance: HtmlComponent) => {
    const state = ensureState(instance);
    if (!state.pendingScripts.length) {
        return pyNone;
    }

    if (!instance._Component.pageState.currentlyMounted) {
        return pyNone;
    }

    const scripts = state.pendingScripts;
    state.pendingScripts = [];

    const promise = loadSanitizedScripts(scripts);
    if (!promise) {
        return pyNone;
    }
    return promiseToSuspension(promise);
};

const applyEventBindings = (instance: HtmlComponent) => {
    const state = ensureState(instance);
    removeBoundEventListeners(state);

    state.eventBindings.forEach(({ element, eventName, handler }) => {
        const listener = (domEvent: Event) => {
            suspensionToPromise(() => {
                if (!state.yamlHost) {
                    return pyNone;
                }
                return chainOrSuspend(pyEval(handler, { self: state.yamlHost }), (pyHandler) => {
                    return pyCallOrSuspend(pyHandler, [toPy(domEvent)]);
                });
            });
        };
        element.addEventListener(eventName, listener);
        state.boundEventListeners.push({ element, eventName, listener });
    });
};

// Helper to check if a node should be ignored when determining the single child element
// (e.g., comment nodes and whitespace-only text nodes)
const isIgnorableNode = (node: Node): boolean => {
    if (node.nodeType === Node.COMMENT_NODE) {
        return true;
    }
    if (node.nodeType === Node.TEXT_NODE) {
        return !node.textContent || node.textContent.trim() === "";
    }
    return false;
};

const renderHtml = (instance: HtmlComponent) => {
    const state = ensureState(instance);
    const rootElement = state.rootElement;
    const previousVisibleNode = state.activeElement;
    const previousVisibleNodeParent = previousVisibleNode.parentNode;

    clearManagedRootStyling(state, previousVisibleNode);
    clearDesignerDropZones(state);

    removeBoundEventListeners(state);

    state.dropzones.clear();
    state.namedDomNodes.clear();
    state.resetActiveElement();
    state.eventBindings.length = 0;

    const parser = document.createElement("div");
    setInnerHTMLWithWrapping(parser, state.html);

    const specialElements = parser.querySelectorAll(SPECIAL_ELEMENTS_SELECTOR);
    const scriptElements: HTMLScriptElement[] = [];
    specialElements.forEach((node) => {
        if (node.tagName === "SCRIPT") {
            scriptElements.push(node as HTMLScriptElement);
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return;
        }
        if (node.tagName === "ANVIL-DROPZONE") {
            const name = node.getAttribute("name");
            if (name) {
                state.dropzones.set(name, node as HTMLElement);
            }
        }
        if (node.hasAttribute(ANVIL_DOM_NODE_ATTR)) {
            const name = node.getAttribute(ANVIL_DOM_NODE_ATTR);
            if (name) {
                state.namedDomNodes.set(name, node);
            }

            // Check for anvil-on:* event bindings on named elements
            for (const attr of node.attributes) {
                if (attr.name.startsWith(ANVIL_ON_DOM_ATTR)) {
                    const eventName = attr.name.substring(13);
                    state.eventBindings.push({
                        element: node,
                        eventName,
                        handler: attr.value,
                    });
                }
            }
        }
    });

    const allChildNodes = Array.from(parser.childNodes);
    // Filter to only meaningful nodes (elements and non-whitespace text nodes) for single-child check
    // We ignore comment nodes and whitespace-only text nodes
    const meaningfulNodes = allChildNodes.filter((node) => !isIgnorableNode(node));
    const childElements = meaningfulNodes.filter<HTMLElement>(
        (node): node is HTMLElement => node.nodeType === Node.ELEMENT_NODE
    );

    // Set activeElement if there's exactly one meaningful node and it's an element (not an ANVIL-DROPZONE)
    // This ensures we ignore comment nodes and whitespace-only text nodes when determining the single child
    if (meaningfulNodes.length === 1 && childElements.length === 1 && childElements[0].tagName !== "ANVIL-DROPZONE") {
        const child = childElements[0];
        state.activeElement = child;
        // Place all nodes (including comments) inside the reusable wrapper immediately so setupDom callers
        // (who may have cached rootElement) see the actual visible node even before mounting.
        // We preserve comment nodes and other non-element nodes for proper rendering.
        rootElement.replaceChildren(...allChildNodes);
    } else {
        rootElement.replaceChildren(...allChildNodes);
    }

    const visibleNode = state.activeElement;
    hydrateRootStyling(state, visibleNode);

    let shouldNotify = false;
    if (previousVisibleNode !== visibleNode) {
        previousVisibleNodeParent && previousVisibleNode.replaceWith(visibleNode);
        setElementVisibility(visibleNode, state.visible);
        setElementVisibility(previousVisibleNode, true);
        shouldNotify = true;
    }

    state.pendingScripts = sanitizeScripts(scriptElements);
    applyEventBindings(instance);
    // No need to re-register: the source map is already registered and updates automatically
    if (shouldNotify) {
        return raiseEventOrSuspend(instance, s_x_anvil_dom_node_changed);
    }
};

export const HtmlComponent: HtmlComponentConstructor = buildNativeClass("anvil.HtmlComponent", {
    constructor: function HtmlComponent(this: HtmlComponent) {},
    base: Container,
    slots: {
        tp$new(args, kws) {
            const self = Container.prototype.tp$new.call(this, args, kws) as HtmlComponent;
            const state = ensureState(self);
            const showHandler = funcFastCall(() => {
                const cbs = getListenerCallbacks(self, "show");
                if (cbs.length) {
                    return chainOrSuspend(null, ...cbs);
                }
                return pyNone;
            });
            const hideHandler = PyDefUtils.funcFastCall(() => {
                const cbs = getListenerCallbacks(self, "hide");
                if (cbs.length) {
                    return chainOrSuspend(null, ...cbs);
                }
                return pyNone;
            });
            const pageAddedHandler = PyDefUtils.funcFastCall(() => loadPendingScriptsIfMounted(self));
            self._Component.eventHandlers[s_x_anvil_classic_show.toString()] = [showHandler];
            self._Component.eventHandlers[s_x_anvil_classic_hide.toString()] = [hideHandler];
            self._Component.eventHandlers[s_x_anvil_page_added.toString()] = [pageAddedHandler];
            const kwsObj = kwsToObj(kws);
            state.constructorPropertyValues = {};
            for (const key of CONSTRUCTOR_PROPERTY_NAMES) {
                const value = kwsObj[key];
                state.constructorPropertyValues[key] = value;
                if (value !== undefined) {
                    self.tp$setattr(new pyStr(key), value);
                }
            }

            return self;
        },
        tp$init(args, kws) {
            if (args.length) {
                throw new pyTypeError("Component constructor takes keyword arguments only");
            }
            if (ANVIL_IN_DESIGNER) {
                return;
            }

            let ignorePropertyExceptions = false;
            const badKwargs: string[] = [];
            const chainFns: Array<() => pyObject | void> = [];
            const constructorKwValues: Record<string, pyObject | undefined> = {};

            for (const [propName, propVal] of iterKws(kws)) {
                if (propName === IGNORE_PROPERTY_EXCEPTIONS_KW) {
                    ignorePropertyExceptions = true;
                } else if (!CONSTRUCTOR_PROPERTY_NAME_SET.has(propName)) {
                    badKwargs.push(propName);
                } else {
                    constructorKwValues[propName] = propVal;
                }
            }

            if (!ignorePropertyExceptions && badKwargs.length) {
                throw new pyTypeError(
                    `${typeName(this)} got unexpected keyword argument(s): ${badKwargs.map((x) => `'${x}'`).join(", ")}`
                );
            }

            // Constructor kwargs should behave like setting these properties in order:
            // html first, then classes/style so walk the kws in that order.
            for (const propName of CONSTRUCTOR_PROPERTY_NAMES) {
                if (!hasOwnProperty.call(constructorKwValues, propName)) {
                    continue;
                }
                const propVal = constructorKwValues[propName];
                chainFns.push(() => this.tp$setattr(new pyStr(propName), propVal));
            }

            if (chainFns.length) {
                return chainOrSuspend(null, ...chainFns, () => undefined);
            }
        },
    },
    proto: {
        anvil$hookSpec: {
            setupDom(this: HtmlComponent) {
                const state = ensureState(this);
                return state.activeElement;
            },
            getDomElement(this: HtmlComponent) {
                const state = ensureState(this);
                return state.activeElement;
            },
            getEvents() {
                return [{ name: "show" }, { name: "hide" }];
            },
            getInteractions(this: HtmlComponent) {
                if (!ANVIL_IN_DESIGNER) {
                    return [];
                }
                const state = ensureState(this);
                if ((this._Container.components ?? []).length || !canInlineEditActiveHtmlElementText(state)) {
                    return [];
                }
                return [
                    {
                        type: "whole_component",
                        title: "Edit text",
                        icon: "edit",
                        callbacks: {
                            execute: () => {
                                designerApi.startInlineEditing(
                                    this,
                                    { name: "html", multiline: true },
                                    state.activeElement,
                                    {
                                        getPropertyValue: serializeDesignerHtmlElement,
                                    }
                                );
                            },
                        },
                        default: true,
                    },
                ];
            },
            getProperties() {
                return [
                    /*!componentProp(HtmlComponent)!1*/ {
                        name: "visible",
                        type: "boolean",
                        defaultValue: pyTrue,
                        group: "appearance",
                        description: "Should this component be displayed?",
                        designerHint: "visible",
                    },
                    /*!componentProp(HtmlComponent)!1*/ {
                        name: "tag",
                        type: "object",
                        defaultValue: null,
                        group: "user data",
                        description: "Use this property to store any extra information about this component",
                    },
                    /*!componentProp(HtmlComponent)!1*/ {
                        name: "html",
                        type: "html",
                        defaultValue: new pyStr(""),
                        description: "The HTML from which this component is defined.",
                        important: true,
                    },
                    /*!componentProp(HtmlComponent)!1*/ {
                        name: "classes",
                        type: "classes",
                        defaultValue: null,
                        group: "appearance",
                        pyType: "anvil.Classes instance",
                        description: "The class names applied to this HtmlComponent's root element.",
                    },
                    /*!componentProp(HtmlComponent)!1*/ {
                        name: "style",
                        type: "style",
                        defaultValue: null,
                        group: "appearance",
                        pyType: "anvil.Style instance",
                        description: "The inline styles applied to this HtmlComponent's root element.",
                    },
                ];
            },
            getContainerDesignInfo() {
                return {
                    layoutPropertyDescriptions: [{ name: "dropzone", type: "string", hidden: true }],
                };
            },
            getPropertyValueOverrides(this: HtmlComponent) {
                const state = ensureState(this);
                return state.designerStyleOverride === undefined ? {} : { style: state.designerStyleOverride };
            },
            enableDropMode(this: HtmlComponent, dropping: DroppingSpecification, flags?: DropModeFlags) {
                if (!ANVIL_IN_DESIGNER) return [];
                return designerEnableDropMode(this, dropping, flags);
            },
            disableDropMode(this: HtmlComponent) {
                const state = ensureState(this);
                clearDesignerDropZones(state);
            },
        },
        anvilComponent$registerWithForm(pyForm) {
            const self = this as HtmlComponent;
            const state = ensureState(self);
            if (!isTemplateForm(pyForm)) {
                return;
            }
            if (state.yamlHost) {
                // we might be a sub form of another yaml form, so we don't do anything here
                return;
            }
            state.yamlHost = pyForm;
            applyEventBindings(self);
            addFormTemplateNamedDomNodeSource(pyForm, state.namedDomNodes);
        },
    },
    getsets: {
        html: {
            $get() {
                return new pyStr(ensureState(this).html);
            },
            $set(value?: pyObject) {
                const state = ensureState(this);
                const htmlString = getHtmlString(value);
                const existingComponents = (this._Container.components ?? []).slice();
                const placements = existingComponents.map((component) => ({
                    component,
                    dropzoneName: state.componentTargets.get(component) ?? null,
                }));

                const removalFns = existingComponents.map((component) => {
                    const removeFn = component.tp$getattr<pyCallable>(s_remove_from_parent);
                    return () => pyCallOrSuspend(removeFn, []);
                });

                const addComponentMethod = this.tp$getattr<pyCallable>(s_add_component);

                const reattachFns = placements.map(({ component, dropzoneName }) => () => {
                    const kwArgs = dropzoneName !== null ? ["dropzone", new pyStr(dropzoneName)] : [];
                    return pyCallOrSuspend(addComponentMethod, [component], kwArgs);
                });

                return chainOrSuspend(
                    pyNone,
                    ...removalFns,
                    () => {
                        state.html = htmlString;
                        state.designerStyleOverride = undefined;
                        state.componentTargets = new WeakMap();
                        return renderHtml(this);
                    },
                    ...reattachFns,
                    () => loadPendingScriptsIfMounted(this)
                );
            },
        },
        dom_nodes: {
            $get() {
                const state = ensureState(this);
                return state.namedDomNodesProxy;
            },
        },
        classes: {
            $get() {
                return ensureState(this).classes;
            },
            $set(value?: pyObject) {
                const state = ensureState(this);
                state.classes.$setElement(state.activeElement);
                state.classes.$replace(value ?? pyNone);
            },
        },
        style: {
            $get() {
                return ensureState(this).style;
            },
            $set(value?: pyObject) {
                const state = ensureState(this);
                const designerStyleOverride = getDesignerStyleOverride(value);
                state.style.$setElement(state.activeElement);
                state.style.$replace(value ?? pyNone);
                state.designerStyleOverride = designerStyleOverride;
            },
        },
        attrs: {
            $get() {
                return throwAttrsNotImplemented();
            },
            $set(_value?: pyObject) {
                return throwAttrsNotImplemented();
            },
        },
        visible: {
            $get() {
                return ensureState(this).visible ? pyTrue : pyFalse;
            },
            $set(value?: pyObject) {
                const instance = this;
                const visible = value === undefined ? true : isTrue(value);
                const state = ensureState(instance);
                if (state.visible === visible) {
                    return;
                }
                state.visible = visible;
                const dom = state.activeElement;
                setElementVisibility(dom, visible);
                return notifyVisibilityChange(instance, visible);
            },
        },
    },
    methods: {
        add_component: {
            $meth(args, kws) {
                if (!args?.length) {
                    throw new pyValueError("HtmlComponent.add_component(): missing component argument");
                }
                const component = args[0] as Component;
                const layoutProps = kwsToObj(kws);
                const dropzoneNamePy = layoutProps["dropzone"];
                const dropzoneKey = normalizeDropzoneTarget(toJs(dropzoneNamePy)?.toString());
                const storedDropzoneKey = storedDropzoneTarget(dropzoneKey);
                const index = layoutProps["index"] ?? pyNone;
                const state = ensureState(this);
                let targetElement = state.dropzones.get(dropzoneKey);
                targetElement ??= state.activeElement;

                // TODO - decide whether to throw here or fallback to the root element
                if (!targetElement) {
                    throw new pyValueError(
                        storedDropzoneKey === null
                            ? "HtmlComponent root element is not initialised"
                            : `Unknown HtmlComponent dropzone name '${dropzoneKey}'`
                    );
                }

                return chainOrSuspend(component.anvil$hooks.setupDom(), (domElement: Element) => {
                    const superAddComponent = new pySuper(HtmlComponent, this).tp$getattr(s_add_component);
                    if (!superAddComponent) {
                        throw new pyValueError("HtmlComponent.add_component(): base implementation missing");
                    }
                    return chainOrSuspend(pyCallOrSuspend(superAddComponent, args, ["index", index]), (result) => {
                        state.componentTargets.set(component, storedDropzoneKey);
                        const components = this._Container.components ?? [];
                        const componentIndex = components.indexOf(component);
                        // Maintain DOM order when callers supply index= or reorder components.
                        // Find the next component in this dropzone and insert before its DOM node so
                        // the fragment reflects the container's logical ordering.
                        let insertBefore: Element | null = null;
                        for (let i = componentIndex + 1; i < components.length; i++) {
                            const other = components[i];
                            if (dropzoneTargetsMatch(state.componentTargets.get(other), storedDropzoneKey)) {
                                insertBefore = other.anvil$hooks?.domElement ?? null;
                                if (insertBefore && insertBefore.nodeType === Node.ELEMENT_NODE) {
                                    break;
                                }
                            }
                        }
                        if (insertBefore) {
                            targetElement.insertBefore(domElement, insertBefore);
                        } else {
                            targetElement.appendChild(domElement);
                        }
                        component.anvilComponent$onRemove(() => {
                            state.componentTargets.delete(component);
                        });
                        return result ?? pyNone;
                    });
                });
            },
            $flags: { FastCall: true },
        },
        // clear - just clears all components, no dropzone specific support
    },
    flags: {
        sk$klass: true,
    },
});

initNativeSubclass(HtmlComponent);

// ******************************************************** Designer helpers ********************************************************

const clearDesignerDropZones = (state: HtmlComponentState) => {
    if (state.designerDropZones.size === 0) {
        return;
    }
    state.designerDropZones.forEach((element) => {
        if (element.isConnected) {
            element.remove();
        }
    });
    state.designerDropZones.clear();
};

type HtmlComponentDropZoneMarkerShape = "horizontal" | "vertical" | "inline-vertical";
type LayoutNodeFlow = "inline" | "block" | undefined;

interface HtmlComponentDropZoneSizingContext {
    computedStyles: WeakMap<Element, CSSStyleDeclaration>;
    layoutParents: WeakMap<HTMLElement, HTMLElement | null>;
    layoutFlows: WeakMap<Node, LayoutNodeFlow>;
}

const displayTokens = (display: string) => new Set(display.split(/\s+/).filter(Boolean));

const getCachedComputedStyle = (element: Element, context?: HtmlComponentDropZoneSizingContext) => {
    if (!context) {
        return getComputedStyle(element);
    }
    let style = context.computedStyles.get(element);
    if (!style) {
        style = getComputedStyle(element);
        context.computedStyles.set(element, style);
    }
    return style;
};

const isIgnorableLayoutNode = (node: Node | null) =>
    !!node &&
    (node.nodeType === Node.COMMENT_NODE || (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === ""));

const layoutSibling = (
    node: Node,
    direction: "previous" | "next",
    context?: HtmlComponentDropZoneSizingContext
): Node | null => {
    let current: Node | null = node;
    while (current) {
        let sibling = direction === "previous" ? current.previousSibling : current.nextSibling;
        while (sibling && isIgnorableLayoutNode(sibling)) {
            sibling = direction === "previous" ? sibling.previousSibling : sibling.nextSibling;
        }
        if (sibling) {
            return sibling;
        }

        const parent: HTMLElement | null = current instanceof Element ? current.parentElement : null;
        if (!parent || getCachedComputedStyle(parent, context).display !== "contents") {
            return null;
        }
        current = parent;
    }
    return null;
};

const inlineDisplays = new Set(["inline", "inline-block", "inline-flex", "inline-grid", "inline-table", "ruby"]);

const layoutNodeFlow = (node: Node | null, context?: HtmlComponentDropZoneSizingContext): LayoutNodeFlow => {
    if (node && context?.layoutFlows.has(node)) {
        return context.layoutFlows.get(node);
    }

    let flow: LayoutNodeFlow;
    if (node?.nodeType === Node.TEXT_NODE) {
        flow = node.textContent?.trim() ? "inline" : undefined;
    } else if (!(node instanceof HTMLElement)) {
        flow = undefined;
    } else {
        const display = getCachedComputedStyle(node, context).display;
        const tokens = displayTokens(display);
        if (tokens.has("none") || tokens.has("contents")) {
            flow = undefined;
        } else {
            flow = inlineDisplays.has(display) || tokens.has("inline") ? "inline" : "block";
        }
    }

    if (node && context) {
        context.layoutFlows.set(node, flow);
    }
    return flow;
};

const isInlineFlowMarkerContext = (marker: HTMLElement, context?: HtmlComponentDropZoneSizingContext) => {
    const siblingFlows = [
        layoutNodeFlow(layoutSibling(marker, "previous", context), context),
        layoutNodeFlow(layoutSibling(marker, "next", context), context),
    ];

    return siblingFlows.includes("inline") && !siblingFlows.includes("block");
};

const getHtmlComponentDropZoneMarkerShape = (
    marker: HTMLElement,
    style: CSSStyleDeclaration,
    context?: HtmlComponentDropZoneSizingContext
): HtmlComponentDropZoneMarkerShape | undefined => {
    const display = displayTokens(style.display);
    const isFlex = display.has("flex") || display.has("inline-flex");

    if (isFlex) {
        const flexDirection = style.flexDirection || "row";
        if (flexDirection === "row" || flexDirection === "row-reverse") {
            return "vertical";
        }
        if (flexDirection === "column" || flexDirection === "column-reverse") {
            return "horizontal";
        }
    }

    if (
        (display.size === 1 && (display.has("inline") || display.has("ruby"))) ||
        isInlineFlowMarkerContext(marker, context)
    ) {
        return "inline-vertical";
    }

    if (display.has("block") || display.has("flow-root") || display.has("list-item")) {
        return "horizontal";
    }

    return undefined;
};

const resetDesignerDropZoneMarkerStyle = (marker: HTMLElement) => {
    marker.style.width = "";
    marker.style.minWidth = "";
    marker.style.height = "";
    marker.style.minHeight = "";
    marker.style.flex = "";
    marker.style.alignSelf = "";
    marker.style.boxSizing = "";
    marker.style.display = "";
    marker.style.verticalAlign = "";
};

const getEffectiveLayoutParent = (element: HTMLElement, context?: HtmlComponentDropZoneSizingContext) => {
    if (context?.layoutParents.has(element)) {
        return context.layoutParents.get(element);
    }

    let parent = element.parentElement;
    while (parent && getCachedComputedStyle(parent, context).display === "contents") {
        parent = parent.parentElement;
    }

    context?.layoutParents.set(element, parent);
    return parent;
};

const elementHeight = (node: Node | null) => (node instanceof HTMLElement ? node.getBoundingClientRect().height : 0);

const fallbackSiblingMarkerHeight = (marker: HTMLElement, hostElement: Element) => {
    const heights = [
        elementHeight(marker.previousElementSibling),
        elementHeight(marker.nextElementSibling),
        elementHeight(hostElement.previousElementSibling),
        elementHeight(hostElement.nextElementSibling),
    ];
    return Math.max(...heights, 0);
};

const sizeDesignerDropZoneMarker = (
    marker: HTMLElement,
    hostElement: Element,
    context?: HtmlComponentDropZoneSizingContext
) => {
    resetDesignerDropZoneMarkerStyle(marker);

    const layoutParent = getEffectiveLayoutParent(marker, context);
    if (!layoutParent) {
        return;
    }

    const shape = getHtmlComponentDropZoneMarkerShape(marker, getCachedComputedStyle(layoutParent, context), context);
    if (!shape) {
        return;
    }

    marker.style.boxSizing = "border-box";

    if (shape === "vertical" || shape === "inline-vertical") {
        if (shape === "inline-vertical") {
            marker.style.display = "inline-block";
            marker.style.verticalAlign = "middle";
        }
        marker.style.width = "0";
        marker.style.minWidth = "0";
        marker.style.flex = "0 0 0";
        marker.style.alignSelf = "stretch";

        if (marker.getBoundingClientRect().height === 0) {
            const fallbackHeight = fallbackSiblingMarkerHeight(marker, hostElement);
            if (fallbackHeight > 0) {
                marker.style.height = `${fallbackHeight}px`;
            }
        }
    } else {
        marker.style.height = "0";
        marker.style.minHeight = "0";
        marker.style.width = "100%";
        marker.style.flex = "0 0 0";
        marker.style.alignSelf = "stretch";
    }
};

function designerEnableDropMode(self: HtmlComponent, dropping: DroppingSpecification, flags?: DropModeFlags) {
    // - walk the  <anvil-dropzone> nodes (we will need to store this in the state if we don't already)
    // - compute insertion points around child anvil components, if we don't already we should keep a map of dropzone to it's child components or something
    // - create temporary marker elements and record them for cleanup (just use plain divs, with data attributes for the drop info)
    // - return DropZone descriptors with layout_properties, the name must match the <anvil-dropzone> name
    const layoutProperties = toJs(dropping.pyLayoutProperties) as Record<string, string>;
    const providedDropzoneName = layoutProperties?.dropzone ?? undefined;

    const state = ensureState(self);
    // Don't clear dropzones - we'll reuse existing ones if they exist
    const dropZones: DropZone[] = [];
    // Track active drop-markers by logical insertion point, so we can coalesce adjacent dropzones.
    // When two <anvil-dropzone> hosts touch, we only render one marker for the shared gap.
    interface MarkerInfo {
        marker: Element;
        dropZone: DropZone;
        dropzoneName: string;
        host: Element;
        minChildIdx: number;
        maxChildIdx: number | undefined;
        type: "head" | "tail" | "empty";
        order: number;
    }
    const neighbouringMarkersByHost = new Map<Element, Set<MarkerInfo>>();
    let neighbouringMarkerOrder = 0;

    const addNeighbouringMarker = (markerInfo: MarkerInfo) => {
        const hostMarkers = neighbouringMarkersByHost.get(markerInfo.host) ?? new Set<MarkerInfo>();
        hostMarkers.add(markerInfo);
        neighbouringMarkersByHost.set(markerInfo.host, hostMarkers);
    };

    const removeNeighbouringMarker = (markerInfo: MarkerInfo) => {
        const hostMarkers = neighbouringMarkersByHost.get(markerInfo.host);
        if (!hostMarkers) {
            return;
        }
        hostMarkers.delete(markerInfo);
        if (hostMarkers.size === 0) {
            neighbouringMarkersByHost.delete(markerInfo.host);
        }
    };

    const layoutPropsFromDropping =
        dropping?.pyLayoutProperties !== undefined ? toJs(dropping.pyLayoutProperties) : undefined;
    const components = self._Container.components ?? [];
    const sizingContext: HtmlComponentDropZoneSizingContext = {
        computedStyles: new WeakMap(),
        layoutParents: new WeakMap(),
        layoutFlows: new WeakMap(),
    };

    const createMarker = (dropzoneName: string, minChildIdx: number, maxChildIdx: number | undefined) => {
        // Key includes dropzone name and position to handle multiple markers per dropzone
        const markerKey = `${dropzoneName}:${minChildIdx}:${maxChildIdx}`;

        // Check if we already have a marker for this dropzone at this position
        // enable dropmode multiple times will reuse the same markers
        const existingMarker = state.designerDropZones.get(markerKey);
        if (existingMarker && existingMarker.isConnected) {
            return existingMarker;
        }

        // Create a new marker
        const marker = document.createElement("div");
        state.designerDropZones.set(markerKey, marker);
        marker.dataset.anvilHtmlComponentDropzone = "";
        marker.dataset.dropzoneName = dropzoneName;
        marker.dataset.minChildIdx = String(minChildIdx);
        marker.dataset.maxChildIdx = String(maxChildIdx);
        return marker;
    };

    const childEntriesByDropzone = new Map<string, { index: number; dom: Element | null }[]>();
    components.forEach((component, index) => {
        const dropzoneName = normalizeDropzoneTarget(state.componentTargets.get(component));
        const childEntries = childEntriesByDropzone.get(dropzoneName) ?? [];
        childEntries.push({
            index,
            dom: component.anvil$hooks?.domElement ?? null,
        });
        childEntriesByDropzone.set(dropzoneName, childEntries);
    });

    // Helpers so we can tell if two dropzone hosts are literally adjacent (ignoring whitespace text nodes).
    const isWhitespaceNode = (node: Node | null) =>
        !!node && node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === "";

    const nextMeaningfulSibling = (node: Node | null) => {
        let current = node?.nextSibling ?? null;
        while (current && isWhitespaceNode(current)) {
            current = current.nextSibling;
        }
        return current;
    };

    const previousMeaningfulSibling = (node: Node | null) => {
        let current = node?.previousSibling ?? null;
        while (current && isWhitespaceNode(current)) {
            current = current.previousSibling;
        }
        return current;
    };

    const findNeighbouringDropZone = (
        dropzoneName: string,
        hostElement: Element,
        minChildIdx: number,
        maxChildIdx: number | undefined
    ): DropZone | null => {
        const isEmptyMarker = minChildIdx === 0 && maxChildIdx === undefined;
        const isHeadMarker = minChildIdx === 0 && maxChildIdx !== undefined;
        const isTailMarker = maxChildIdx === undefined && minChildIdx !== 0;

        const removeMarker = (markerInfo: MarkerInfo) => {
            if (markerInfo.marker.isConnected) {
                markerInfo.marker.remove();
            }
            const markerKey = `${markerInfo.dropzoneName}:${markerInfo.minChildIdx}:${markerInfo.maxChildIdx}`;
            state.designerDropZones.delete(markerKey);
            const idx = dropZones.indexOf(markerInfo.dropZone);
            if (idx !== -1) {
                dropZones.splice(idx, 1);
            }
            removeNeighbouringMarker(markerInfo);
        };

        const neighbouringHostCandidates = [
            { host: previousMeaningfulSibling(hostElement), isNeighbouringAbove: true },
            { host: nextMeaningfulSibling(hostElement), isNeighbouringAbove: false },
        ];
        const neighbouringMarkerCandidates: { markerInfo: MarkerInfo; isNeighbouringAbove: boolean }[] = [];

        for (const { host, isNeighbouringAbove } of neighbouringHostCandidates) {
            if (!(host instanceof Element)) {
                continue;
            }
            const hostMarkers = neighbouringMarkersByHost.get(host);
            if (!hostMarkers) {
                continue;
            }

            for (const neighbouringMarker of [...hostMarkers]) {
                neighbouringMarkerCandidates.push({ markerInfo: neighbouringMarker, isNeighbouringAbove });
            }
        }

        neighbouringMarkerCandidates.sort((a, b) => a.markerInfo.order - b.markerInfo.order);

        for (const { markerInfo: neighbouringMarker, isNeighbouringAbove } of neighbouringMarkerCandidates) {
            if (neighbouringMarker.dropzoneName === dropzoneName) {
                continue;
            }
            const isNeighbouringBelow = !isNeighbouringAbove;
            if (neighbouringMarker.type === "empty") {
                // always return the first empty marker
                if (isEmptyMarker) {
                    return neighbouringMarker.dropZone;
                }
                if (isHeadMarker && isNeighbouringAbove) {
                    return neighbouringMarker.dropZone;
                }
                if (isTailMarker && isNeighbouringBelow) {
                    return neighbouringMarker.dropZone;
                }
            } else if (isEmptyMarker) {
                if (isHeadMarker && isNeighbouringAbove) {
                    removeMarker(neighbouringMarker);
                    continue;
                }
                if (isTailMarker && isNeighbouringBelow) {
                    removeMarker(neighbouringMarker);
                    continue;
                }
                continue;
            } else if (isHeadMarker && isNeighbouringAbove && neighbouringMarker.type === "tail") {
                return neighbouringMarker.dropZone;
            } else if (isTailMarker && isNeighbouringBelow && neighbouringMarker.type === "head") {
                return neighbouringMarker.dropZone;
            }
        }

        return null;
    };

    const registerDropZone = (
        dropzoneName: string,
        hostElement: Element,
        minChildIdx: number,
        maxChildIdx: number | undefined,
        layoutProps: Record<string, unknown>,
        referenceNode: ChildNode | null
    ) => {
        const isEmptyMarker = minChildIdx === 0 && maxChildIdx === undefined;
        const isHeadMarker = minChildIdx === 0 && maxChildIdx !== undefined;
        const isTailMarker = maxChildIdx === undefined && minChildIdx !== 0;
        const isNeighbouringMarker = isHeadMarker || isTailMarker || isEmptyMarker;

        // Check all existing markers for adjacency, not just those with the same position key
        // This allows us to coalesce markers from different dropzones that are adjacent in the DOM
        if (isNeighbouringMarker) {
            // we only care about head and tail dropzones
            const neighbouringDropZone = findNeighbouringDropZone(dropzoneName, hostElement, minChildIdx, maxChildIdx);
            if (neighbouringDropZone) {
                return neighbouringDropZone;
            }
        }

        // No existing marker claimed this insertion point (or we won the tie-break). Create one.
        const marker = createMarker(dropzoneName, minChildIdx, maxChildIdx);
        if (referenceNode) {
            hostElement.insertBefore(marker, referenceNode);
        } else {
            hostElement.appendChild(marker);
        }
        sizeDesignerDropZoneMarker(marker, hostElement, sizingContext);
        const dropZone: DropZone = {
            element: marker,
            dropInfo: {
                minChildIdx,
                maxChildIdx,
                layout_properties: { ...layoutProps },
            },
        };
        dropZones.push(dropZone);
        // Store marker info for future coalescing checks
        if (isNeighbouringMarker) {
            addNeighbouringMarker({
                marker,
                dropZone,
                dropzoneName,
                host: hostElement,
                minChildIdx,
                maxChildIdx,
                type: isEmptyMarker ? "empty" : isHeadMarker ? "head" : "tail",
                order: neighbouringMarkerOrder++,
            });
        }
        return dropZone;
    };

    // If no dropzones exist, create a default one
    if (state.dropzones.size === 0) {
        const defaultHostElement = state.activeElement;
        if (defaultHostElement.dataset.anvilYamlCarrier) {
            state.dropzones.set("default", defaultHostElement);
        }
    }

    for (const [dropzoneName, hostElement] of state.dropzones.entries()) {
        if (!hostElement.isConnected) {
            continue;
        }
        if (providedDropzoneName && providedDropzoneName !== dropzoneName) {
            continue;
        }

        const baseLayoutProperties: Record<string, unknown> = {
            ...(layoutPropsFromDropping ?? {}),
        };

        // HtmlComponent treats the default dropzone as implicit: children dropped there do
        // not store layout_properties.dropzone. Named dropzones must opt in explicitly.
        if (dropzoneName !== DEFAULT_DROPZONE_NAME) {
            baseLayoutProperties.dropzone = dropzoneName;
        }

        const childEntries = childEntriesByDropzone.get(normalizeDropzoneTarget(dropzoneName)) ?? [];

        // No children in this dropzone: allow insertion anywhere in the container's
        // component list. This matches DesignHtmlTemplateV3's behaviour of advertising
        // a single range [0, end] for an empty dropzone.
        if (!childEntries.length) {
            registerDropZone(dropzoneName, hostElement, 0, undefined, baseLayoutProperties, null);
            continue;
        }

        // There are existing components in this dropzone. We construct ranges that
        // behave like DesignHtmlTemplateV3:
        //   - Start with minChildIdx = 0
        //   - For each child at index i, advertise a gap [minChildIdx, i]
        //   - Then advance minChildIdx to i + 1
        //   - Finally, add a "tail" gap from the last minChildIdx to the end
        let minChildIdx = 0;

        childEntries.forEach((entry) => {
            const referenceNode =
                entry.dom && entry.dom.nodeType === Node.ELEMENT_NODE && entry.dom.parentElement === hostElement
                    ? entry.dom
                    : null;
            registerDropZone(dropzoneName, hostElement, minChildIdx, entry.index, baseLayoutProperties, referenceNode);
            minChildIdx = entry.index + 1;
        });
        const lastEntry = childEntries[childEntries.length - 1];
        const referenceForTail =
            lastEntry.dom && lastEntry.dom.nodeType === Node.ELEMENT_NODE && lastEntry.dom.parentElement === hostElement
                ? lastEntry.dom.nextSibling
                : null;
        // Tail gap: allow any insertion index >= minChildIdx. We model this as
        // [minChildIdx, undefined], mirroring the behaviour of DesignHtmlTemplateV3's
        // final drop zone.
        registerDropZone(dropzoneName, hostElement, minChildIdx, undefined, baseLayoutProperties, referenceForTail);
    }
    return dropZones;
}

/*!defClass(anvil,HtmlComponent,Container)!*/
