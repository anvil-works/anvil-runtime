"use strict";

var PyDefUtils = require("PyDefUtils");

module.exports = function(pyModule) {

	pyModule["InvalidComponent"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

		var properties = [
			{name: "text", set: function(s,e,v) { e.find(".err").text(v); }},
			{name: "width", get: function(s,e) { return "default"; }},
		];

		$loc["__init__"] = PyDefUtils.mkInit(function init(self) {
            self._anvil.element = $('<div class="invalid-component"><i class="glyphicon glyphicon-remove"></i><div class="err"></div></div>');
        }, pyModule, $loc, properties, {}, pyModule["Component"]);

    }, 'InvalidComponent', [pyModule["Component"]]);
};

/*
 * TO TEST:
 *
 *  - New props: text, width
 *
 */
