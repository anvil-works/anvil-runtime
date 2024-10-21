/**
id: google_auth
docs_url: /docs/integrations/google/authenticating-users
title: Authenticating users
tooltip: Learn more about Google authentication
description: |

  ```python
  import anvil.google.auth

  email_addr = anvil.google.auth.login()
  print "User logged in as %s" % email_addr
  ```

  To allow your users to log into your app with Google, call `anvil.google.auth.login()`.

  \**(Remember: You don't need the user to log in if you only use app files or send email. Those belong
  to the app, not the user.)**

  If the login succeeds, `anvil.google.auth.login()` will return the user's email address.

  If the login fails, or the user cancels, `anvil.google.auth.login()` will raise an exception.

  ```python
  import anvil.google.auth

  # This can run on the server:
  email_addr = anvil.google.auth.get_user_email()
  print "%s is now logged in" % email_addr
  ```

  To find out who is currently logged in, call `anvil.google.auth.get_user_email()`. If nobody is logged
  in, this returns `None`.

  The `get_user_email` function can be called from a [server module](#server_modules), or [uplink](#uplink) code,
  to check whether a user is authorised to perform the requested action.
 */

var $builtinmodule = window.memoise('anvil.google.auth', function() {

    var mod = {};

    var loginCallbackResolve = null;
    let googleButtonLoaded = false;
    function loadGoogleSignInButton() {
        if (googleButtonLoaded) return;
        googleButtonLoaded = true;
        PyDefUtils.loadScript(window.anvilAppOrigin + "/_/static/runtime/img/google-signin-buttons/btn.js?sha=277762afd28c6a94830")
    }

    var scopes = [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
    ];

    async function displayLogInModal(additionalScopes) {

        var anvil = PyDefUtils.getModule("anvil");
        var appPath = Sk.ffi.remapToJs(anvil.tp$getattr(new Sk.builtin.str("app_path")));

        var scopesToRequest = scopes.concat(additionalScopes || []).join(' ');

        function doLogin() {

            var authParams = {
                scope: scopesToRequest,
                _anvil_session: window.anvilSessionToken,
            };

            var authUrl = appPath + "/_/client_auth_redirect?" + $.param(authParams);

            var windowFeatures = {
                width: 450,
                height: 500,
                scrollbars: "yes",
            }

            strWindowFeatures = "";
            for(var k in windowFeatures) {
                if (strWindowFeatures.length > 0)
                    strWindowFeatures += ",";

                strWindowFeatures += k;

                var v = windowFeatures[k];
                if (v === true)
                    v = 1;
                if (v === false)
                    v = 0;

                strWindowFeatures+= "=" + v;
            }

            var popup = window.open(authUrl, null, strWindowFeatures);
        };

        if (PyDefUtils.isPopupOK()) {
            doLogin();
        } else {
            loadGoogleSignInButton();
            const modal = await window.anvilModal.create({
                id: "google-login-modal",
                backdrop: "static",
                keyboard: false,
                dismissible: false,
                title: "Log in with Google",
                body: true,
                buttons: [
                    {
                        text: "Cancel",
                        onClick() {
                            modal.once("hidden", () => loginCallbackResolve.reject("MODAL_CANCEL"));
                        },
                    },
                ],
            });
            const { modalBody } = modal.elements;
            const btn = document.createElement("google-signin-button");
            btn.textContent = "Sign in with Google"; // not necessary - but if the web component were to fail - this would still render
            modalBody.appendChild(btn);
            btn.addEventListener("click", doLogin);
            modalBody.style.textAlign = "center";
            await modal.show();
            return modal;
        }
    };

    var registerCallbackHandlers = function(messageFns) {

        messageFns.clientAuthErrorCallback = function(params) {
            console.error("Client auth ERROR", params);

            if (loginCallbackResolve) {
                if (params.message == "SESSION_EXPIRED") {
                    var server = PyDefUtils.getModule("anvil.server");
                    loginCallbackResolve.reject(Sk.misceval.callsim(server.tp$getattr(new Sk.builtin.str("SessionExpiredError"))));
                } else {
                    loginCallbackResolve.reject(new Sk.builtin.Exception(Sk.ffi.remapToPy(params.message)));
                }
            }
        }

        messageFns.clientAuthSuccessCallback = function(params) {

            // This will only happen if we have successfully finished the popup flow. Any problems, they'll be displayed in the popup.
            console.debug("Client auth callback");

            // Get current user info
            var anvil = PyDefUtils.getModule("anvil");
            var appPath = Sk.ffi.remapToJs(anvil.tp$getattr(new Sk.builtin.str("app_path")));

            $.get(appPath + "/_/client_auth_id_token?_anvil_session=" + window.anvilSessionToken).done(function(idToken) {
                console.debug("Got app user ID token:", idToken);
                if (loginCallbackResolve) {
                    loginCallbackResolve.resolve(idToken);
                }
            }).fail(function(e) {
                console.error("Error getting user info.");
                if (loginCallbackResolve) {
                    loginCallbackResolve.reject("Error getting user info");
                }
            })

        }
    }

    mod["user_id"] = Sk.builtin.none.none$;
    mod["email"] = Sk.builtin.none.none$;

    async function login(pyAdditionalScopes) {

        // TODO: Try immediate auth before we do anything else. If that fails, then...

        loginCallbackResolve = PyDefUtils.defer();

        const modal = await displayLogInModal(Sk.ffi.remapToJs(pyAdditionalScopes || []));

        // TODO: Should probably have a timeout on this promise.

        try {
            const idToken = await loginCallbackResolve.promise;
            mod["user_id"] = Sk.ffi.remapToPy(idToken.user_id);
            mod["email"] = Sk.ffi.remapToPy(idToken.email);
            return mod["email"];
        } catch (e) {
            if (e === "MODAL_CANCEL") {
                return Sk.builtin.none.none$;
            } else {
                throw e;
            }
        } finally {
            modal && modal.hide();
        }
    }


    /*!defFunction(anvil.google.auth,!_,[additional_scopes])!2*/ "Prompt the user to log in with their Google account.\n\nIf you have specified your own client ID in the Google Service configuration, you can specify additional OAuth scopes for use with the Google REST API."
    mod["login"] = new Sk.builtin.func((pyAdditionalScopes) => PyDefUtils.suspensionFromPromise(login(pyAdditionalScopes)));

    registerCallbackHandlers(window.messages);

    function doServerCall(fnName, nArgs) {
        var server = PyDefUtils.getModule("anvil.server");

        if (arguments.length - 2 != nArgs) {
            throw new Sk.builtin.Exception("Function takes exactly " + (nArgs||0) + " arguments (" + (arguments.length-2) + " supplied)");
        }

        var args = [new Sk.builtin.str(fnName)].concat(Array.prototype.slice.call(arguments, 2));

        var call = server.tp$getattr(new Sk.builtin.str("call"));
        return Sk.misceval.applyOrSuspend(call, undefined, undefined, undefined, args);
    }

    /*!defFunction(anvil.google.auth,_)!2*/ "Get the email address of the currently-logged-in Google user.\n\nTo log in with Google, call anvil.google.auth.login() from form code.";
    mod["get_user_email"] = new Sk.builtin.func(doServerCall.bind(null, "anvil.private.google.auth.get_user_email", 0));

    /*!defFunction(anvil.google.auth,_)!2*/ "Get the secret access token of the currently-logged-in Google user, for use with the Google REST API. Requires this app to have its own Google client ID and secret.";
    mod["get_user_access_token"] = new Sk.builtin.func(doServerCall.bind(null, "anvil.private.google.auth.get_user_access_token", 0));

    /*!defFunction(anvil.google.auth,_)!2*/ "Get the secret refresh token of the currently-logged-in Google user, for use with the Google REST API. Requires this app to have its own Google client ID and secret.";
    mod["get_user_refresh_token"] = new Sk.builtin.func(doServerCall.bind(null, "anvil.private.google.auth.get_user_refresh_token", 0));

    /*!defFunction(anvil.google.auth,_,refresh_token)!2*/ "Get a new access token from a refresh token you have saved, for use with the Google REST API. Requires this app to have its own Google client ID and secret.";
    mod["refresh_access_token"] = new Sk.builtin.func(doServerCall.bind(null, "anvil.private.google.auth.refresh_access_token", 1));

    return mod;
});