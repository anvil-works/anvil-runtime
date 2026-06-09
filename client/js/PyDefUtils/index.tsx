import { pyCall, pyCallOrSuspend, pyFunc, pyStaticMethod, remapToJsOrWrap, toPy } from "@Sk";
import { funcFastCall, getImportedModule, kwsToObj, pyTryFinally } from "@runtime/runner/py-util";
import { defer } from "@runtime/utils";
import * as classicComponent from "./classic-component";
import * as designer from "./designer";
import * as domHelpers from "./dom-helpers";
import * as groups from "./groups";
import { mapGetter, mapSetter } from "./map-overlays";
import * as media from "./media";
import * as misc from "./misc";
import * as mouseEvents from "./mouse-events";
import * as pagination from "./pagination";
import * as pythonUtils from "./python-utils";
import * as remap from "./remap";
import * as serialization from "./serialization";
import * as styling from "./styling";
import * as stylingComponents from "./styling-components";
import * as suspension from "./suspension";

// Import jquery-compat for side effects
import "./jquery-compat";

// PyDefUtils is on window
// so becareful when changing the api surface
const PyDefUtils = {
    // python utilities
    loadModule: pythonUtils.loadModule,
    getModule: getImportedModule,
    staticmethod: (fn: pyFunc) => new pyStaticMethod(fn),
    keywordArrayToHashMap: kwsToObj,
    /** @deprecated use funcWithKwargs when creating a pyFunc, or kwsToJsObj from py-util for direct conversion. */
    withKwargs: pythonUtils.withKwargs,
    funcWithKwargs: pythonUtils.funcWithKwargs,
    withRawKwargs: pythonUtils.withRawKwargs,
    funcWithRawKwargsDict: pythonUtils.funcWithRawKwargsDict,
    /** @deprecated use funcFastCall from py-util */
    funcFastCall,
    /** @deprecated use pyCall from @Sk */
    pyCall,
    /** @deprecated use pyCallOrSuspend from @Sk */
    pyCallOrSuspend,

    // Remap
    remapToJs: remap.remapToJs,
    /** @deprecated */
    remapToJsOrWrap,
    /** @deprecated */
    unwrapOrRemapToPy: toPy,

    // Classic component
    mkComponentCls: classicComponent.mkComponentCls,
    mkNew: classicComponent.mkNew,
    mkGettersSetters: classicComponent.mkGettersSetters,
    initClassicComponentClassPrototype: classicComponent.initClassicComponentClassPrototype,

    // DOM helpers
    h: domHelpers.createElement,
    createElement: domHelpers.createElement,

    // Suspension
    suspensionFromPromise: suspension.suspensionFromPromise,
    suspensionPromise: suspension.suspensionPromise,
    suspensionHandlers: suspension.suspensionHandlers,
    callAsyncWithoutDefaultError: suspension.callAsyncWithoutDefaultError,
    callAsync: suspension.callAsync,
    asyncToPromise: suspension.asyncToPromise,
    /** @deprecated */
    raiseEventOrSuspend: suspension.raiseEventOrSuspend,
    raiseEventAsync: suspension.raiseEventAsync,
    whileOrSuspend: suspension.whileOrSuspend,
    pyTryFinally,

    // Map overlays
    mapSetter,
    mapGetter,

    // Serialization
    setAttrsFromDict: serialization.setAttrsFromDict,
    mkNewDeserializedPreservingIdentityInner: serialization.mkNewDeserializedPreservingIdentityInner,
    mkNewDeserializedPreservingIdentity: serialization.mkNewDeserializedPreservingIdentity,
    mkSerializePreservingIdentityInner: serialization.mkSerializePreservingIdentityInner,
    mkSerializePreservingIdentity: serialization.mkSerializePreservingIdentity,

    // Styling
    getOuterClass: styling.getOuterClass,
    cssLength: styling.cssLength,
    applyRole: styling.applyRole,
    getColor: styling.getColor,
    loadScript: styling.loadScript,
    getPaddingStyle: styling.getPaddingStyle,
    getOuterStyle: styling.getOuterStyle,
    getOuterAttrs: styling.getOuterAttrs,
    IconComponent: stylingComponents.IconComponent,
    OuterElement: stylingComponents.OuterElement,

    // Groups
    assembleGroupEvents: groups.assembleGroupEvents,
    assembleGroupProperties: groups.assembleGroupProperties,

    // Mouse events
    setupDefaultMouseEvents: mouseEvents.setupDefaultMouseEvents,

    // Designer
    calculateHeight: designer.calculateHeight,
    addHeightHandle: designer.addHeightHandle,

    // Misc
    isPopupOK: misc.isPopupOK,
    callJs: misc.callJs,
    withDelayPrint: misc.withDelayPrint,
    delayPrint: misc.delayPrint,
    resumePrint: misc.resumePrint,
    // useful helper - used by auth.js files so needs to be accessible via window
    defer,

    // Media
    getUrlForMedia: media.getUrlForMedia,
    getUint8ArrayFromPyBytes: media.getUint8ArrayFromPyBytes,

    // Pagination
    get logPagination() {
        return pagination.logPagination;
    },
    set logPagination(value: boolean) {
        pagination.setLogPagination(value);
    },
    repaginateChildren: pagination.repaginateChildren,

    // Designer added
    updateHeight: undefined as (() => void) | undefined,
};

export default PyDefUtils;
