
var $builtinmodule = window.memoise('anvil.saml.auth', function() {

    var mod = {};

    var loginCallbackResolve = null;

    async function displayLogInModal() {

        function doLogin() {

            var authParams = {
                oauth_info: window.anvilOAuthInfo,
            };

            var authUrl = window.anvilRuntimeCommonUrl + "/_/saml_auth_redirect?" + $.param(authParams);

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
            const modal = await window.anvilModal.create({
                id: "saml-login-modal",
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

            const anvilMod = PyDefUtils.getModule("anvil");
            const pluggableUi = anvilMod.tp$getattr(new Sk.builtin.str("pluggable_ui"));
            
            const button = pluggableUi.mp$subscript(new Sk.builtin.str("anvil.Button"));
            const anvilButton = Sk.misceval.callsimArray(button, [], ["text", new Sk.builtin.str("Log in via SAML"), "icon", new Sk.builtin.str("fa:lock")]); 
            const element = Sk.misceval.retryOptionalSuspensionOrThrow(anvilButton.anvil$hooks.setupDom());
            const buttonElement = element.querySelector("button");
            (buttonElement || element).addEventListener("click", doLogin);

            modalBody.appendChild(element);
            await modal.show();
            return modal;
        }
    }

    var registerCallbackHandlers = function(messageFns) {

        messageFns.samlAuthErrorCallback = function(params) {
            console.error("SAML auth error: ", params.message);

            if (loginCallbackResolve) {
                if (params.message == "SESSION_EXPIRED") {
                    var server = PyDefUtils.getModule("anvil.server");
                    loginCallbackResolve.reject(Sk.misceval.callsim(server.tp$getattr(new Sk.builtin.str("SessionExpiredError"))));
                } else {
                    loginCallbackResolve.reject(new Sk.builtin.Exception(Sk.ffi.remapToPy(params.message)));
                }
            }
        }

        messageFns.samlAuthSuccessCallback = async function(args) {
            // The origin of this message is validated in the messages.js file, so we don't need to recheck it here.

            const anvil = PyDefUtils.getModule("anvil");
            const appPath = Sk.ffi.remapToJs(anvil.tp$getattr(new Sk.builtin.str("app_path")));

            const resp = await fetch(appPath + "/_/saml_auth_complete?_anvil_session=" + window.anvilSessionToken, {
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

    async function login() {

        // TODO: Try immediate auth before we do anything else. If that fails, then...

        loginCallbackResolve = PyDefUtils.defer();

        const modal = await displayLogInModal();

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

    /*!defFunction(anvil.saml.auth,!_)!2*/ "Prompt the user to log in via SAML";
    mod["login"] = new Sk.builtin.func(() => PyDefUtils.suspensionFromPromise(login()));

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

    /*!defFunction(anvil.saml.auth,_,)!2*/ "Get the email address of the currently-logged-in SAML user.\n\nTo log in with SAML, call anvil.saml.auth.login() from form code.";
    mod["get_user_email"] = new Sk.builtin.func(doServerCall.bind(null, "anvil.private.saml.auth.get_user_email", 0));

    /*!defFunction(anvil.saml.auth,_,)!2*/ "Get the user attributes of the currently-logged-in SAML user.\n\nThe exact attributes available will depend on your SAML Identity Provider.";
    mod["get_user_attributes"] = new Sk.builtin.func(doServerCall.bind(null, "anvil.private.saml.auth.get_user_attributes", 0));

    return mod;
});
