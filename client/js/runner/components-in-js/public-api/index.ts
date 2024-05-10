import { pyCallOrSuspend, toPy } from "@Sk";
import { anvilMod } from "@runtime/runner/py-util";
import { asyncToPromise } from "PyDefUtils";
import { designerApi, propertyUtils } from ".";
import {
    getParent,
    notifyMounted,
    notifyUnmounted,
    notifyVisibilityChange,
    raiseAnvilEvent,
    registerJsComponent,
    registerToolboxSection,
    subscribeAnvilEvent,
    triggerWriteBack,
} from "./component";

export {
    notifyMounted,
    notifyUnmounted,
    notifyVisibilityChange,
    raiseAnvilEvent,
    registerJsComponent,
    registerToolboxSection,
    subscribeAnvilEvent,
    triggerWriteBack,
    getParent,
} from "./component";

export type { JsComponent, JsComponentConstructor, JsContainer } from "./component";

export * as designerApi from "./designer";

export { getClientConfig } from "@runtime/runner/data";
export * as propertyUtils from "./property-utils";

// TODO: Additional open_form args
export const openForm = (formName: string) =>
    asyncToPromise(() => pyCallOrSuspend(anvilMod.open_form, [toPy(formName)]));

import { getClientConfig } from "@runtime/runner/data";

export interface JsComponentAPI {
    notifyMounted: typeof notifyMounted;
    notifyUnmounted: typeof notifyUnmounted;
    notifyVisibilityChange: typeof notifyVisibilityChange;
    raiseAnvilEvent: typeof raiseAnvilEvent;
    registerJsComponent: typeof registerJsComponent;
    registerToolboxSection: typeof registerToolboxSection;
    subscribeAnvilEvent: typeof subscribeAnvilEvent;
    triggerWriteBack: typeof triggerWriteBack;
    designerApi: typeof designerApi;
    openForm: typeof openForm;
    propertyUtils: typeof propertyUtils;
    getClientConfig: typeof getClientConfig;
    getParent: typeof getParent;
}
