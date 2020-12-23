"use strict";

module.exports = function() {
    var pyMod = {"__name__": new Sk.builtin.str("shapes")};
    var PyDefUtils = require("PyDefUtils");


    pyMod["Shape"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {

        var draw = function(self, ctx) {
            ctx.fillStyle = Sk.ffi.remapToJs(self.tp$getattr(new Sk.builtin.str("fill")));
            ctx.strokeStyle = Sk.ffi.remapToJs(self.tp$getattr(new Sk.builtin.str("stroke")));
        };

        $loc["__init__"] = new Sk.builtin.func(function(self, stroke, fill) {
            self.tp$setattr(new Sk.builtin.str("fill"), fill);
            self.tp$setattr(new Sk.builtin.str("stroke"), stroke);
            self.tp$setattr(new Sk.builtin.str("draggable"), Sk.ffi.remapToPy(true));

            self._anvil = {};

            self._anvil.draw = draw.bind(null, self);
        });

    }, 'Shape', []);

    pyMod["Rectangle"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {

        var draw = function(self, baseDraw, ctx) {
            baseDraw(ctx);

            if (self.tp$getattr(new Sk.builtin.str("fill")) != Sk.builtin.none.none$) {
                ctx.fillRect(Sk.ffi.remapToJs(self.tp$getattr(new Sk.builtin.str("x"))),
                             Sk.ffi.remapToJs(self.tp$getattr(new Sk.builtin.str("y"))),
                             Sk.ffi.remapToJs(self.tp$getattr(new Sk.builtin.str("width"))),
                             Sk.ffi.remapToJs(self.tp$getattr(new Sk.builtin.str("height"))));
            }
            if (self.tp$getattr(new Sk.builtin.str("stroke")) != Sk.builtin.none.none$) {
                ctx.strokeRect(Sk.ffi.remapToJs(self.tp$getattr(new Sk.builtin.str("x"))),
                               Sk.ffi.remapToJs(self.tp$getattr(new Sk.builtin.str("y"))),
                               Sk.ffi.remapToJs(self.tp$getattr(new Sk.builtin.str("width"))),
                               Sk.ffi.remapToJs(self.tp$getattr(new Sk.builtin.str("height"))));
            }
        };

        var hitTest = function(self, x, y) {
            let getattr = (n) => self.tp$getattr(new Sk.builtin.str(n));
            return x > Sk.ffi.remapToJs(getattr("x")) &&
                   y > Sk.ffi.remapToJs(getattr("y")) &&
                   x < Sk.ffi.remapToJs(getattr("x")) + Sk.ffi.remapToJs(getattr("width")) &&
                   y < Sk.ffi.remapToJs(getattr("y")) + Sk.ffi.remapToJs(getattr("height"));
        }

        var moveBy = function(self, dx, dy) {
            self.tp$setattr(new Sk.builtin.str("x"), Sk.ffi.remapToPy(Sk.ffi.remapToJs(self.tp$getattr(new Sk.builtin.str("x"))) + dx));
            self.tp$setattr(new Sk.builtin.str("y"), Sk.ffi.remapToPy(Sk.ffi.remapToJs(self.tp$getattr(new Sk.builtin.str("y"))) + dy));
        }

        $loc["__init__"] = new Sk.builtin.func(function(self, x, y, width, height, stroke, fill) {
            Sk.misceval.call(pyMod["Shape"].prototype["__init__"], undefined, undefined, undefined, self, stroke, fill);

            self.tp$setattr(new Sk.builtin.str("x"), x);
            self.tp$setattr(new Sk.builtin.str("y"), y);
            self.tp$setattr(new Sk.builtin.str("width"), width);
            self.tp$setattr(new Sk.builtin.str("height"), height);

            self._anvil.draw = draw.bind(null, self, self._anvil.draw);
            self._anvil.hitTest = hitTest.bind(null, self);
            self._anvil.moveBy = moveBy.bind(null, self);
        });

    }, 'Rectangle', [pyMod["Shape"]]);

    pyMod["Circle"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {

        var draw = function(self, baseDraw, ctx) {
            baseDraw(ctx);

            ctx.beginPath();
            ctx.arc(Sk.ffi.remapToJs(self.tp$getattr(new Sk.builtin.str("x"))),
                    Sk.ffi.remapToJs(self.tp$getattr(new Sk.builtin.str("y"))),
                    Sk.ffi.remapToJs(self.tp$getattr(new Sk.builtin.str("radius"))),
                    0, 2*Math.PI);

            if (self.tp$getattr(new Sk.builtin.str("fill")) != Sk.builtin.none.none$) {
                ctx.fill();
            }
            if (self.tp$getattr(new Sk.builtin.str("stroke")) != Sk.builtin.none.none$) {
                ctx.stroke();
            }

        }

        var hitTest = function(self, x,y) {
            var dx = x - Sk.ffi.remapToJs(self.tp$getattr(new Sk.builtin.str("x")));
            var dy = y - Sk.ffi.remapToJs(self.tp$getattr(new Sk.builtin.str("y")));
            return Math.sqrt(dx*dx + dy*dy) < Sk.ffi.remapToJs(self.tp$getattr(new Sk.builtin.str("radius")));
        }

        var moveBy = function(self, dx, dy) {
            self.tp$setattr(new Sk.builtin.str("x"), Sk.ffi.remapToPy(Sk.ffi.remapToJs(self.tp$getattr(new Sk.builtin.str("x"))) + dx));
            self.tp$setattr(new Sk.builtin.str("y"), Sk.ffi.remapToPy(Sk.ffi.remapToJs(self.tp$getattr(new Sk.builtin.str("y"))) + dy));
        }

        $loc["__init__"] = new Sk.builtin.func(function(self, x, y, radius, stroke, fill) {
            Sk.misceval.call(pyMod["Shape"].prototype["__init__"], undefined, undefined, undefined, self, stroke, fill);

            self.tp$setattr(new Sk.builtin.str("x"), x);
            self.tp$setattr(new Sk.builtin.str("y"), y);
            self.tp$setattr(new Sk.builtin.str("radius"), radius);

            self._anvil.draw = draw.bind(null, self, self._anvil.draw);
            self._anvil.hitTest = hitTest.bind(null, self);
            self._anvil.moveBy = moveBy.bind(null, self);
        });

    }, 'Circle', [pyMod["Shape"]]);


    return pyMod;
}

/*
 * TO TEST:
 * 
 *  - Classes: Shape, Rectangle, Circle
 *
 */