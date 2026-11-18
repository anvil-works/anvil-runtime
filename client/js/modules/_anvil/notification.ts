import {
    Suspension,
    buildPyClass,
    chainOrSuspend,
    copyKeywordsToNamedArgs,
    promiseToSuspension,
    pyFunc,
    pyInt,
    pyNone,
    pyObject,
    pyRuntimeError,
    pyStr,
    toJs,
} from "@Sk";
import notify from "@runtime/modules/notify";
import { PyModMap, funcFastCall } from "@runtime/runner/py-util";
import { warn } from "@runtime/runner/warnings";

interface NotificationState {
    message: string;
    title: string;
    /** @deprecated Retained for compatibility; use role and theme CSS. */
    style: string;
    timeout: number;
    role: pyObject;
    notification?: { close?: () => void } | null;
}

interface NotificationInstance extends pyObject {
    _anvil: NotificationState;
}

/*#
        id: notifications
        docs_url: /docs/client/python/alerts-and-notifications#notifications
        title: Notifications
        description: |
          You can display temporary notifications by creating `Notification` objects.

          ![Notification screenshot](img/notification.png)

          ```python
          n = Notification("This is an important message!")
          n.show()
          ```

          To show a simple notification with some content, call the `show()` method.
          By default, it will disappear after 2 seconds.


          ```python
          with Notification("Please wait..."):
            # ... do something slow ...
          ```

          If you use a notification in a `with` block, it will be displayed as long as
          the body of the block is still running. It will then disappear.


          ```python
          n = Notification("This is an important message!",
                           timeout=None)
          n.show()

          # Later...
          n.hide()
          ```

          You can specify the timeout manually (in seconds), or set it to `None` or `0` to have the notification stay
          visible until you explicitly call its `hide()` method.

          ```
          Notification("A message",
                       title="A message title",
                       role="success").show()
          ```

          As well as a message, notifications can also have a title. Use `role="success"`
          to apply a theme role to the notification surface, or pass a list of role names.
          Style `.anvil-notification` in your theme CSS to change the default appearance of all notifications.
          Define the role's appearance in your theme CSS using `.anvil-notification.anvil-role-success`.


        */
export function createNotificationClass(pyModule: PyModMap) {
    return buildPyClass(
        pyModule,
        function ($gbl, $loc) {
            function _show(self: NotificationInstance): pyObject | Suspension {
                if (self._anvil.notification) {
                    throw new pyRuntimeError("Notification already visible");
                }

                const { message, title, style: type, timeout, role } = self._anvil;

                self._anvil.notification = notify(
                    { message, title },
                    {
                        type,
                        role,
                        timeout,
                        placement: { from: "top", align: "center" },
                        onClosed() {
                            self._anvil.notification = null;
                        },
                    }
                );

                // ensure we give the javascript event loop an opportunity to render the notification.
                return chainOrSuspend(promiseToSuspension(new Promise((resolve) => setTimeout(resolve))), () => self);
            }

            /*!defMethod(,message,[title=""], [timeout=2],[role=None])!2*/ ("Create a popup notification. Call the show() method to display it.\n\nSet timeout to None or 0 to keep it visible until dismissed.\nSet role to a theme role name or list of names.\nThe style argument is deprecated; use role and theme CSS instead.\nCan also be used as a context manager.");
            $loc["__init__"] = funcFastCall(function (args, kws) {
                const [self, message, title, style, timeout, role] = copyKeywordsToNamedArgs(
                    "Notification",
                    [null, "message", "title", "style", "timeout", "role"],
                    // Like alert(), ignore positional options after the message.
                    args.slice(0, 2),
                    kws,
                    [pyStr.$empty, new pyStr("info"), new pyInt(2), pyNone]
                ) as [NotificationInstance, pyObject, pyObject, pyObject, pyObject, pyObject];

                if (args.length > 2) {
                    warn(
                        "Notification options must be passed as keyword arguments. Positional arguments after the message are ignored.",
                        {
                            key: "notification-positional-options",
                            docUrl: "/editor/common-errors#popup-options-ignored",
                            docLinkTitle: "How to pass popup options",
                        }
                    );
                }

                const styleName = style.toString();
                self._anvil = {
                    message: (message === pyNone ? "" : message).toString(),
                    title: (title === pyNone ? "" : title).toString(),
                    style: styleName,
                    role,
                    timeout: (toJs(timeout) as number) * 1000,
                };

                return pyNone;
            });

            // TODO: Decide whether we want to suspend until the notification has finished opening/closing.

            /*!defMethod(anvil.Notification instance)!2*/ ("Shows the notification");
            $loc["show"] = new pyFunc((self: NotificationInstance) => _show(self));

            /*!defMethod(anvil.Notification instance)!2*/ ("Show the notification when entering a 'with' block");
            $loc["__enter__"] = new pyFunc(function (self: NotificationInstance) {
                self._anvil.timeout = 0;
                return _show(self);
            });

            /*!defMethod(_)!2*/ ("Hides the notification immediately");
            $loc["hide"] = new pyFunc(function (self: NotificationInstance) {
                self._anvil.notification?.close?.();
                return pyNone;
            });

            /*!defMethod(anvil.Notification instance)!2*/ ("Hide the notification when exiting a 'with' block");
            $loc["__exit__"] = $loc["hide"];

            // TODO: Support progress bars, for which we'll need the "update" method.

            /*!defClass(anvil,Notification)!*/
        },
        "Notification",
        []
    );
}
