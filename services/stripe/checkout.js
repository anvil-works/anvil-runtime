var $builtinmodule = window.memoise('stripe.checkout', function() {

    var mod = {};

    var checkoutCallbackDefer = null;

    var loadKeys = RSVP.defer();
    var anvil = PyDefUtils.getModule("anvil");
    var appPath = Sk.ffi.remapToJs(anvil.tp$getattr(new Sk.builtin.str("app_path")));
    $.get(appPath + "/_/get_stripe_publishable_keys?s=" + window.anvilSessionToken, function(data) {
    	loadKeys.resolve(data);
    });

    var getToken = function(kwargs) {
    	var stripeMod = PyDefUtils.getModule("stripe");

    	var amount = kwargs["amount"];
    	var currency = kwargs["currency"];
    	var title = kwargs["title"] || "Online Payment";
    	var description = kwargs["description"] || "Powered by Anvil";
    	var zipCode = kwargs["zipcode"] || false;
    	var billingAddress = kwargs["billing_address"] || false;
      var email = kwargs["email"] || undefined;
    	var shippingAddress = false; //kwargs["shipping_address"]; // Shipping address appears not to do anything for now. Disable it.

    	var config = Sk.ffi.remapToJs(Sk.misceval.callsim(stripeMod.tp$getattr(new Sk.builtin.str("get_config"))));
    	checkoutCallbackDefer = RSVP.defer();

		var openHandler = function(keys) {

      var publishable_keys = kwargs["raw"] ? config.publishable_key : keys;

      if (kwargs["raw"] && !publishable_keys) {
        checkoutCallbackDefer.reject("Stripe API keys not found - please enter your Publishable Keys into Anvil's Stripe configuration page.");
        return;
      }

			var handler = StripeCheckout.configure({
			    key: (config.live_mode ? publishable_keys.live : publishable_keys.test),
			    image: kwargs["icon_url"] || (window.anvilCDNOrigin + '/ide/img/ANVIL-Logo-2015-no-tagline-no-name.png'),
			    locale: 'auto',
			    currency: currency,
			    token: function(token, args) {
			    	args.email = token.email;
					checkoutCallbackDefer.resolve([token.id, args]);
			    },
			    closed: function() {
			    	checkoutCallbackDefer.reject();
			    },
			    name: title,
		      	description: description,
		      	amount: amount,
		      	billingAddress: billingAddress,
		      	shippingAddress: shippingAddress,
		      	zipCode: zipCode,
		      	bitcoin: false,
		      	alipay: false,
		      	allowRememberMe: true,
            email: email,
			});

			handler.open();
		};

		var helpers = StripeCheckout.require("lib/helpers");
		var stripeWillPopup = helpers.isFallback() || (helpers.isSupportedMobileOS() && !(helpers.isNativeWebContainer() || helpers.isAndroidWebapp() || helpers.isiOSWebView() || helpers.isiOSBroken()));

		// TODO: Work out whether we have actually suspended before this point.
		// For now, be conservative and assume that we have.
		var popupWillBeBlocked = true;

		if (stripeWillPopup && popupWillBeBlocked) {
			var cancelled = true;
			$("#stripeContinue").off("click").one("click", function() {
				cancelled = false;
				loadKeys.promise.then(openHandler);
			});
			$("#stripe-checkout-modal").modal("show").off("hidden.bs.modal").one("hidden.bs.modal", function() {
				if (cancelled) {
					checkoutCallbackDefer.reject();
				}
			});
		} else {

			loadKeys.promise.then(openHandler);
		}

		return checkoutCallbackDefer.promise;
    };

    var pyGetToken = function(kwargs) {
      if (!("amount" in kwargs))
       throw new Sk.builtin.Exception("Missing argument: amount");

      if (!("currency" in kwargs))
       throw new Sk.builtin.Exception("Missing argument: currency");

      return PyDefUtils.suspensionFromPromise(getToken(kwargs).then(function(token) {
        var pyToken = new Sk.builtin.str(token[0]);
        var pyUserDetails = Sk.ffi.remapToPy(token[1]);
        return new Sk.builtin.tuple([pyToken, pyUserDetails]);
      }).catch(function(e) {
        console.error("Stripe checkout failed", e);
        throw new Sk.builtin.Exception("Stripe checkout " + (e ? ("failed: " + e) : "cancelled"));
      }))
    }

    mod["get_token_raw"] = PyDefUtils.funcWithKwargs(function(kwargs) {
      kwargs["raw"] = true;

      return pyGetToken(kwargs);
    });

    /*!defFunction(stripe.checkout,_,amount=,currency=,[title=],[description=],[icon_url=],[billing_address=],[zipcode=],[raw=])!2*/ "Show the Stripe checkout form, and return a raw (token, user_details) tuple.\n\nThe token can be used to place charges from server modules. The user_details are a dictionary of user-supplied data (eg 'email').\n\n'amount' is a number, in least units of currency (eg cents or pennies).\n'currency' is a three-letter currency code (eg 'USD').\n'title' and 'description' configure the checkout dialog.\nSetting 'zipcode' to True requires the user to enter their postal code.\nSetting 'billing_address' to True requires the user to entier a billing address.\n\nSetting 'raw' to True returns a token for your own API key, which is only useful if you are using the Stripe API directly. If you do this, you cannot use this token with the Anvil Stripe APIs."
    mod["get_token"] = PyDefUtils.funcWithKwargs(pyGetToken);

    /*!defFunction(stripe.checkout,_,amount=,currency=,[title=],[description=],[icon_url=],[billing_address=],[zipcode=])!2*/ "Charge the user for a one-off payment, by showing a Stripe checkout form. Returns a dictionary of information about the transaction on success.\n\n'amount' is a number, in least units of currency (eg cents or pennies).\n'currency' is a three-letter currency code (eg 'USD').\n'title' and 'description' configure the checkout dialog.\nSetting 'zipcode' to True requires the user to enter their postal code.\nSetting 'billing_address' to True requires the user to entier a billing address."
    mod["charge"] = PyDefUtils.funcWithKwargs(function(kwargs) {
      if (!("amount" in kwargs))
       throw new Sk.builtin.Exception("Missing argument: amount");

      if (!("currency" in kwargs))
       throw new Sk.builtin.Exception("Missing argument: currency");

  		return PyDefUtils.suspensionFromPromise(getToken(kwargs).then(function(token) {
  			var rpc = PyDefUtils.getModule("anvil.server");
  			console.log("TOKEN:", token);
  			var pyToken = new Sk.builtin.str(token[0]);

  			return Sk.misceval.callOrSuspend(rpc.tp$getattr(new Sk.builtin.str("call")), undefined, undefined, undefined, 
                                         new Sk.builtin.str("anvil.private.stripe.charge"), 
                                         pyToken, 
                                         Sk.ffi.remapToPy(kwargs["amount"]), 
                                         Sk.ffi.remapToPy(kwargs["currency"]));

  		}).catch(function(e) {
  			console.error("Stripe checkout failed", e);
  			throw new Sk.builtin.Exception("Stripe checkout failed");
  		}));
		
    });

    mod["subscribe"] = PyDefUtils.funcWithKwargs(function(kwargs) {
      if (!("plan" in kwargs))
       throw new Sk.builtin.Exception("Missing argument: plan");

      if (!("quantity" in kwargs))
       kwargs["quantity"] = 1;

    	return PyDefUtils.suspensionFromPromise(getToken(kwargs).then(function(token) {

        var rpc = PyDefUtils.getModule("anvil.server");
        var pyToken = new Sk.builtin.str(token[0]);

        return Sk.misceval.callOrSuspend(rpc.tp$getattr(new Sk.builtin.str("call")), undefined, undefined, undefined, 
                                         new Sk.builtin.str("anvil.private.stripe.subscribe"), 
                                         pyToken, 
                                         token[1].email,
                                         Sk.ffi.remapToPy(kwargs["plan"]),
                                         Sk.ffi.remapToPy(kwargs["quantity"]));

    	}).catch(function(e) {
    		console.error("Stripe checkout failed", e);
    		throw new Sk.builtin.Exception("Stripe checkout failed");
    	}));
    });

    mod["is_live_mode"] = new Sk.builtin.func(function() {
    	var stripeMod = PyDefUtils.getModule("stripe");
    	var config = Sk.ffi.remapToJs(Sk.misceval.call(stripeMod.tp$getattr(new Sk.builtin.str("get_config"))));

    	return config.live_mode ? Sk.builtin.bool.true$ : Sk.builtin.bool.false$;
    });

    return mod;
});
