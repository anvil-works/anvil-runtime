"use strict";

var PyDefUtils = require("PyDefUtils");

/**
id: simplecanvas
feature: simpleCanvas
title: SimpleCanvas
tooltip: Learn more about SimpleCanvas
description:
 - |
  The SimpleCanvas allows you to draw and modify shapes without having to worry about issues like animation timing.
*/

module.exports = function(pyModule) {

    pyModule["SimpleCanvas"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

    
        $loc["__init__"] = new Sk.builtin.func(PyDefUtils.withRawKwargs(function(kwargs, self) {
            Sk.misceval.call(pyModule["Canvas"].prototype["__init__"], undefined, undefined, kwargs, self);

            // Add extra SimpleCanvas events

            self._anvil.eventTypes["shape_grab"] = {
                name: "shape_grab",
                description: "When the user grabs a shape",
                parameters: [{
                    name: "shape",
                    pyVal: true,
                    important: true,
                }, {
                    name: "mouse_x",
                }, {
                    name: "mouse_y",
                }]
            };

            self._anvil.eventTypes["shape_drag"] = {
                name: "shape_drag",
                description: "When the user drags a shape",
                parameters: [{
                    name: "shape",
                    pyVal: true,
                    important: true,
                }, {
                    name: "mouse_x",
                }, {
                    name: "mouse_y",
                }]
            };

            self._anvil.eventTypes["shape_drop"] = {
                name: "shape_drop",
                description: "When the user drops a shape",
                parameters: [{
                    name: "shape",
                    pyVal: true,
                    important: true,
                }, {
                    name: "mouse_x",
                }, {
                    name: "mouse_y",
                }]
            };

            self._anvil.eventTypes["shape_click"] = {
                name: "shape_click",
                description: "When the user clicks on a shape",
                parameters: [{
                    name: "shape",
                    pyVal: true,
                    important: true,
                }, {
                    name: "mouse_x",
                }, {
                    name: "mouse_y",
                }]
            };


            var redraw = function() {
                var w = self._anvil.element.width();
                var h = self._anvil.element.height();

                var ctx = self._anvil.element[0].getContext('2d');

                ctx.clearRect(0,0,w,h);

                for (var i in self.shapes.v) {
                    var s = self.shapes.v[i];

                    s._anvil.draw(ctx);
                }

            }

            window.requestAnimationFrame(function frame() {
                redraw();
                window.requestAnimationFrame(frame);
            });


            var hitTest = function(x, y) {
                var topHit = null;
                for (var i in self.shapes.v) {
                    var s = self.shapes.v[i];
                    if (s._anvil.hitTest(x,y)) {
                        topHit = s;
                    }
                }
                return topHit
            }


            var draggingShape = null;
            var lastMouseX = 0;
            var lastMouseY = 0;
            var grabX = 0;
            var grabY = 0;

            var mousedown = function(e) {
                var offset = self._anvil.element.offset();
                var x = e.pageX - offset.left;
                var y = e.pageY - offset.top;

                var hit = hitTest(x, y);
                if (hit) {
                    if (Sk.ffi.remapToJs(hit.tp$getattr(new Sk.builtin.str("draggable")))) {
                        draggingShape = hit;
                        grabX = x;
                        grabY = y;
                        PyDefUtils.raiseEventAsync({shape: hit, mouse_x: x, mouse_y: y}, self, "shape_grab");
                    }
                }
            }

            var mousemove = function(e) {
                var offset = self._anvil.element.offset();
                var x = e.pageX - offset.left;
                var y = e.pageY - offset.top;

                if (draggingShape) {
                    draggingShape._anvil.moveBy(x - lastMouseX, y - lastMouseY);
                    PyDefUtils.raiseEventAsync({shape: draggingShape, mouse_x: x, mouse_y: y}, self, "shape_drag");
                } else {
                    var hit = hitTest(x, y);
                    if (hit && Sk.ffi.remapToJs(hit.tp$getattr(new Sk.builtin.str("draggable")))) {
                        self._anvil.element.css({cursor: 'move'});
                    } else {
                        self._anvil.element.css({cursor: 'initial'});
                    }
                }

                lastMouseX = x;
                lastMouseY = y;
            }

            var mouseup = function(e) {
                var offset = self._anvil.element.offset();
                var x = e.pageX - offset.left;
                var y = e.pageY - offset.top;

                if (draggingShape) {
                    PyDefUtils.raiseEventAsync({shape: draggingShape, mouse_x: x, mouse_y: y}, self, "shape_drop");

                    if (x - grabX == 0 && y - grabY == 0) {
                        // This was a click, not a drag.
                        PyDefUtils.raiseEventAsync({shape: draggingShape, mouse_x: x, mouse_y: y}, self, "shape_click");
                    }
                }

                draggingShape = null;
            }

            self._anvil.element.on("mousedown", mousedown);
            self._anvil.element.on("mousemove", mousemove);
            self._anvil.element.on("mouseup", mouseup);
        }));

        $loc["shapes"] = new Sk.builtin.list();


    }, 'SimpleCanvas', [pyModule["Canvas"]]);
};

/*
 * TO TEST:
 * 
 *  - New events: shape_grab, shape_drag, shape_drop, shape_click
 *
 */