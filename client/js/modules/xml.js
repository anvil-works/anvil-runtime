"use strict";

module.exports = function() {

    var pyMod = {"__name__": new Sk.builtin.str("anvil.xml")};

    pyMod["XMLDocument"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {

        $loc["__init__"] = new Sk.builtin.func(function(self, doc) {
            self._anvil = {
                jqDoc: $(doc),
            };
        });

        $loc["find"] = new Sk.builtin.func(function(self, selector) {
            return Sk.misceval.call(pyMod["XMLDocument"], undefined, undefined, undefined, self._anvil.jqDoc.find(Sk.ffi.remapToJs(selector)));
        });

        $loc["attr"] = new Sk.builtin.func(function(self, name, newVal) {
            if (newVal) {
                self._anvil.jqDoc.attr(Sk.ffi.remapToJs(name), Sk.ffi.remapToJs(newVal));
                return self;
            } else {
                return Sk.ffi.remapToPy(self._anvil.jqDoc.attr(Sk.ffi.remapToJs(name)));
            }
        });

        $loc["text"] = new Sk.builtin.func(function(self, newVal) {
            if (newVal) {
                self._anvil.jqDoc.text(Sk.ffi.remapToJs(newVal));
                return self;
            } else {
                return Sk.ffi.remapToPy(self._anvil.jqDoc.text())
            }
        });

        $loc["tag_name"] = new Sk.builtin.func(function(self) {
            return Sk.ffi.remapToPy(self._anvil.jqDoc[0].tagName.split(":")[1] || self._anvil.jqDoc[0].tagName);
        });

        $loc["find_in_ns"] = new Sk.builtin.func(function(self, ns, name) {

            var rs = self._anvil.jqDoc[0].getElementsByTagNameNS(Sk.ffi.remapToJs(ns), Sk.ffi.remapToJs(name));
            var elements = [];
            $(rs).each(function(i,r) {
                var newThing = Sk.misceval.call(pyMod["XMLDocument"], undefined, undefined, undefined, r);
                elements.push(newThing);
            });

            return new Sk.builtin.list(elements);
        });

        $loc["serialize"] = new Sk.builtin.func(function(self) {
            return Sk.ffi.remapToPy(new XMLSerializer().serializeToString(self._anvil.jqDoc[0]));
        });

        $loc["__str__"] = $loc["__repr__"] = new Sk.builtin.func(function(self) {
            return Sk.ffi.remapToPy(self._anvil.jqDoc.text());
        });

    }, 'XMLDocument', []);

    return pyMod;
}

/*
 * TO TEST:
 * 
 *  - Classes: XMLDocument
 *      - Methods: find, attr, text, tag_name, find_in_ns, serialize
 *
 */