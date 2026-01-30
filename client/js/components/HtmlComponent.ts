import {
    loadScripts as loadSanitizedScripts,
    SanitizedScript,
    sanitizeScripts,
    setInnerHTMLWithWrapping,
} from "@runtime/html-form/dom-utils";
import { DropModeFlags } from "@runtime/runner/python-objects";
import {
    buildNativeClass,
    chainOrSuspend,
    checkString,
    isTrue,
    promiseToSuspension,
    proxy,
    pyCallable,
    pyCallOrSuspend,
    pyEval,
    pyFalse,
    pyMappingProxy,
    pyNone,
    pyObject,
    pyStr,
    pySuper,
    pyTrue,
    pyValueError,
    suspensionToPromise,
    toJs,
    toPy,
} from "@Sk";
import PyDefUtils from "PyDefUtils";
import { setElementVisibility } from "../runner/components-in-js/public-api/property-utils";
import type { FormTemplate } from "../runner/forms";
import { addFormTemplateNamedDomNodeSource, isTemplateForm } from "../runner/forms";
import {
    initNativeSubclass,
    kwsToObj,
    s_add_component,
    s_remove_from_parent,
    s_x_anvil_classic_hide,
    s_x_anvil_classic_show,
    s_x_anvil_dom_node_changed,
    s_x_anvil_page_added,
} from "../runner/py-util";
import type { AnvilHookSpec, DroppingSpecification, DropZone } from "./Component";
import { Component, getListenerCallbacks, notifyVisibilityChange, raiseEventOrSuspend } from "./Component";
import type { ContainerConstructor } from "./Container";
import { Container } from "./Container";

interface HtmlComponentState {
    _rootElement: HTMLElement | null;
    _activeElement: HTMLElement | null;
    html: string;
    visible: boolean;
    dropzones: Map<string, HTMLElement>;
    namedDomNodes: Map<string, Element>;
    namedDomNodesProxy: pyMappingProxy;
    componentTargets: WeakMap<pyObject, string | null>;
    eventBindings: { element: Element; eventName: string; handler: string }[];
    boundEventListeners: { element: Element; eventName: string; listener: (event: Event) => void }[];
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
const SPECIAL_ELEMENTS_SELECTOR = `anvil-dropzone,[${CSS.escape(ANVIL_DOM_NODE_ATTR)}],script`;
const ANVIL_ON_DOM_ATTR = "anvil:on-dom:";

const ensureState = (instance: HtmlComponent): HtmlComponentState => {
    if (!instance._HtmlComponent) {
        const namedDomNodes = new Map<string, Element>();
        instance._HtmlComponent = {
            _rootElement: null,
            _activeElement: null,
            html: "",
            visible: true,
            dropzones: new Map(),
            namedDomNodes,
            namedDomNodesProxy: new pyMappingProxy(proxy(namedDomNodes)),
            componentTargets: new WeakMap(),
            eventBindings: [],
            boundEventListeners: [],
            yamlHost: null,
            yamlHostRemovalRegistered: false,
            pendingScripts: [],
            designerDropZones: new Map(),
            componentName: undefined,
            _ensureRootElement() {
                if (!this._rootElement) {
                    const root = document.createElement("div");
                    root.classList.add("anvil-html-component");
                    setElementVisibility(root, this.visible);
                    this._rootElement = root;
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
                    pyCallOrSuspend(pyHandler, [toPy(domEvent)]);
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
            ensureState(self);
            const showHandler = PyDefUtils.funcFastCall(() => {
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
            for (const key of ["html", "visible", "tag"]) {
                const value = kwsObj[key];
                if (value !== undefined) {
                    self.tp$setattr(new pyStr(key), value);
                }
            }

            return self;
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
            getProperties() {
                return [
                    {
                        name: "visible",
                        type: "boolean",
                        defaultValue: pyTrue,
                        group: "appearance",
                        designerHint: "visible",
                    },
                    {
                        name: "tag",
                        type: "object",
                        defaultValue: null,
                        group: "user data",
                    },
                    {
                        name: "html",
                        type: "html",
                        defaultValue: new pyStr(""),
                        important: true,
                    },
                ];
            },
            getContainerDesignInfo() {
                return {
                    layoutPropertyDescriptions: [{ name: "dropzone", type: "string", hidden: true }],
                };
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
                let dropzoneKey = toJs(dropzoneNamePy)?.toString();
                const index = layoutProps["index"] ?? pyNone;
                const state = ensureState(this);
                let targetElement = state.dropzones.get(dropzoneKey || "default");
                targetElement ??= state.activeElement;

                // TODO - decide whether to throw here or fallback to the root element
                if (!targetElement) {
                    throw new pyValueError(
                        dropzoneKey === null
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
                        state.componentTargets.set(component, dropzoneKey ?? null);
                        const components = this._Container.components ?? [];
                        const componentIndex = components.indexOf(component);
                        // Maintain DOM order when callers supply index= or reorder components.
                        // Find the next component in this dropzone and insert before its DOM node so
                        // the fragment reflects the container's logical ordering.
                        let insertBefore: Element | null = null;
                        for (let i = componentIndex + 1; i < components.length; i++) {
                            const other = components[i];
                            if (state.componentTargets.get(other) === dropzoneKey) {
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
    }
    const neighbouringMarkers: Set<MarkerInfo> = new Set();

    const layoutPropsFromDropping =
        dropping?.pyLayoutProperties !== undefined ? toJs(dropping.pyLayoutProperties) : undefined;
    const components = self._Container.components ?? [];

    const componentIndices = new Map<Component, number>();
    components.forEach((component, index) => componentIndices.set(component, index));

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

    const allChildEntries = components
        .map((component, index) => ({
            component,
            index,
            dom: component.anvil$hooks?.domElement ?? null,
            targetId: state.componentTargets.get(component) ?? null,
        }))
        .sort((a, b) => a.index - b.index);

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
            neighbouringMarkers.delete(markerInfo);
        };

        // Spread to array to safely iterate while potentially modifying the Set
        for (const neighbouringMarker of [...neighbouringMarkers]) {
            if (neighbouringMarker.dropzoneName === dropzoneName) {
                continue;
            }
            const isNeighbouringAbove = previousMeaningfulSibling(hostElement) === neighbouringMarker.host;
            const isNeighbouringBelow = nextMeaningfulSibling(hostElement) === neighbouringMarker.host;
            const isAdjacent = isNeighbouringAbove || isNeighbouringBelow;
            if (!isAdjacent) {
                continue;
            }
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
            neighbouringMarkers.add({
                marker,
                dropZone,
                dropzoneName,
                host: hostElement,
                minChildIdx,
                maxChildIdx,
                type: isEmptyMarker ? "empty" : isHeadMarker ? "head" : "tail",
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

        if (dropzoneName !== "default") {
            baseLayoutProperties.dropzone = dropzoneName;
        }

        const childEntries = allChildEntries.filter((entry) => entry.targetId === dropzoneName);

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
