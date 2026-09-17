import { setupDefaultAnvilPluggableUI } from "@runtime/modules/_anvil/pluggable-ui";
import { pyPropertyUtilsApi } from "@runtime/runner/component-property-utils-api";
import { Suspension } from "@Sk";
import PyDefUtils from "PyDefUtils";
import * as componentModule from "../components";
import anvil from "../modules/anvil";
import base64Module from "../modules/base64";
import codeCompletionHintsModule from "../modules/code-completion-hints";
import historyModule from "../modules/history";
import httpModule from "../modules/http";
import imageModule from "../modules/image";
import jsModule from "../modules/js";
import mediaModule from "../modules/media";
import reModule from "../modules/regex";
import scriptModule from "../modules/script";
import server from "../modules/server";
import shapesModule from "../modules/shapes";
import tzModule from "../modules/tz";
import xmlModule from "../modules/xml";
import { pyDesignerApi } from "./component-designer-api";
import { data } from "./data";
import { uncaughtExceptions } from "./error-handling";
import { provideLoggingImpl } from "./logging";
import { PyModMap } from "./py-util";
import { Slot, WithLayout } from "./python-objects";

export let registerServerCallSuspension: null | ((s: Suspension<{ serverRequestId: string }>) => void) = null;

function loadOrdinaryModulesReturningAnvilModule() {
    const anvilModule: PyModMap = anvil(data.appOrigin, uncaughtExceptions);

    componentModule.defineSystemComponents(anvilModule);

    PyDefUtils.loadModule("anvil", anvilModule);

    // Preload all modules we will ever load under the "anvil" package now, because we might need to duplicate
    // them later for v1 runtime apps

    PyDefUtils.loadModule("base64", base64Module());

    PyDefUtils.loadModule("anvil.xml", xmlModule());

    PyDefUtils.loadModule("anvil.regex", reModule());

    PyDefUtils.loadModule("anvil.tz", tzModule());

    PyDefUtils.loadModule("anvil.shapes", shapesModule());

    const serverModuleAndLog = server(data.appId, data.appOrigin);
    provideLoggingImpl(serverModuleAndLog.log);
    registerServerCallSuspension = serverModuleAndLog.registerServerCallSuspension;
    PyDefUtils.loadModule("anvil.server", serverModuleAndLog.pyMod);

    PyDefUtils.loadModule("anvil.script", scriptModule());

    PyDefUtils.loadModule("anvil.http", httpModule());

    PyDefUtils.loadModule("anvil.js", jsModule());

    // server needs to have loaded first
    PyDefUtils.loadModule("anvil.history", historyModule());

    PyDefUtils.loadModule("anvil.image", imageModule());

    PyDefUtils.loadModule("anvil.media", mediaModule());

    PyDefUtils.loadModule("anvil.code_completion_hints", codeCompletionHintsModule());

    PyDefUtils.loadModule("anvil.designer", pyDesignerApi);

    PyDefUtils.loadModule("anvil.property_utils", pyPropertyUtilsApi);

    anvilModule["Slot"] = Slot;
    anvilModule["WithLayout"] = WithLayout;

    setupDefaultAnvilPluggableUI(anvilModule);

    return anvilModule;
}

export default loadOrdinaryModulesReturningAnvilModule;
