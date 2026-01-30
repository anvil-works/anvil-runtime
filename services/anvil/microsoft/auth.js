
var $builtinmodule = window.memoise('anvil.microsoft.auth', function() {

    var mod = {};

    var loginCallbackResolve = null;
    let microsoftButtonLoaded = false;
    function loadMicrosoftSignInButton() {
        if (microsoftButtonLoaded) return;
        microsoftButtonLoaded = true;
        PyDefUtils.loadScript(window.anvilAppOrigin + "/_/static/runtime/img/microsoft-signin-buttons/btn.js?sha=571f3e80eba45f5901fc")
    }

     async function displayLogInModal(additionalScopes) {

        var scopesToRequest = (additionalScopes || []).join(' ');

        function doLogin() {

            var authParams = {
                scope: scopesToRequest,
                oauth_info: window.anvilOAuthInfo,
            };

            var authUrl = window.anvilRuntimeCommonUrl + "/_/microsoft_auth_redirect?" + $.param(authParams);

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

            window.open(authUrl, null, strWindowFeatures);
        };

        if (PyDefUtils.isPopupOK()) {
            doLogin();
        } else {
            loadMicrosoftSignInButton();
            const modal = await window.anvilModal.create({
                id: "microsoft-login-modal",
                backdrop: "static",
                large: false,
                keyboard: false,
                dismissible: false,
                title: "Log in",
                body: true,
                buttons: [
                    {
                        text: "Cancel",
                        onClick: () => {
                            modal.once("hidden", () => loginCallbackResolve.reject("MODAL_CANCEL"));
                        },
                    },
                ],
            });
            const { modalBody } = modal.elements;
            const btn = document.createElement("microsoft-signin-button");
            btn.textContent = "Sign in with Microsoft"; // not necessary - but if the web component were to fail - this would still render
            btn.style.cursor = "pointer";
            btn.addEventListener("click", doLogin);
            modalBody.appendChild(btn);
            modalBody.style.textAlign = "center";
            await modal.show();
            return modal;
        }
    }

    var registerCallbackHandlers = function(messageFns) {

        messageFns.microsoftAuthErrorCallback = function(params) {
            console.error("Microsoft auth ERROR: ", params.message);
            if (loginCallbackResolve) {
                if (params.message == "SESSION_EXPIRED") {
                    var server = PyDefUtils.getModule("anvil.server");
                    loginCallbackResolve.reject(Sk.misceval.callsim(server.tp$getattr(new Sk.builtin.str("SessionExpiredError"))));
                } else {
                    loginCallbackResolve.reject(new Sk.builtin.Exception(Sk.ffi.remapToPy(params.message)));
                }
            }
        }

        messageFns.microsoftAuthSuccessCallback = async function(args) {
            // The origin of this message is validated in the messages.js file, so we don't need to recheck it here.

            const anvil = PyDefUtils.getModule("anvil");
            const appPath = Sk.ffi.remapToJs(anvil.tp$getattr(new Sk.builtin.str("app_path")));

            const resp = await fetch(appPath + "/_/microsoft_auth_complete?_anvil_session=" + window.anvilSessionToken, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(args),
            });

            const data = await resp.json().catch(() => null);
            if (!resp.ok) {
                const error = data?.error || resp.statusText;
                console.error("Error getting user info: " + error);
                if (loginCallbackResolve) {
                    loginCallbackResolve.reject("Error getting user info: " + error);
                }
                return;
            }

            const email = data.email;
            if (loginCallbackResolve) {
                loginCallbackResolve.resolve(email);
            }
        }
    }

    async function login(pyAdditionalScopes) {

        // TODO: Try immediate auth before we do anything else. If that fails, then...

        loginCallbackResolve = PyDefUtils.defer();

        const modal = await displayLogInModal(Sk.ffi.remapToJs(pyAdditionalScopes || []));

        // TODO: Should probably have a timeout on this promise.
        try {
            const email = await loginCallbackResolve.promise;
            return Sk.ffi.toPy(email);
        } catch (e) {
            if (e === "MODAL_CANCEL") {
                return Sk.builtin.none.none$;
            } else {
                throw e;
            }
        } finally {
            modal && modal.hide();
        }
    };

    /*!defFunction(anvil.microsoft.auth,!_)!2*/ "Prompt the user to log in with their Microsoft account";
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

    /*!defFunction(anvil.microsoft.auth,_,)!2*/ "Get the email address of the currently-logged-in Microsoft user.\n\nTo log in with Microsoft, call anvil_microsoft.auth.login() from form code.";
    mod["get_user_email"] =new Sk.builtin.func(doServerCall.bind(null, "anvil.private.microsoft.auth.get_user_email", 0));

    /*!defFunction(anvil.microsoft.auth,_)!2*/ "Get the secret access token of the currently-logged-in Microsoft user, for use with the Microsoft REST API. Requires this app to have its own Microsoft client ID and secret.";
    mod["get_user_access_token"] = new Sk.builtin.func(doServerCall.bind(null, "anvil.private.microsoft.auth.get_user_access_token", 0));

    /*!defFunction(anvil.microsoft.auth,_)!2*/ "Get the secret refresh token of the currently-logged-in Microsoft user, for use with the Microsoft REST API. Requires this app to have its own Microsoft client ID and secret.";
    mod["get_user_refresh_token"] = new Sk.builtin.func(doServerCall.bind(null, "anvil.private.microsoft.auth.get_user_refresh_token", 0));

    /*!defFunction(anvil.microsoft.auth,_,refresh_token)!2*/ "Get a new access token from a refresh token you have saved, for use with the Microsoft REST API. Requires this app to have its own Microsoft client ID and secret.";
    mod["refresh_access_token"] = new Sk.builtin.func(doServerCall.bind(null, "anvil.private.microsoft.auth.refresh_access_token", 1));

    return mod;
});
