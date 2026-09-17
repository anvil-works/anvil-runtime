import {
    Args,
    Kws,
    Suspension,
    chainOrSuspend,
    checkArgsLen,
    checkNone,
    isTrue,
    pyCall,
    pyCallOrSuspend,
    pyCallable,
    pyFalse,
    pyNone,
    pyObject,
    pyRuntimeError,
    pyStr,
    pyTrue,
    toJs,
    toPy,
} from "@Sk";
import { applyRole } from "@runtime/PyDefUtils/styling";
import { asyncToPromise, suspensionFromPromise } from "@runtime/PyDefUtils/suspension";
import { Component, notifyComponentMounted, notifyComponentUnmounted } from "@runtime/components/Component";
import { validateChild } from "@runtime/components/Container";
import Modal from "@runtime/modules/modal";
import { topLevelForms } from "@runtime/runner/data";
import { funcFastCall, kwsToObj, objToKws } from "@runtime/runner/py-util";
import type { PyModMap } from "@runtime/runner/py-util";
import { defer } from "@runtime/utils";
import type { PluggableUIObject } from "./pluggable-ui";

type ModalChainFn = () => pyObject | Suspension | void;
type PyKwargsObject = Record<string, pyObject>;
type ModalModule = PyModMap & { pluggable_ui: PluggableUIObject };

export function createModalFunctions(pyModule: ModalModule) {
    let activeModalLength = 0;

    async function modal(kwargs: PyKwargsObject): Promise<pyObject> {
        let pyForm: Component | undefined;
        let returnValue: pyObject = pyNone;
        const content = kwargs.content;
        const role = kwargs.role;
        let body = null;
        const large = isTrue(kwargs.large);
        const dismissible = isTrue(kwargs.dismissible);
        const title = toJs(kwargs.title) == null ? null : String(kwargs.title);
        let buttons = kwargs.buttons?.valueOf(); // expects an array
        if (!Array.isArray(buttons)) {
            buttons = [];
        }

        if (content instanceof Component) {
            pyForm = content;
            body = true;
            validateChild(content, "alert");
        } else if (content) {
            body = checkNone(content) ? null : content.toString();
        }

        const modalButtons = buttons.map((pyBtnArg: pyObject | undefined) => {
            const jsBtnArg = pyBtnArg?.valueOf();
            let text = "";
            let val: pyObject = pyNone;
            let style = "";

            if (typeof jsBtnArg === "string") {
                text = jsBtnArg;
                val = pyBtnArg ?? pyNone;
            } else if (Array.isArray(jsBtnArg)) {
                // Expect b to be a tuple (txt, val, style)
                const [rawText = "", rawVal = pyNone, rawStyle = ""] = jsBtnArg;
                text = String(rawText);
                val = rawVal as pyObject;
                style = String(rawStyle);
            } else {
                // just ignore and use the default values for text and val;
            }

            const onClick = () => {
                returnValue = val;
            };

            return { text, style, onClick };
        });

        const a = await Modal.create({
            id: activeModalLength++,
            large,
            title,
            dismissible,
            body,
            buttons: modalButtons,
            backdrop: dismissible || "static",
            keyboard: dismissible,
        });

        if (role) {
            applyRole(role, a.elements.modalDialog);
        }

        const { promise: promiseReturnValue, resolve: resolveReturnValue } = defer<pyObject>();

        const hideFns: ModalChainFn[] = [];
        const showFns: ModalChainFn[] = [];

        if (pyForm) {
            const formElement = await asyncToPromise(() => pyForm.anvil$hooks.setupDom());
            a.elements.modalBody.append(formElement);
            // use set_event_handler - we want to reset this event if the same form
            // is added to a modal multiple times
            const setEventHandler = pyForm.tp$getattr<pyCallable>(new pyStr("set_event_handler"));
            pyCall(setEventHandler, [
                new pyStr("x-close-alert"),
                funcFastCall((_args, kws) => {
                    const eventKwargs = kwsToObj(kws);
                    returnValue = eventKwargs.value ?? pyNone;
                    a.hide();
                    return pyNone;
                }),
            ]);

            hideFns.push(() => notifyComponentUnmounted(pyForm, true));
            showFns.push(() => notifyComponentMounted(pyForm, true));
        }

        let hideFired = false;
        a.once("hide", () => {
            hideFired = true;
        });

        a.once("hidden", () => {
            activeModalLength--;
            if (pyForm) {
                const domElement = pyForm.anvil$hooks.domElement;
                if (domElement !== undefined && domElement !== null) {
                    $(domElement).detach();
                }
                topLevelForms.alertForms.delete(pyForm);
            }
            asyncToPromise(() => chainOrSuspend(null, ...hideFns)).then(() => resolveReturnValue(returnValue));
        });

        a.once("show", async () => {
            if (hideFired) {
                return;
            }
            if (pyForm) {
                // do this synchronously
                // it's possible for hide to be called before shown
                topLevelForms.alertForms.add(pyForm);
            }
            await asyncToPromise(() => chainOrSuspend(null, ...showFns));
        });

        await a.show();
        return promiseReturnValue;
    }

    /*#
        id: alerts
        docs_url: /docs/client/python/alerts-and-notifications
        title: Alerts
        description: |
          You can display popup messages using the `alert` and `confirm`
          functions. They are in the `anvil` module, so will be imported by default.

          #### Messages

          ```
          alert("Welcome to Anvil")
          ```

          The simplest way to display a popup message is to call the `alert` function.
          You must supply at least one argument: The message to be displayed. The `alert`
          function will return `True` if the user clicks OK, or `None` if they dismiss
          the popup by clicking elsewhere. The example on the right produces the following popup:

          ![Alert popup](img/alert.png)

          #### Confirmations

          ```
          c = confirm("Do you wish to continue?")
          # c will be True if the user clicked 'Yes'
          ```

          If you want to ask your user a yes/no question, just call the `confirm` function
          in the same way. The `confirm` function returns `True` if the user clicks Yes,
          `False` if the user clicks No, and `None` if they dismiss the popup by clicking elsewhere (See `dismissible` keyword argument, below).

          ![Alert popup](img/confirm.png)

          #### Custom popup styles

          ```
          # Display a large popup with a title and three buttons.
          result = alert(content="Choose Yes or No",
                         title="An important choice",
                         large=True,
                         buttons=[
                           ("Yes", "YES"),
                           ("No", "NO"),
                           ("Neither", None)
                         ])

          print "The user chose %s" % result
          ```

          You can customise alerts by passing extra named arguments to the `alert` (or `confirm`) function:

          \* `content` - The message to display. This can be a string or a component (see below)
          \* `title` - The title of the popup box
          \* `large` - Whether to display a wide popup (default: `False`)
          \* `buttons` - A list of buttons to display. Each item in the list
            should be a tuple <code>(<i>text</i>,<i>value</i>)</code>,
            where <code><i>text</i></code> is the text to display on the button,
            <code><i>value</i></code> is the value to return if the user clicks the button,
          \* `dismissible` - Whether this modal can be dismissed by clicking on the backdrop of the page. An alert dismissed in this way will return `None`. If there is a title, the title bar will contain an 'X' that dismisses the modal. (default: `True`)

          ![Alert popup](img/modal.png)

          #### Custom popup content

          ```python
          t = TextBox(placeholder="Email address")
          alert(content=t,
                title="Enter an email address")
          print "You entered: %s" % t.text
          ```

          You can display custom components in alerts by setting the content argument to an instance of a component instead of a string.

          For complex layouts or interaction, you can set the content to an instance of one of your own forms. To close
          the alert from code inside your form, raise the `x-close-alert` event with a `value` argument:

          `self.raise_event("x-close-alert", value=42)`

          The alert will close and return the value `42`.
        */

    const defaultAlertButtons = toPy([["OK", true, "success"]]);
    const defaultConfirmButtons = toPy([
        ["Cancel", false, "danger"],
        ["OK", true, "success"],
    ]);

    const s_modal = new pyStr("anvil.modal");

    function cleanModalArgs(args: Args, kws?: Kws): PyKwargsObject {
        const kwargs = kwsToObj(kws);
        kwargs.content ??= args[0] ?? pyNone;
        return kwargs;
    }

    function callPluggableUiModal(kwargs: PyKwargsObject) {
        const pluggable_ui = pyModule["pluggable_ui"];
        const modal = pluggable_ui.mp$subscript(s_modal);
        return pyCallOrSuspend(modal, [], objToKws(kwargs));
    }

    /* This is the pluggable ui implementation */
    const modalCallable = funcFastCall(function (args, kws) {
        if (ANVIL_IN_DESIGNER) {
            throw new pyRuntimeError("alerts are not available in the Designer");
        }
        checkArgsLen("modal", args, 0, 1);
        const kwargs = cleanModalArgs(args, kws);
        return suspensionFromPromise(modal(kwargs));
    });

    const alert = funcFastCall((args, kws) => {
        const kwargs = cleanModalArgs(args, kws);
        kwargs.dismissible ??= pyTrue;
        kwargs.buttons ??= defaultAlertButtons;
        return callPluggableUiModal(kwargs);
    });

    const confirm = funcFastCall((args, kws) => {
        const kwargs = cleanModalArgs(args, kws);
        kwargs.dismissible ??= pyFalse;
        kwargs.buttons ??= defaultConfirmButtons;
        return callPluggableUiModal(kwargs);
    });

    return { modal: modalCallable, alert, confirm };
}
