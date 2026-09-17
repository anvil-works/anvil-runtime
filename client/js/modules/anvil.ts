"use strict";

import { pyFunc, pyNone, pyStr, pyTuple, toPy } from "@Sk";
import type { PyModMap } from "@runtime/runner/py-util";
import type { ComponentConstructor } from "../components/Component";
import { createAppInfo } from "./_anvil/app-info";
import { createCoreFunctions } from "./_anvil/core";
import type { UncaughtExceptions } from "./_anvil/core";
import { createEventHandlerClasses } from "./_anvil/event-handlers";
import { createLiveObjectTools } from "./_anvil/live-object";
import { createMediaClasses } from "./_anvil/media";
import { createModalFunctions } from "./_anvil/modals";
import { createNotificationClass } from "./_anvil/notification";
import { createOpenFormFunctions } from "./_anvil/open-form";
import type { PluggableUIObject } from "./_anvil/pluggable-ui";
import { createServiceHelperFunctions } from "./_anvil/service-helpers";

type AnvilModule = PyModMap & {
    Component?: ComponentConstructor;
    pluggable_ui?: PluggableUIObject;
};

function registerPluggableUI(
    pyModule: AnvilModule,
    pluggableUI: PluggableUIObject
): asserts pyModule is AnvilModule & { pluggable_ui: PluggableUIObject } {
    pyModule["pluggable_ui"] = pluggableUI;
}

function anvil(appOrigin: string, uncaughtExceptions: UncaughtExceptions): PyModMap {
    const pyModule: AnvilModule = {
        __name__: new pyStr("anvil"),
        __path__: new pyTuple([new pyStr("anvil-services/anvil"), new pyStr("src/lib/anvil")]),
        app_path: toPy(appOrigin),
        _now: new pyFunc(function () {
            return toPy(Date.now());
        }),
    };

    const _warnings = {};

    /*#
    id: anvil_module
    docs_url: /docs/client/python#the-anvil-module
    title: Anvil Module
    description: |
      The `anvil` module is imported by default in Forms, and must be referred to explicitly in server modules.

      All the components described in these documents are classes in the `anvil` module. In addition, this module contains some utility functions:

      ```python
      from anvil import *

      print("Our URL hash is: " + repr(get_url_hash()))
      ```

      `get_url_hash()` gets the decoded hash (the part after the '#' character) of the URL used to open this app.

      If the first character of the hash is a question mark (eg `https://myapp.anvil.app/#?a=foo&b=bar`), it will be interpreted as query-string-type parameters and returned as a dictionary (eg `{'a': 'foo', 'b': 'bar'}`).

      `get_url_hash()` is available in Form code only.


      ```python
      from anvil import *

      if app.branch == 'published':
        print("We are on the published branch")

      print("This app's ID is " + app.id)
      ```

      `anvil.app` (or `app` if you've imported `*` from the `anvil` module) is an object containing information about your app:

      \* `anvil.app.branch` is a string that tells you which version of your app is running. If you run the app in the Anvil editor, `anvil.app.branch` will be `"master"`; if you have [published a version of your app](#publishing_an_app) and you're running that, it will be `"published"`.

      \* `anvil.app.id` is a string that contains the unique ID of this app.

    */

    const core = createCoreFunctions(uncaughtExceptions);
    /*!defFunction(anvil,!)!2*/ ("Get the decoded hash (the part after the '#' character) of the URL used to open this app. If the first character of the hash is a question mark (eg '#?a=foo&b=bar'), it will be interpreted as query-string-type parameters and returned as a dictionary (eg {'a': 'foo', 'b': 'bar'}).");
    pyModule["get_url_hash"] = core.getUrlHash;
    /*!defFunction(anvil,!,val)!2*/ ("Sets the hash of the currently open URL. If val is a string, it is added to the URL after a #. If val is a dictionary, it will be interpreted as query-string-type parameters and added to the URL after a hash and question mark (eg '#?a=foo&b=bar').");
    pyModule["set_url_hash"] = core.setUrlHash;
    /*!defFunction(anvil,!,handler_fn)!2*/ ("Set a function to be called when an uncaught exception occurs. If set to None, a pop-up will appear letting the user know that an error has occurred.");
    pyModule["set_default_error_handling"] = core.setDefaultErrorHandling;
    pyModule["_generate_internal_error"] = core.generateInternalError;

    const appInfo = createAppInfo(pyModule);
    pyModule["app"] = appInfo.app;
    registerPluggableUI(pyModule, appInfo.pluggableUI);

    const openForm = createOpenFormFunctions();
    /*!defFunction(anvil,!,form,*args,**kwargs)!2*/ ("Open the specified form as a new page.\n\nIf 'form' is a string, a new form will be created (extra arguments will be passed to its constructor).\nIf 'form' is a Form object, it will be opened directly.");
    pyModule["open_form"] = openForm.openForm;
    /*!defFunction(anvil,!)!2*/ ("Returns the form most recently opened with open_form().");
    pyModule["get_open_form"] = openForm.getOpenForm;
    /*!defFunction(anvil,boolean)!2*/ ("Check whether Anvil is running server side or not.");
    pyModule["is_server_side"] = openForm.isServerSide;

    const media = createMediaClasses(pyModule);
    pyModule["Media"] = media.Media;
    pyModule["URLMedia"] = media.URLMedia;
    pyModule["DataMedia"] = media.DataMedia;
    pyModule["BlobMedia"] = media.BlobMedia;
    pyModule["FileMedia"] = media.FileMedia;
    pyModule["LazyMedia"] = media.LazyMedia;
    pyModule["create_lazy_media"] = media.createLazyMedia;

    const liveObjects = createLiveObjectTools(pyModule, _warnings);
    pyModule["LiveObjectProxy"] = liveObjects.LiveObjectProxy;
    pyModule["_get_live_object_id"] = liveObjects.getLiveObjectId;
    pyModule["_clear_live_object_caches"] = liveObjects.clearLiveObjectCaches;

    const serviceHelpers = createServiceHelperFunctions();
    pyModule["_get_service_client_config"] = serviceHelpers.getServiceClientConfig;
    pyModule["_get_anvil_cdn_origin"] = serviceHelpers.getAnvilCdnOrigin;
    /*!defFunction(anvil,!anvil.Component instance)!2*/ ("Get the currently focused Anvil component, or None if focus is not in a component.");
    pyModule["get_focused_component"] = serviceHelpers.getFocusedComponent;

    const modals = createModalFunctions(pyModule);
    pyModule["modal"] = modals.modal;
    /*!defFunction(anvil,_,content,[title=""],[buttons=],[large=False],[dismissible=True],[role=])!2*/ ('Pop up an alert box. By default, it will have a single "OK" button which will return True when clicked.');
    pyModule["alert"] = modals.alert;
    /*!defFunction(anvil,_,content,[title=""],[buttons=],[large=False],[dismissible=False], [role=])!2*/ ('Pop up a confirmation box. By default, it will have "Yes" and "No" buttons which will return True and False respectively when clicked.');
    pyModule["confirm"] = modals.confirm;

    pyModule["Notification"] = createNotificationClass(pyModule);

    const eventHandlers = createEventHandlerClasses(pyModule);
    pyModule["EventHandlerDescriptor"] = eventHandlers.EventHandlerDescriptor;
    /*!defFunction(anvil,_,component_name,event_name)!2*/ ("When applied to a form method as a decorator, sets the decorated method as an event handler for the specified component event.");
    pyModule["handle"] = eventHandlers.handle;

    return pyModule as PyModMap;
}

export default anvil;
