
var $builtinmodule = window.memoise('anvil.facebook.auth', function() {

    var mod = {};

    var loginCallbackResolve = null;
    let facebookButtonLoaded = false;
    function loadFacebookSignInButton() {
        if (facebookButtonLoaded) return;
        facebookButtonLoaded = true;
        PyDefUtils.loadScript(window.anvilAppOrigin + "/_/static/runtime/img/facebook-signin-buttons/btn.js?sha=e0f560cd9d9b7bca9214")
    }

    async function displayLogInModal(additionalScopes) {

        var scopesToRequest = (additionalScopes || []).join(',');

        function doLogin() {

            var authParams = {
                scope: scopesToRequest,
                oauth_info: window.anvilOAuthInfo,
            };

            var authUrl = window.anvilRuntimeCommonUrl + "/_/facebook_auth_redirect?" + $.param(authParams);

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
            loadFacebookSignInButton();
            const modal = await window.anvilModal.create({
                id: "facebook-login-modal",
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
            const btn = document.createElement("facebook-signin-button");
            btn.textContent = "Sign in with Facebook"; // not necessary - but if the web component were to fail - this would still render
            btn.style.cursor = "pointer";
            btn.addEventListener("click", doLogin);
            modalBody.appendChild(btn);
            modalBody.style.textAlign = "center";
            await modal.show();
            return modal;
        }
    }

    var registerCallbackHandlers = function(messageFns) {

        messageFns.facebookAuthErrorCallback = function(params) {
            console.error("Facebook auth ERROR: ", params.message);
            if (loginCallbackResolve) {
                if (params.message == "SESSION_EXPIRED") {
                    var server = PyDefUtils.getModule("anvil.server");
                    loginCallbackResolve.reject(Sk.misceval.callsim(server.tp$getattr(new Sk.builtin.str("SessionExpiredError"))));
                } else {
                    loginCallbackResolve.reject(new Sk.builtin.Exception(Sk.ffi.remapToPy(params.message)));
                }
            }
        }

        messageFns.facebookAuthSuccessCallback = async function(args) {
            // The origin of this message is validated in the messages.js file, so we don't need to recheck it here.

            const anvil = PyDefUtils.getModule("anvil");
            const appPath = Sk.ffi.remapToJs(anvil.tp$getattr(new Sk.builtin.str("app_path")));

            const resp = await fetch(appPath + "/_/facebook_auth_complete?_anvil_session=" + window.anvilSessionToken, {
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
    }

    /*!defFunction(anvil.facebook.auth,!_)!2*/ "Prompt the user to log in with their Facebook account";
    mod["login"] = new Sk.builtin.func((pyAdditionalScopes) =>
        PyDefUtils.suspensionFromPromise(login(pyAdditionalScopes))
    );

    registerCallbackHandlers(window.messages);

    /*!defFunction(anvil.facebook.auth,_,)!2*/ "Get the email address of the currently-logged-in Facebook user.\n\nTo log in with Facebook, call facebook.auth.login() from form code.";
    mod["get_user_email"] = new Sk.builtin.func(function() {
        var server = PyDefUtils.getModule("anvil.server");

        var call = server.tp$getattr(new Sk.builtin.str("call"));
        return Sk.misceval.callOrSuspend(call, undefined, undefined, undefined, Sk.ffi.remapToPy("anvil.private.facebook.auth.get_user_email"));
    })

    /*!defFunction(anvil.facebook.auth,_,)!2*/ "Get the Facebook user ID of the currently-logged-in Facebook user.\n\nTo log in with Facebook, call facebook.auth.login() from form code.";
    mod["get_user_id"] = new Sk.builtin.func(function() {
        var server = PyDefUtils.getModule("anvil.server");

        var call = server.tp$getattr(new Sk.builtin.str(new Sk.builtin.str("call")));
        return Sk.misceval.callOrSuspend(call, undefined, undefined, undefined, Sk.ffi.remapToPy("anvil.private.facebook.auth.get_user_id"));
    });

    /*!defFunction(anvil.facebook.auth,_,)!2*/
    ({
        anvil$helpLink: "/docs/integrations/facebook",
        //anvil.$args: {argName: "describe this argument"}
        $doc: "Get the Facebook access token of the currently-logged-in Facebook user.\n\nTo log in with Facebook, call facebook.auth.login() from form code."
    })
    mod["get_user_access_token"] = new Sk.builtin.func(function() {
        var server = PyDefUtils.getModule("anvil.server");

        var call = server.tp$getattr(new Sk.builtin.str("call"));
        return Sk.misceval.callOrSuspend(call, undefined, undefined, undefined, Sk.ffi.remapToPy("anvil.private.facebook.auth.get_user_access_token"));
    })

    return mod;
});
