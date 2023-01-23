
var $builtinmodule = window.memoise('anvil.users.mfa.webauthn', function() {
    var mod = {};

    let getCredentials = function() {
        if (navigator.credentials) {
            return navigator.credentials;
        } else {
            if (window.anvilParams && window.anvilParams.inIDE) {
                throw new Sk.builtin.Exception("Cannot use hardware token authentication in the Anvil Editor - visit the app URL directly to test two-factor authentication.");
            } else {
                throw new Sk.builtin.Exception("Cannot use hardware token authentication here - is the app running in a cross-origin iframe?");
            }
        }
    };

    mod["is_webauthn_available"] = new Sk.builtin.func(function() {
        return !!navigator.credentials;
    });

    mod["create"] = new Sk.builtin.func(function(pyOptions) {
        var options = Sk.ffi.toJs(pyOptions);

        options.publicKey.challenge = base64DecToArr(options.publicKey.challenge);
        options.publicKey.user.id = base64DecToArr(options.publicKey.user.id);

        return PyDefUtils.suspensionFromPromise(getCredentials().create(options).then(function(r) {
            return Sk.ffi.toPy({
                attestationObject: base64EncArr(new Uint8Array(r.response.attestationObject)),
                clientDataJSON: base64EncArr(new Uint8Array(r.response.clientDataJSON)),
            });
        }).catch(function(e) {
            // TODO debug for Bridget
            console.log("webauthn failed/cancelled:", e);
            return Sk.ffi.toPy(null);
        }));
    });

    mod["get"] = new Sk.builtin.func(function(pyOptions) {
        var options = Sk.ffi.toJs(pyOptions);

        options.publicKey.challenge = base64DecToArr(options.publicKey.challenge);
        for (var i in options.publicKey.allowCredentials) {
            options.publicKey.allowCredentials[i].id = base64DecToArr(options.publicKey.allowCredentials[i].id);
        }

        return PyDefUtils.suspensionFromPromise(getCredentials().get(options).then(function(r) {
            return Sk.ffi.toPy({
                authenticatorData: base64EncArr(new Uint8Array(r.response.authenticatorData)),
                clientDataJSON: base64EncArr(new Uint8Array(r.response.clientDataJSON)),
                signature: base64EncArr(new Uint8Array(r.response.signature)),
            });
        }).catch(function(e) {
            return Sk.ffi.toPy(null);
        }));
    });


    return mod;
});