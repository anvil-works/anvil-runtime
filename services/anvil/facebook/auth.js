
var $builtinmodule = window.memoise('anvil.facebook.auth', function() {

    var mod = {};

    var loginCallbackResolve = null;

    var displayLogInModal = function(additionalScopes) {

        var anvil = PyDefUtils.getModule("anvil");
        var appPath = Sk.ffi.remapToJs(anvil.tp$getattr(new Sk.builtin.str("app_path")));

        var scopesToRequest = (additionalScopes || []).join(',');

        var doLogin = function() {

            var authParams = {
                scopes: scopesToRequest,
                s: window.anvilSessionToken,
            };

            var authUrl = appPath + "/_/facebook_auth_redirect?" + $.param(authParams);

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
            $("#facebookLogInButton").off("click"); // Just in case they didn't click it last time.
            $("#facebookLogInButton").one("click", doLogin);
            $("#facebookCancelButton").off("click");
            $("#facebookCancelButton").one("click", function() {
                $("#facebook-login-modal").one("hidden.bs.modal.alertclear", function() {
                    loginCallbackResolve.reject("MODAL_CANCEL")
                });
            });

            $('#facebook-login-modal').modal({backdrop: 'static', keyboard: false});
        }
    }

    var registerCallbackHandlers = function(messageFns) {

        messageFns.facebookAuthErrorCallback = function(params) {
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

        messageFns.facebookAuthSuccessCallback = function(params) {

            PyDefUtils.callAsync(mod["get_user_email"]).then(function(c) {
                loginCallbackResolve.resolve(Sk.ffi.remapToJs(c));
            }).catch(function(e) {
                loginCallbackResolve.reject(e);
            });

        }
    }

    /*!defFunction(anvil.facebook.auth,!_)!2*/ "Prompt the user to log in with their Facebook account"
    mod["login"] = new Sk.builtin.func(function(pyAdditionalScopes) {

        // TODO: Try immediate auth before we do anything else. If that fails, then...

        loginCallbackResolve = RSVP.defer();

        displayLogInModal(Sk.ffi.remapToJs(pyAdditionalScopes || []));

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
    })

    /*!defFunction(anvil.facebook.auth,_,)!2*/ "Get the Facebook access token of the currently-logged-in Facebook user.\n\nTo log in with Facebook, call facebook.auth.login() from form code.";
    mod["get_user_access_token"] = new Sk.builtin.func(function() {
        var server = PyDefUtils.getModule("anvil.server");

        var call = server.tp$getattr(new Sk.builtin.str("call"));
        return Sk.misceval.callOrSuspend(call, undefined, undefined, undefined, Sk.ffi.remapToPy("anvil.private.facebook.auth.get_user_access_token"));
    })

    return mod;
});
