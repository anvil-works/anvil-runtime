
var $builtinmodule = window.memoise('anvil.saml.auth', function() {

    var mod = {};

    var loginCallbackResolve = null;

    var displayLogInModal = function() {

        var anvil = PyDefUtils.getModule("anvil");
        var appPath = Sk.ffi.remapToJs(anvil.tp$getattr(new Sk.builtin.str("app_path")));

        var doLogin = function() {

            var authParams = {
                s: window.anvilSessionToken,
            };

            var authUrl = appPath + "/_/saml_auth_redirect?" + $.param(authParams);

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
            $("#samlLogInButton").off("click"); // Just in case they didn't click it last time.
            $("#samlLogInButton").one("click", doLogin);
            $("#samlCancelButton").off("click");
            $("#samlCancelButton").one("click", function() {
                $("#saml-login-modal").one("hidden.bs.modal.alertclear", function() {
                    loginCallbackResolve.reject("MODAL_CANCEL")
                });
            });

            $('#saml-login-modal').modal({backdrop: 'static', keyboard: false});
        }
    }

    var registerCallbackHandlers = function(messageFns) {

        messageFns.samlAuthErrorCallback = function(params) {
            console.error("SAML auth error", params);

            if (loginCallbackResolve) {
                if (params.message == "SESSION_EXPIRED") {
                    var server = PyDefUtils.getModule("anvil.server");
                    loginCallbackResolve.reject(Sk.misceval.callsim(server.tp$getattr(new Sk.builtin.str("SessionExpiredError"))));
                } else {
                    loginCallbackResolve.reject(new Sk.builtin.Exception(Sk.ffi.remapToPy(params.message)));
                }
            }
        }

        messageFns.samlAuthSuccessCallback = function(params) {

            PyDefUtils.callAsync(mod["get_user_email"]).then(function(c) {
                loginCallbackResolve.resolve(Sk.ffi.remapToJs(c));
            }).catch(function(e) {
                loginCallbackResolve.reject(e);
            });

        }
    }

    /*!defFunction(anvil.saml.auth,!_)!2*/ "Prompt the user to log in via SAML"
    mod["login"] = new Sk.builtin.func(function() {

        // TODO: Try immediate auth before we do anything else. If that fails, then...

        loginCallbackResolve = RSVP.defer();

        displayLogInModal();

        // TODO: Should probably have a timeout on this promise.

        return PyDefUtils.suspensionPromise(function(resolve, reject) {
            loginCallbackResolve.promise.then(function(email) {
                resolve(email);
            }).catch(function(e) {
                if (e == "MODAL_CANCEL") {
                    resolve(Sk.builtin.none.none$);
                } else {
                    reject(e);
                }
            });
        });
    });

    registerCallbackHandlers(window.messages);

    function doServerCall(fnName, nArgs) {
        var server = PyDefUtils.getModule("anvil.server");

        if (arguments.length - 2 != nArgs) {
            throw new Sk.builtin.Exception("Function takes exactly " + (nArgs||0) + " arguments (" + (arguments.length-2) + " supplied)");
        }

        var args = [new Sk.builtin.str(fnName)].concat(Array.prototype.slice.call(arguments, 2));

        var call = server.tp$getattr(new Sk.builtin.str("call_$rn$"));
        return Sk.misceval.applyOrSuspend(call, undefined, undefined, undefined, args);
    }

    /*!defFunction(anvil.saml.auth,_,)!2*/ "Get the email address of the currently-logged-in SAML user.\n\nTo log in with SAML, call anvil.saml.auth.login() from form code.";
    mod["get_user_email"] = new Sk.builtin.func(doServerCall.bind(null, "anvil.private.saml.auth.get_user_email", 0));

    /*!defFunction(anvil.saml.auth,_,)!2*/ "Get the user attributes of the currently-logged-in SAML user.\n\nThe exact attributes available will depend on your SAML Identity Provider.";
    mod["get_user_attributes"] = new Sk.builtin.func(doServerCall.bind(null, "anvil.private.saml.auth.get_user_attributes", 0));

    return mod;
});
