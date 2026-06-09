import type { pyObject, pyType } from "@Sk";
import { buildPyClass, pyCall, pyFunc, pyNone, pyStr, toJs, toPy } from "@Sk";

interface ShapeAnvilData {
    draw?: (ctx: CanvasRenderingContext2D) => void;
    hitTest?: (x: number, y: number) => boolean;
    moveBy?: (dx: number, dy: number) => void;
}

interface ShapeObject extends pyObject {
    _anvil: ShapeAnvilData;
}

type ShapeModule = Record<string, pyObject>;
type ShapeLocals = Record<string, pyObject>;
type CanvasStyle = string | CanvasGradient | CanvasPattern;

const pyToCanvasStyle = (value: pyObject | undefined) => toJs(value) as CanvasStyle;
const pyToNumber = (value: pyObject | undefined) => toJs(value) as number;

const shapes = () => {
    const pyMod: ShapeModule = { __name__: new pyStr("shapes") };

    pyMod["Shape"] = buildPyClass(
        pyMod,
        function (_$gbl: ShapeModule, $loc: ShapeLocals) {
            const draw = function (self: ShapeObject, ctx: CanvasRenderingContext2D) {
                ctx.fillStyle = pyToCanvasStyle(self.tp$getattr(new pyStr("fill")));
                ctx.strokeStyle = pyToCanvasStyle(self.tp$getattr(new pyStr("stroke")));
            };

            $loc["__init__"] = new pyFunc(function (self: ShapeObject, stroke: pyObject, fill: pyObject) {
                self.tp$setattr(new pyStr("fill"), fill);
                self.tp$setattr(new pyStr("stroke"), stroke);
                self.tp$setattr(new pyStr("draggable"), toPy(true));

                self._anvil = {};

                self._anvil.draw = draw.bind(null, self);

                return pyNone;
            });
        },
        "Shape",
        []
    );

    pyMod["Rectangle"] = buildPyClass(
        pyMod,
        function (_$gbl: ShapeModule, $loc: ShapeLocals) {
            const draw = function (
                self: ShapeObject,
                baseDraw: (ctx: CanvasRenderingContext2D) => void,
                ctx: CanvasRenderingContext2D
            ) {
                baseDraw(ctx);

                if (self.tp$getattr(new pyStr("fill")) != pyNone) {
                    ctx.fillRect(
                        pyToNumber(self.tp$getattr(new pyStr("x"))),
                        pyToNumber(self.tp$getattr(new pyStr("y"))),
                        pyToNumber(self.tp$getattr(new pyStr("width"))),
                        pyToNumber(self.tp$getattr(new pyStr("height")))
                    );
                }
                if (self.tp$getattr(new pyStr("stroke")) != pyNone) {
                    ctx.strokeRect(
                        pyToNumber(self.tp$getattr(new pyStr("x"))),
                        pyToNumber(self.tp$getattr(new pyStr("y"))),
                        pyToNumber(self.tp$getattr(new pyStr("width"))),
                        pyToNumber(self.tp$getattr(new pyStr("height")))
                    );
                }
            };

            const hitTest = function (self: ShapeObject, x: number, y: number) {
                let getattr = (n: string) => self.tp$getattr(new pyStr(n));
                return (
                    x > pyToNumber(getattr("x")) &&
                    y > pyToNumber(getattr("y")) &&
                    x < pyToNumber(getattr("x")) + pyToNumber(getattr("width")) &&
                    y < pyToNumber(getattr("y")) + pyToNumber(getattr("height"))
                );
            };

            const moveBy = function (self: ShapeObject, dx: number, dy: number) {
                self.tp$setattr(new pyStr("x"), toPy(pyToNumber(self.tp$getattr(new pyStr("x"))) + dx));
                self.tp$setattr(new pyStr("y"), toPy(pyToNumber(self.tp$getattr(new pyStr("y"))) + dy));
            };

            $loc["__init__"] = new pyFunc(function (
                self: ShapeObject,
                x: pyObject,
                y: pyObject,
                width: pyObject,
                height: pyObject,
                stroke: pyObject,
                fill: pyObject
            ) {
                Sk.misceval.call(
                    (pyMod["Shape"] as pyType<ShapeObject>).prototype["__init__"],
                    undefined,
                    undefined,
                    undefined,
                    self,
                    stroke,
                    fill
                );

                self.tp$setattr(new pyStr("x"), x);
                self.tp$setattr(new pyStr("y"), y);
                self.tp$setattr(new pyStr("width"), width);
                self.tp$setattr(new pyStr("height"), height);

                self._anvil.draw = draw.bind(null, self, self._anvil.draw!);
                self._anvil.hitTest = hitTest.bind(null, self);
                self._anvil.moveBy = moveBy.bind(null, self);

                return pyNone;
            });
        },
        "Rectangle",
        [pyMod["Shape"] as pyType]
    );

    pyMod["Circle"] = buildPyClass(
        pyMod,
        function (_$gbl: ShapeModule, $loc: ShapeLocals) {
            const draw = function (
                self: ShapeObject,
                baseDraw: (ctx: CanvasRenderingContext2D) => void,
                ctx: CanvasRenderingContext2D
            ) {
                baseDraw(ctx);

                ctx.beginPath();
                ctx.arc(
                    pyToNumber(self.tp$getattr(new pyStr("x"))),
                    pyToNumber(self.tp$getattr(new pyStr("y"))),
                    pyToNumber(self.tp$getattr(new pyStr("radius"))),
                    0,
                    2 * Math.PI
                );

                if (self.tp$getattr(new pyStr("fill")) != pyNone) {
                    ctx.fill();
                }
                if (self.tp$getattr(new pyStr("stroke")) != pyNone) {
                    ctx.stroke();
                }
            };

            const hitTest = function (self: ShapeObject, x: number, y: number) {
                const dx = x - pyToNumber(self.tp$getattr(new pyStr("x")));
                const dy = y - pyToNumber(self.tp$getattr(new pyStr("y")));
                return Math.sqrt(dx * dx + dy * dy) < pyToNumber(self.tp$getattr(new pyStr("radius")));
            };

            const moveBy = function (self: ShapeObject, dx: number, dy: number) {
                self.tp$setattr(new pyStr("x"), toPy(pyToNumber(self.tp$getattr(new pyStr("x"))) + dx));
                self.tp$setattr(new pyStr("y"), toPy(pyToNumber(self.tp$getattr(new pyStr("y"))) + dy));
            };

            $loc["__init__"] = new pyFunc(function (
                self: ShapeObject,
                x: pyObject,
                y: pyObject,
                radius: pyObject,
                stroke: pyObject,
                fill: pyObject
            ) {
                pyCall((pyMod["Shape"] as pyType<ShapeObject>).prototype["__init__"], [self, stroke, fill]);

                self.tp$setattr(new pyStr("x"), x);
                self.tp$setattr(new pyStr("y"), y);
                self.tp$setattr(new pyStr("radius"), radius);

                self._anvil.draw = draw.bind(null, self, self._anvil.draw!);
                self._anvil.hitTest = hitTest.bind(null, self);
                self._anvil.moveBy = moveBy.bind(null, self);

                return pyNone;
            });
        },
        "Circle",
        [pyMod["Shape"] as pyType]
    );

    return pyMod;
};

export default shapes;

/*
 * TO TEST:
 *
 *  - Classes: Shape, Rectangle, Circle
 *
 */
