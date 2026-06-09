import type { pyObject } from "@Sk";
import { buildPyClass, pyCall, pyFunc, pyList, pyNone, pyStr, toJs, toPy } from "@Sk";

interface XMLDocumentObject extends pyObject {
    _anvil: {
        jqDoc: JQuery;
    };
}

const xml = () => {
    var pyMod: Record<string, pyObject> = { __name__: new pyStr("anvil.xml") };

    pyMod["XMLDocument"] = buildPyClass(
        pyMod,
        function ($gbl, $loc) {
            $loc["__init__"] = new pyFunc(function (self: XMLDocumentObject, doc: unknown) {
                self._anvil = {
                    jqDoc: $(doc as Element | Document | JQuery | JQuery.PlainObject | string),
                };
                return pyNone;
            });

            $loc["find"] = new pyFunc(function (self: XMLDocumentObject, selector: pyObject) {
                return pyCall(pyMod["XMLDocument"], [
                    self._anvil.jqDoc.find(toJs(selector) as string) as unknown as pyObject,
                ]);
            });

            $loc["attr"] = new pyFunc(function (self: XMLDocumentObject, name: pyStr, newVal?: pyStr) {
                if (newVal) {
                    self._anvil.jqDoc.attr(toJs(name), toJs(newVal));
                    return self;
                } else {
                    return toPy(self._anvil.jqDoc.attr(toJs(name)));
                }
            });

            $loc["text"] = new pyFunc(function (self: XMLDocumentObject, newVal?: pyStr) {
                if (newVal) {
                    self._anvil.jqDoc.text(toJs(newVal));
                    return self;
                } else {
                    return toPy(self._anvil.jqDoc.text());
                }
            });

            $loc["tag_name"] = new pyFunc(function (self: XMLDocumentObject) {
                return toPy(self._anvil.jqDoc[0].tagName.split(":")[1] || self._anvil.jqDoc[0].tagName);
            });

            $loc["find_in_ns"] = new pyFunc(function (self: XMLDocumentObject, ns: pyStr, name: pyStr) {
                const rs = self._anvil.jqDoc[0].getElementsByTagNameNS(toJs(ns), toJs(name));
                const elements: pyObject[] = [];
                $(rs).each(function (i, r) {
                    const newThing = pyCall(pyMod["XMLDocument"], [r as unknown as pyObject]);
                    elements.push(newThing);
                });
                return new pyList(elements);
            });

            $loc["serialize"] = new pyFunc(function (self: XMLDocumentObject) {
                return toPy(new XMLSerializer().serializeToString(self._anvil.jqDoc[0]));
            });

            $loc["__str__"] = $loc["__repr__"] = new pyFunc(function (self: XMLDocumentObject) {
                return toPy(self._anvil.jqDoc.text());
            });
        },
        "XMLDocument",
        []
    );

    return pyMod;
};

export default xml;

/*
 * TO TEST:
 *
 *  - Classes: XMLDocument
 *      - Methods: find, attr, text, tag_name, find_in_ns, serialize
 *
 */
