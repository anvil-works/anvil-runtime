// TODO: The Python types in this file belong in the global Anvil module. This should probably be unified at some
// point, but anvil.js is already 1300 lines of JS, so we're doing it here for now.
import {
    Args,
    Kws,
    Suspension,
    chainOrSuspend,
    checkCallable,
    isTrue,
    objectRepr,
    pyAttributeError,
    pyCallOrSuspend,
    pyCallable,
    pyDict,
    pyException,
    pyIsSubclass,
    pyList,
    pyNone,
    pyObject,
    pyStr,
    pySuper,
    pyType,
    toJs,
    toPy,
    tryCatchOrSuspend,
} from "../@Sk";
import {
    Component,
    ComponentConstructor,
    ContainerDesignInfo,
    DropZone,
    DroppingSpecification,
    ToolboxItem,
    addEventHandler,
    raiseEventOrSuspend,
} from "../components/Component";
import { data } from "./data";
import {
    ResolvedForm,
    getAnvilComponentInstantiator,
    getNamedFormInstantiator,
    resolveFormSpec,
} from "./instantiation";
import {
    anvilMod,
    getModule,
    importFrom,
    initNativeSubclass,
    kwsToObj,
    objToKws,
    s_add_component,
    s_hide,
    s_init_subclass,
    s_layout,
    s_remove_from_parent,
    s_show,
    s_slots,
    s_x_anvil_classic_hide,
    s_x_anvil_classic_show,
    strError,
} from "./py-util";

interface SlotConstructor extends pyType<Slot> {
    new (
        getPyContainer?: () => Suspension | pyObject,
        index?: number,
        setLayoutProps?: { [prop: string]: pyObject },
        oneComponent?: boolean,
        templateSpec?: ToolboxItem
    ): Slot;
}

export interface DropModeFlags {
    asComponent?: boolean;
    allowOtherComponentUpdates?: boolean;
}

export interface HasRelevantHooks {
    enableDropMode: (dropping: DroppingSpecification, flags?: DropModeFlags) => DropZone[];
    disableDropMode: () => void;
    getContainerDesignInfo(component: Component): ContainerDesignInfo;
}

interface SlotCache {
    pyTarget: pyObject;
    hooks: HasRelevantHooks;
    pyAddComponent: pyCallable;
}

interface SlotState extends HasRelevantHooks {
    getPyTarget: () => pyObject | Suspension;
    insertionIndex: number;
    cache?: SlotCache;
    fillCache: () => SlotCache | Suspension;
    pyLayoutProps: pyDict;
    components: Component[];
    oneComponent: boolean;
    lastUse: null | pyObject;
    canAddComponent: () => boolean;
    templateSpec?: ToolboxItem;
    // TODO I tried to be clever with Typescript type merging and it didn't work, so sticking this into the runtime
    templateComponent?: Component;
    earlierSlots: Slot[];
    calculateOffset(): number;
}

export interface Slot extends pyObject {
    _slotState: SlotState;
}

function mkSlotState(
    getPyTarget: () => Suspension | pyObject,
    insertionIndex: number,
    pyLayoutProps: pyDict,
    oneComponent: boolean,
    templateSpec: ToolboxItem | undefined
): SlotState {
    return {
        getPyTarget: getPyTarget,
        pyLayoutProps,
        insertionIndex,
        components: [],
        oneComponent,
        templateSpec,
        lastUse: null,
        earlierSlots: [],
        canAddComponent() {
            return this.components.length === 0 || !this.oneComponent;
        },
        fillCache() {
            return (
                this.cache ||
                chainOrSuspend(getPyTarget(), (pyTarget) =>
                    chainOrSuspend(pyTarget._slotState?.fillCache(), () => {
                        const pyAddComponent = Sk.abstr.gattr(pyTarget, s_add_component) as pyCallable;
                        return (this.cache = {
                            pyTarget,
                            pyAddComponent,
                            hooks: pyTarget.anvil$hooks || pyTarget._slotState,
                        });
                    })
                )
            );
        },
        calculateOffset() {
            let offset = 0;
            for (const s of this.earlierSlots) {
                offset += s._slotState.components.length;
            }
            return offset;
        },
        enableDropMode(dropping) {
            const pyLayoutProperties = (dropping.pyLayoutProperties || new pyDict()).nb$or(this.pyLayoutProps);
            const offset = this.calculateOffset();
            const dropZones: DropZone[] =
                this.cache?.hooks.enableDropMode?.({
                    ...dropping,
                    pyLayoutProperties,
                    minChildIdx: this.insertionIndex + offset,
                    maxChildIdx: this.insertionIndex + offset + this.components.length,
                }) || [];
            const filteredDropzones = dropZones
                .filter(
                    ({ element, dropInfo: { minChildIdx, maxChildIdx, layout_properties } = {} }) =>
                        ((minChildIdx === undefined && maxChildIdx === undefined) || // This DZ will accept a component at any index
                            (maxChildIdx === undefined &&
                                minChildIdx !== undefined &&
                                minChildIdx <= this.insertionIndex + offset + this.components.length) ||
                            (minChildIdx === undefined &&
                                maxChildIdx !== undefined &&
                                maxChildIdx >= this.insertionIndex + offset) ||
                            (minChildIdx !== undefined &&
                                maxChildIdx !== undefined &&
                                minChildIdx <= this.insertionIndex + offset + this.components.length &&
                                maxChildIdx >= this.insertionIndex + offset)) &&
                        this.pyLayoutProps
                            .$items()
                            .every(([pyPropName, pyPropVal]) =>
                                Sk.misceval.richCompareBool(
                                    toPy(layout_properties?.[pyPropName.toString()]),
                                    pyPropVal,
                                    "Eq"
                                )
                            )
                )
                .map(({ dropInfo: { minChildIdx, maxChildIdx, layout_properties, ...dropInfo } = {}, ...dz }) => ({
                    ...dz,
                    dropInfo: {
                        ...dropInfo,
                        layout_properties: Object.fromEntries(
                            Object.entries(layout_properties ?? {}).filter(
                                ([k, v]) => !this.pyLayoutProps.quick$lookup(new pyStr(k))
                            )
                        ),
                        minChildIdx:
                            minChildIdx === undefined
                                ? undefined
                                : Math.max(minChildIdx - this.insertionIndex - offset, 0),
                        maxChildIdx:
                            maxChildIdx === undefined
                                ? undefined
                                : Math.min(maxChildIdx - this.insertionIndex - offset, this.components.length),
                        _originalMinChildIdx: minChildIdx, // For debugging
                        _originalMaxChildIdx: maxChildIdx,
                    },
                }));

            console.log(
                toJs(this.pyLayoutProps),
                "got DZs from parent",
                dropZones,
                "with offset",
                offset,
                "target",
                this.cache?.pyTarget,
                "insertion idx",
                this.insertionIndex,
                "components",
                this.components.length,
                "Filtered DZs:",
                filteredDropzones
            );
            return filteredDropzones;
        },
        disableDropMode() {
            this.cache?.hooks.disableDropMode();
        },
        getContainerDesignInfo(pyComponent) {
            const di = this.cache?.hooks.getContainerDesignInfo?.(pyComponent);
            return {
                ...(di || {}),
                layoutPropertyDescriptions: (di?.layoutPropertyDescriptions || []).filter(
                    (lpd) => !pyLayoutProps.quick$lookup(new pyStr(lpd.name))
                ),
            };
        },
    };
}

export const Slot: SlotConstructor = Sk.abstr.buildNativeClass("anvil.Slot", {
    constructor: function Slot(getPyContainer, insertionIndex, layoutProps, oneComponent, templateSpec) {
        if (getPyContainer) {
            this._slotState = mkSlotState(
                getPyContainer,
                insertionIndex!,
                toPy(layoutProps || {}),
                !!oneComponent,
                templateSpec
            );
        }
    },
    slots: {
        tp$init(args, kwargs) {
            Sk.abstr.checkArgsLen("Slot", args, 2, 3);
            const [pyContainer, pyInsertionIndex, pyLayoutProps, pyTemplateSpec] = args as [
                pyObject,
                pyObject,
                pyObject,
                pyObject | undefined
            ];
            const insertionIndex = toJs(pyInsertionIndex);
            if (typeof insertionIndex !== "number") {
                throw new Sk.builtin.TypeError("the second argument (insertion index) should be an integer");
            }
            if (!(pyLayoutProps instanceof Sk.builtin.dict)) {
                throw new Sk.builtin.TypeError("the third argument (layout properties) should be a dict");
            }
            if (pyTemplateSpec && !(pyTemplateSpec instanceof Sk.builtin.dict) && pyTemplateSpec !== pyNone) {
                throw new Sk.builtin.TypeError("the third argument (template spec) should be a dict or None");
            }
            const { one_component } = kwsToObj(kwargs);
            this._slotState = mkSlotState(
                () => pyContainer,
                insertionIndex,
                pyLayoutProps,
                isTrue(one_component),
                toJs(pyTemplateSpec) as ToolboxItem
            );
        },
    },
    methods: {
        add_component: {
            $meth(args, kwargs) {
                Sk.abstr.checkArgsLen("add_component", args, 1, 1);
                const [pyComponent] = args;
                const layoutProps = kwsToObj(kwargs);

                const { _slotState } = this;

                // Overwrite layout props with props this slot sets
                for (const [k, v] of _slotState.pyLayoutProps.$items()) {
                    layoutProps[k.toString()] = v;
                }

                // Adjust for index
                const insertionIndex = layoutProps["index"] ? toJs(layoutProps["index"]) : _slotState.components.length;
                if (typeof insertionIndex !== "number") {
                    throw new Sk.builtin.ValueError("index= must be a number");
                }
                const offset = _slotState.calculateOffset();
                layoutProps["index"] = new Sk.builtin.int_(insertionIndex + _slotState.insertionIndex + offset);

                //console.log("Inserting", pyComponent, "into slot at index", layoutProps["index"].v, "because this slot has insertion index", _slotState.insertionIndex, "and offset", offset);

                const nextKws = objToKws(layoutProps);
                if (!_slotState.canAddComponent()) {
                    throw new Sk.builtin.ValueError("There is already a component in this slot");
                }
                _slotState.lastUse = pyComponent;

                return chainOrSuspend(
                    _slotState.fillCache(),
                    ({ pyAddComponent }) => Sk.misceval.callsimOrSuspendArray(pyAddComponent, [pyComponent], nextKws),
                    () => {
                        // Add it to components
                        pyComponent.anvilComponent$onRemove(() => {
                            _slotState.components = _slotState.components.filter((c) => c !== pyComponent);
                        });
                        _slotState.components.push(pyComponent);
                        return pyNone;
                    }
                );
            },
            $flags: { FastCall: true },
        },
        get_components: {
            $meth() {
                return new pyList([...this._slotState.components]);
            },
            $flags: { NoArgs: true },
        },
        clear: {
            $meth() {
                for (const c of [...this._slotState.components]) {
                    Sk.misceval.callsim(Sk.abstr.gattr(c, s_remove_from_parent));
                }
                this._slotState.components = []; // just in case
                return pyNone;
            },
            $flags: { NoArgs: true },
        },
        offset_by_slot: {
            $meth(args) {
                Sk.abstr.checkArgsLen("offset_by_slot", args, 1, 1);
                const [pySlot] = args;
                this._slotState.earlierSlots.push(pySlot);
                return pyNone;
            },
            $flags: { FastCall: true },
        },
    },
});
/*!defMethod(_,target_container,insertion_index,[layout_properties])!2*/ ({
    $doc: "A Slot class represents a way to add components to an underlying container. You will rarely instantiate a Slot on its own; instead your form's layout will contain Slots to which you can add components.",
    anvil$args: {
        target_container: "The target container into which components added to this slot will be added.",
        insertion_index:
            "The starting index (within the target container) at which components added to this slot will be inserted.",
        layout_properties:
            "A dictionary of layout properties that will be passed as keyword arguments to the target container's add_component() call, overriding any values provided to the slot's add_component().",
    },
});
["__init__"];
/*!defMethod(_,component,[index=None],**layout_properties)!2*/ ({
    $doc: "Add a component to this slot.\n\nCalling add_component() on a Slot will add the specified component to its target container.",
    anvil$args: {
        component: "The component to add to this slot.",
        index: "The index, within the slot, at which the component is to be inserted. Note: This argument is index is within the Slot, not within the target container. The Slot will adjust for its own insertion_index, as well as components in any previous slots registered with offset_by_slot(), when computing the index= parameter to the target container's add_component() method.",
        layout_properties:
            "Layout properties will be passed on as keyword arguments to the target container's add_component() method, unless overridden by the Slot.",
    },
});
["add_component"];
/*!defMethod(_,offset_by_slot)!2*/ ({
    $doc: "Inform this Slot of an earlier Slot with the same target container. Future calls to add_component() will take account of any components inserted into the earlier slot when calculating the insertion index for the target container, thereby preserving ordering between the two slots' components.",
    anvil$args: {
        earlier_slot:
            "The Slot whose contents will offset this Slot's target indices. This argument must be a Slot object with the same target container as this one, and the same or earlier insertion_index.",
    },
});
["offset_by_slot"];
/*!defClass(anvil,Slot)!*/

export function getComponentClass(typeSpec: string, defaultDepId: string): ComponentConstructor | Suspension {
    const customComponentMatch = typeSpec.match(/^form:(?:([^:]+):)?([^:]*)$/);
    if (!customComponentMatch) {
        return anvilMod[typeSpec] as ComponentConstructor;
    }
    const [_, logicalDepId, formName] = customComponentMatch;
    const depId = logicalDepId ? data.logicalDepIds[logicalDepId] : null;
    const appPackage = depId
        ? data.app.dependency_code[depId].package_name
        : defaultDepId
        ? data.app.dependency_code[defaultDepId].package_name
        : data.appPackage;
    if (!appPackage) {
        throw `Missing dependency with ID "${depId || logicalDepId}"`;
    }
    const [__, pkgPrefix, className] = formName.match(/^(.+\.)?([^.]+)$/)!;
    const formModuleName = `${appPackage}.${pkgPrefix || ""}${className}`;

    return chainOrSuspend(
        tryCatchOrSuspend(
            () => getModule(formModuleName, true),
            (exception) => {
                // This is probably user code, so surface it:
                // @ts-ignore
                window.onerror(null, null, null, null, exception);
                throw `Error importing ${formModuleName}: ${strError(exception)}`;
            }
        ),
        () => importFrom<ComponentConstructor>(formModuleName, className)
    );
}

type InstantiateFn = (kwargs?: Kws, pathId?: string | number) => Component | Suspension;

interface LayoutSubclassHooks {
    layout:
        | { type: "form"; formSpec: ResolvedForm }
        | { type: "builtin"; name: string }
        | { type: "constructor"; constructor: pyCallable };
}
interface WithLayoutConstructor extends ComponentConstructor {
    _withLayoutSubclass?: LayoutSubclassHooks;
    new (): WithLayout;
}

export interface WithLayout extends Component {
    $d: pyDict;
    _withLayout: {
        kwargs?: Kws;
        // TODO what is the type of pyLayout?
        onAssociate?(pyLayout: Component, pyForm: WithLayout): pyObject | Suspension;
        onDissociate?(pyLayout: Component, pyForm: WithLayout): pyObject | Suspension;
        domElement: HTMLElement | undefined | null;
        pyLayout?: Component | null;
        _pyLayout?: Component | null;
        _withLayoutSubclass?: LayoutSubclassHooks;
    };
    $setupPageState(this: WithLayout): void;
    $requireLayout(this: WithLayout, fn: (layout: Component) => any): any;
}

export const WithLayout: WithLayoutConstructor = Sk.abstr.buildNativeClass("anvil.WithLayout", {
    constructor: function WithLayout() {
        this.$d = new pyDict();
    },

    base: Component,

    slots: {
        tp$new(args, kwargs) {
            const { _withLayoutSubclass } = this.constructor as WithLayoutConstructor;
            const self = Component.prototype.tp$new.call(this, []) as WithLayout;
            const [pyOnAssociate, pyOnDissociate] = args;
            const onAssociate = checkCallable(pyOnAssociate)
                ? (pyLayout: Component, pyForm: WithLayout) => pyOnAssociate.tp$call([pyLayout, pyForm])
                : undefined;
            const onDissociate = checkCallable(pyOnDissociate)
                ? (pyLayout: Component, pyForm: WithLayout) => pyOnDissociate.tp$call([pyLayout, pyForm])
                : undefined;

            self._withLayout = {
                kwargs,
                onAssociate,
                onDissociate,
                domElement: null,
                _pyLayout: null,
                _withLayoutSubclass,
                get pyLayout() {
                    return this._pyLayout;
                },
                set pyLayout(v) {
                    if (this._pyLayout) {
                        delete this._pyLayout._Component.portalParent;
                        this.domElement = null;
                    }
                    this._pyLayout = v;
                    self.$setupPageState();
                },
            };

            addEventHandler(self, s_x_anvil_classic_show, () => raiseEventOrSuspend(self, s_show));
            addEventHandler(self, s_x_anvil_classic_hide, () => raiseEventOrSuspend(self, s_hide));

            return self;
        },
        tp$init(args, kwargs) {
            const [pyOnAssociate, pyOnDissociate] = args;
            if (pyOnAssociate) {
                this._withLayout.onAssociate = (pyLayout, pyForm) => pyCallOrSuspend(pyOnAssociate, [pyLayout, pyForm]);
            }
            if (pyOnDissociate) {
                this._withLayout.onDissociate = (pyLayout, pyForm) =>
                    pyCallOrSuspend(pyOnDissociate, [pyLayout, pyForm]);
            }
            if (kwargs && kwargs.length !== 0) {
                this._withLayout.kwargs = kwargs;
            }
        },
    },
    proto: {
        $requireLayout(fn) {
            return chainOrSuspend(Sk.abstr.gattr<Component>(this, s_layout, true), (pyLayout) => {
                return chainOrSuspend(pyLayout.anvil$hooks.setupDom(), () => fn(pyLayout));
            });
        },
        $setupPageState() {
            const withLayoutPageState = this._Component.pageState;
            const pyLayout = this._withLayout.pyLayout;
            if (!pyLayout) return;

            const layoutPageState = pyLayout._Component.pageState;
            layoutPageState.ancestorsVisible =
                withLayoutPageState.ancestorsVisible && withLayoutPageState.currentlyVisible;
            layoutPageState.ancestorsMounted =
                withLayoutPageState.ancestorsMounted && withLayoutPageState.currentlyMounted;
            layoutPageState.currentlyMounted = true;
            Object.defineProperty(pyLayout._Component, "portalParent", {
                get: () => {
                    return this._Component.parent;
                },
                configurable: true,
            });
            this._Component.parent?.setVisibility?.(layoutPageState.currentlyVisible);
        },
        anvil$hookSpec: {
            setupDom(this: WithLayout) {
                return (
                    this._withLayout.domElement ||
                    this.$requireLayout((layout) => {
                        // TODO could layout.anvil$hooks.domElement be undefined here?
                        return (this._withLayout.domElement = layout.anvil$hooks.domElement as HTMLElement);
                    })
                );
            },
            getDomElement() {
                return (this as unknown as WithLayout)._withLayout.domElement;
            },
            getEvents() {
                return [
                    {
                        name: "show",
                        description: "When the form is shown on the page",
                        parameters: [],
                        important: true,
                    },
                    {
                        name: "hide",
                        description: "When the form is hidden on the page",
                        parameters: [],
                        important: true,
                    },
                ];
            },
        },
    },
    flags: {
        sk$klass: true,
    },
    classmethods: {
        __init_subclass__: {
            $meth(args: Args, kws?: Kws) {
                const kwMap = kwsToObj(kws);
                type LayoutFromYaml = { type: string; defaultDepId: string };
                type Layout = ComponentConstructor | LayoutFromYaml | undefined;

                const fromYaml = (layoutClass: Layout): layoutClass is LayoutFromYaml => {
                    return !!layoutClass && typeof (layoutClass as LayoutFromYaml).type === "string";
                };

                const layoutClass = kwMap["layout"] as Layout;

                if (fromYaml(layoutClass)) {
                    // This is a YAML spec passed from form.ts
                    // Delay the actual type lookup until the first one gets instantiated; otherwise you might try to look up
                    // a form template that hasn't been created yet. Not an issue for layouts created directly in Python.
                    const { type, defaultDepId } = layoutClass;
                    const isForm = type.startsWith("form:");
                    this._withLayoutSubclass = {
                        layout: isForm
                            ? { type: "form", formSpec: resolveFormSpec(type.substring(5), defaultDepId) }
                            : { type: "builtin", name: type },
                    };
                } else if (
                    layoutClass &&
                    layoutClass instanceof pyType &&
                    isTrue(pyIsSubclass(layoutClass, Component))
                ) {
                    delete kwMap["layout"];
                    this._withLayoutSubclass = {
                        layout: { type: "constructor", constructor: layoutClass },
                    };
                } else if (!layoutClass && this.prototype.tp$base?._withLayoutSubclass) {
                    this._withLayoutSubclass = this.prototype.tp$base._withLayoutSubclass;
                } else {
                    throw new Sk.builtin.ValueError("layout= argument to WithLayout must be a subclass of Component");
                }
                const superInit = new pySuper(WithLayout, this).tp$getattr<pyCallable>(s_init_subclass);
                return pyCallOrSuspend(superInit, args, kws);
            },
            $flags: { FastCall: true },
        },
    },

    getsets: {
        layout: {
            $get() {
                const { pyLayout, kwargs, onAssociate, _withLayoutSubclass } = this._withLayout;
                if (pyLayout) {
                    return pyLayout;
                }

                // First touch! Time to create.

                if (!_withLayoutSubclass) {
                    return pyNone;
                }
                const l = _withLayoutSubclass.layout;

                const t = l.type;

                return tryCatchOrSuspend(
                    () =>
                        chainOrSuspend(
                            l.type === "form"
                                ? getNamedFormInstantiator(l.formSpec, this)
                                : l.type === "builtin"
                                ? getAnvilComponentInstantiator({ fromYaml: false, requestingComponent: this }, l.name)
                                : (kws?: Kws) => pyCallOrSuspend(l.constructor, [], kws),
                            (instantiate) => instantiate(kwargs) as Component,
                            (pyL) => {
                                this._withLayout.pyLayout = pyL;
                                return onAssociate?.(pyL, this);
                            },
                            () => this._withLayout.pyLayout!
                        ),
                    (e) => {
                        // See #5358 - Attribute Errors thrown when instantiating a layout are not likely to propagate
                        // to the user, so we wrap it in an Exception and re-throw.
                        if (e instanceof pyAttributeError) {
                            const wrapE = new pyException(
                                `Failed to instantiate layout for ${objectRepr(this)}: got ${objectRepr(e)}`
                            );
                            wrapE.traceback = e.traceback;
                            e = wrapE;
                        }
                        throw e;
                    }
                );
            },
            $set(newLayout) {
                const { onAssociate, pyLayout } = this._withLayout;
                if (pyLayout) {
                    throw new Sk.builtin.ValueError(
                        "Cannot overwrite the 'layout' property of a form after it has been initialised."
                    );
                }
                if (newLayout == null) {
                    throw new Sk.builtin.AttributeError("Cannot delete the 'layout'.");
                }
                if (!newLayout.tp$getattr(s_slots)) {
                    throw new Sk.builtin.ValueError(
                        `A form's 'layout' property must be set to a layout form, not a ${Sk.abstr.typeName(
                            newLayout
                        )} object.`
                    );
                }
                this._withLayout.pyLayout = newLayout as Component;
                return onAssociate?.(newLayout as Component, this);
            },
        },
        __dict__: Sk.generic.getSetDict, // useful in designer
    },
});
/*!defMethod(_)!2*/ ("Parent class of any form with a layout.");
["__init__"];
/*!defAttr()!1*/ ({ name: "layout", type: "anvil.Component instance", description: "This form's layout." });
/*!defClass(anvil,WithLayout,Component)!*/
initNativeSubclass(WithLayout as ComponentConstructor);
