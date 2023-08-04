import { designerApi } from ".";
import { raiseAnvilEvent, registerJsComponent, registerToolboxSection, subscribeAnvilEvent } from "./component";
import {asyncToPromise} from "PyDefUtils"
import {pyCallOrSuspend, toPy} from "@Sk";
import {anvilMod} from "@runtime/utils";
export { raiseAnvilEvent, registerJsComponent, registerToolboxSection, subscribeAnvilEvent } from "./component";

export type { JsComponent, JsContainer, JsComponentConstructor } from "./component";

export * as designerApi from "./designer";

// TODO: Additional open_form args
export const openForm = (formName: string) => asyncToPromise(() => pyCallOrSuspend(anvilMod.open_form, [toPy(formName)]))

export interface JsComponentAPI {
    raiseAnvilEvent: typeof raiseAnvilEvent;
    registerJsComponent: typeof registerJsComponent;
    registerToolboxSection: typeof registerToolboxSection;
    subscribeAnvilEvent: typeof subscribeAnvilEvent;
    designerApi: typeof designerApi;
    openForm: typeof openForm;
}
