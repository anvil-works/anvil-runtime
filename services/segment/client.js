// A Python->JS shim for the Segment.io API


var $builtinmodule = window.memoise('segment.client', function() {
	var mod = {};

	var wrapFn = function(f) {
		return new Sk.builtin.func(function(event, properties, pyUserId, pyTraits) {
			if (!window.analytics) {
				throw new Sk.builtin.Exception("You need to load the Segment.io service to use this feature");
			}
			var args = [];
			for (var i=0; i<arguments.length; i++) {
				args.push(Sk.ffi.remapToJs(arguments[i]));
			}
			return PyDefUtils.suspensionPromise(function(resolve, reject) {
				args.push(resolve);
				window.analytics[f].apply(window.analytics, args);
			});
		});
	};

	/*!defFunction(segment.client,_,user_id,[traits],[options])!2*/
	"Identify a user to associate subsequent actions to a recognisable user ID and traits"
	mod['identify'] = wrapFn("identify");

	/*!defFunction(segment.client,_,event,[properties],[options])!2*/
	"Track an action performed by the current user"
	mod['track'] = wrapFn("track");

	/*!defFunction(segment.client,_,[category],[name],[options])!2*/
	"Register a virtual page change"
	mod['page'] = wrapFn("page");

	/*!defFunction(segment.client,_,group_id,[traits],[options])!2*/
	"Identify this user as a member of a group"
	mod['group'] = wrapFn("group");

	/*!defFunction(segment.client,_,new_user_id,[previous_id],[options])!2*/
	"Combines two previously unassociated user identities. (previous_id defaults to the current user)"
	mod['alias'] = wrapFn("alias");

	return mod;
});
