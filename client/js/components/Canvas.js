"use strict";

var PyDefUtils = require("PyDefUtils");
const { PostponedResizeObserver } = require("../utils");

/*#
id: canvas
docs_url: /docs/client/components/canvas
title: Canvas
tooltip: Learn more about Canvas
description: |
  ```python
  c = Canvas()
  ```

  Canvas components allow you to draw graphics on your form. They are ideal for animations and visualisations.

  #### Colours

  There are several ways to specify colours on a Canvas. You can give a hexadecimal colour in
  the form `"#RRGGBB"` (where `"#FF0000"` would be bright red), or specify red, green, blue and alpha
  values separately: `"rgba(255,0,0,1)"`. It is also possible to specify gradients and patterns - see
  [HTML5 Canvas Docs](http://diveintohtml5.info/canvas.html) for details.

  #### Style Attributes

  \* `stroke_style` - The colour of lines drawn on the canvas
  \* `fill_style` - The colour of solid fill on the canvas

  #### Shadow Attributes

  \* `shadow_offset_x`, `shadow_offset_y`

     How far shadows should be displaced from drawn shapes

  \* `shadow_blur` - Blur amount, in pixels, for shadows

  \* `shadow_color` - The colour of shadows

  #### Line Attributes

  \* `line_width`

     > <table class="center">
     >   <tr><th>`butt`</th><th>`round`</th><th>`square`</th></tr>
     >   <tr>
     >     <td>![Butt](img/canvas_line_cap_butt.png)</td>
     >     <td>![Round](img/canvas_line_cap_round.png)</td>
     >     <td>![Square](img/canvas_line_cap_square.png)</td>
     >   </tr>
     > </table>

  \* `line_cap`

     The style of line ends. Takes one of these string values:

  \* `line_join`

     The style of line joins. Takes one of these string values:

     > <table class="center">
     >   <tr><th>`round`</th><th>`bevel`</th><th>`miter`</th></tr>
     >   <tr>
     >     <td>![Round](img/canvas_line_join_round.png)</td>
     >     <td>![Bevel](img/canvas_line_join_bevel.png)</td>
     >     <td>![Miter](img/canvas_line_join_miter.png)</td>
     >   </tr>
     > </table>

  \* `miter_limit` - Used to prevent `miter` corners from extending too far.

  #### Text Attributes

   ```python
   self.canvas1.font = "10px sans-serif"
   ```

  \* `font` - The font to use when rendering text.

  \* `text_align`

    How text should be aligned horizontally. Can be any of `start`, `end`, `left`, `right`, and `center`.
  \* `text_baseline`

    How text should be aligned vertically. One of `top`, `hanging`, `middle`, `alphabetic`, `ideographic` and `bottom`.

  #### Utility Methods

  \* `get_width()` - Returns the width of the canvas, in pixels
  \* `get_height()` - Returns the width of the canvas, in pixels

  #### Context Methods

  \* `reset_context()` - Should be called after resizing the canvas.

  #### Transformation Methods

  \* `save()` - Saves any transformations applied to the canvas so that they can be restored later.

  \* `restore()` - Restores any saved transformations.

  \* <code>translate(<i>x</i>, <i>y</i>)</code> - Updates the current transform so that all subsequent drawing commands are offset by `(x, y)` pixels.

  \* <code>rotate(<i>angle</i>)</code> - Updates the current transform so that all subsequent drawing commands are rotated by `angle` *radians*.

  \* <code>scale(<i>x</i>, <i>y</i>)</code> - Updates the current transform so that all subsequent drawing commands are scaled by a factor of `(x, y)`.

  \* <code>transform(<i>a</i>, <i>b</i>, <i>c</i>, <i>d</i>, <i>e</i>, <i>f</i>)</code> - Applies the given transformation matrix to the current transform.

  \* <code>set_transform(<i>a</i>, <i>b</i>, <i>c</i>, <i>d</i>, <i>e</i>, <i>f</i>)</code> - Sets the current transform to the matrix provided.

  \* `reset_transform()` - Resets the current transform to the identity matrix.

  #### Text Methods

  \* <code>fill_text(<i>text</i>, <i>x</i>, <i>y</i>)</code>

    Renders the string <code><i>text</i></code> at position <code>(<i>x</i>, <i>y</i>)</code>.

  \* <code>stroke_text(<i>text</i>, <i>x</i>, <i>y</i>)</code>

    Renders an outline of the string <code><i>text</i></code> at position <code>(<i>x</i>, <i>y</i>)</code>.

  \* <code>measure_text(<i>text</i>)</code>

    Returns the width, in pixels, of the string <code><i>text</i></code> as it would be if rendered on the canvas in the current font.

  #### Rectangle-Drawing Methods

  \* <code>clear_rect(<i>x</i>, <i>y</i>, <i>width</i>, <i>height</i>)</code> - Clears a rectangle

  \* <code>fill_rect(<i>x</i>, <i>y</i>, <i>width</i>, <i>height</i>)</code> - Fills a rectangle with the current `fill_style`.

  \* <code>stroke_rect(<i>x</i>, <i>y</i>, <i>width</i>, <i>height</i>)</code> - Draws the outline of a rectangle with the current `stroke_style`.

  #### Path-Drawing Methods

  ```python
  c = self.canvas1

  ## Draw an outlined triangle

  c.begin_path()
  c.move_to(100,100)
  c.line_to(200,150)
  c.line_to(150,200)
  c.close_path()

  c.stroke_style = "#BB7722"
  c.line_width = 5
  c.fill_style = "#8888FF"

  c.fill()
  c.stroke()

  ```

  \* `begin_path()`

     Tells the canvas that you are about to start drawing a shape.

  \* `close_path()`

     Connects the most recent edge of the shape to the start point, closing the path.

  \* `fill()`

     Fills the shape you have drawn in the current `fill_style`.

  \* `stroke()`

     Draws the outline of the shape you have defined in the current `stroke_style`.

  \* `clip()`

     Clips all subsequent drawing operations to the defined shape.

  \* <code>move_to(<i>x</i>, <i>y</i>)</code>

     Move to position <code>(<i>x</i>, <i>y</i>)</code> without drawing anything, ready to start the next edge of the current shape.

  \* <code>line_to(<i>x</i>, <i>y</i>)</code>

     Draw a line to position <code>(<i>x</i>, <i>y</i>)</code>.

  \* <code>arc(<i>x</i>, <i>y</i>, <i>radius</i>, <i>start_angle</i>, <i>end_angle</i>, <i>anticlockwise</i>)</code>

     Draw an arc to position <code>(<i>x</i>, <i>y</i>)</code> with the specified radius.


  #### Drawing an image
  ```python
  # Draw an image at position (100,100)
  self.my_canvas.draw_image(image_media, 100, 100)

  # Draw a 100x100 patch from this image
  # (a 100x100 patch starting at (50,50))
  # at position (25, 25), half scale (50x50)
  self.my_canvas.draw_image_part(image_media,
                                 50, 50, 100, 100,
                                 25, 25, 50, 50)
  ```

  \* <code>draw_image(<i>image_media</i>, <i>[x]</i>, <i>[y]</i>, <i>[width]</i>, <i>[height]</i>)</code>

     Draw an image (represented by a Media object) at position (x,y). Optionally specify width and height. If (x,y) is not specified, draws at (0,0).

  \* <code>draw_image(<i>image_media</i>, <i>sx</i>, <i>sy</i>, <i>s_width</i>, <i>s_height</i>, <i>dx</i>, <i>dy</i>, <i>d_width</i>, <i>d_height</i>)</code>

     Draw a part of an image (specifically the `s_width`x`s_height` rectangle whose top-left corner is at (`sx`,`sy`)) into a `d_width`x`d_height` rectangle whose top-left corner is at (`dx`,`dy`)).


  #### Saving your canvas as an image

  ```python
  img = self.my_canvas.get_image()

  self.image_1.source = img

  f = anvil.google.drive.app_files.my_file

  f.set_media(c.get_image())
  ```

  When you've drawn something on your canvas, you can get the contents of your canvas as a [Media object](#media) by calling `get_image()`.
  You can then display this image in an [Image](#image) components, or upload it to [Google Drive]().

  For more details, see the [Media object documentation](#media).

*/

module.exports = function(pyModule) {
    function resetContext(self, raiseEvent = true) {
        self._anvil.element.attr("width", self._anvil.element.width());
        self._anvil.element.attr("height", self._anvil.element.height());
        self._anvil.ctx = self._anvil.domNode.getContext("2d");

        if (raiseEvent) {
            PyDefUtils.raiseEventAsync({}, self, "reset");
        }
    }

    pyModule["Canvas"] = PyDefUtils.mkComponentCls(pyModule, "Canvas", {
        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(Canvas)!1*/ ["layout", "layout_margin", "height", "appearance", "user data", "tooltip"]),

        events: PyDefUtils.assembleGroupEvents(/*!componentEvents()!2*/ "Canvas", ["universal", "mouse"], {
            reset: /*!componentEvent(Canvas)!1*/ {
                name: "reset",
                description: "When the canvas is reset and cleared, such as when the window resizes, or the canvas is added to a form.",
                parameters: [],
                important: true,
                defaultEvent: true,
            },
        }),

        element(props) {
            const outerAttrs = PyDefUtils.getOuterAttrs(props);
            const outerStyle = PyDefUtils.getOuterStyle(props);
            const outerClass = PyDefUtils.getOuterClass(props);
            return <canvas refName="canvas" style={"width:100%; height: 150px; " + outerStyle} className={"anvil_notify_add " + outerClass} {...outerAttrs} />;
        },

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["ClassicComponent"], (self) => {
                const resizeObserver = new PostponedResizeObserver(() => {
                    if (self._anvil.onPage) {
                        resetContext(self);
                    }
                });

                self._anvil.gradients = {};
                self._anvil.pageEvents = {
                    add() {
                        resizeObserver.observe(self._anvil.domNode);
                        resetContext(self);
                    },
                    show() {
                        // We need this because setting visible = True inside a show event must fire resetContext
                        // relying on the resizeObserver here is not enough
                        resetContext(self);
                    },
                    remove() {
                        resizeObserver.disconnect();
                    },
                };

                resetContext(self, false);

                PyDefUtils.setupDefaultMouseEvents(self);

                if (ANVIL_IN_DESIGNER) {
                    PyDefUtils.addHeightHandle(self._anvil);
                }
            });

            /*!defMethod(_)!2*/ ("Get the pixel width of this canvas.");
            $loc["get_width"] = new Sk.builtin.func(function get_width(self) {
                return Sk.ffi.remapToPy(self._anvil.element.width());
            });

            /*!defMethod(_)!2*/ ("Get the pixel height of this canvas.");
            $loc["get_height"] = new Sk.builtin.func(function get_height(self) {
                return Sk.ffi.remapToPy(self._anvil.element.height());
            });

            // Properties
            [
                /*!defAttr()!1*/ {
                    name: "stroke_style",
                    type: "string",
                    description: "The color or gradient to use when drawing outlines.",
                },
                /*!defAttr()!1*/ {
                    name: "fill_style",
                    type: "string",
                    description: "The color or gradient to use when filling shapes and paths.",
                },
                /*!defAttr()!1*/ {
                    name: "shadow_offset_x",
                    type: "number",
                    description: "The horizontal shadow offset, in pixels.",
                },
                /*!defAttr()!1*/ {
                    name: "shadow_offset_y",
                    type: "number",
                    description: "The vertical shadow offset, in pixels.",
                },
                /*!defAttr()!1*/ {
                    name: "shadow_blur",
                    type: "number",
                    description: "The required shadow blur, in pixels.",
                },
                /*!defAttr()!1*/ {
                    name: "shadow_color",
                    type: "string",
                    description: "The color to use for shadows.",
                },
                /*!defAttr()!1*/ {
                    name: "global_alpha",
                    type: "number",
                    description: "The global opacity to draw with, in the range 0-1.",
                },
                /*!defAttr()!1*/ {
                    name: "global_composite_operation",
                    type: "string",
                    description: "The global composite operation to draw with. Defaults to 'source-over'",
                },
                /*!defAttr()!1*/ {
                    name: "line_width",
                    type: "number",
                    description: "The width of lines drawn on this canvas.",
                },
                /*!defAttr()!1*/ {
                    name: "line_cap",
                    type: "string",
                    description: "The line cap to use when drawing lines on this canvas.",
                },
                /*!defAttr()!1*/ {
                    name: "line_join",
                    type: "string",
                    description: "The line join to use when connecting lines on this canvas.",
                },
                /*!defAttr()!1*/ {
                    name: "miter_limit",
                    type: "number",
                    description: "The limit of line join miters, in pixels.",
                },
                /*!defAttr()!1*/ {
                    name: "font",
                    type: "string",
                    description: "The font to use when drawing text on this canvas.",
                },
                /*!defAttr()!1*/ {
                    name: "text_align",
                    type: "string",
                    description: "Text alignment, relative to the drawing point.",
                },
                /*!defAttr()!1*/ {
                    name: "text_baseline",
                    type: "string",
                    description: "Text baseline, relative to the drawing point.",
                },
            ];

            const contextProps = {
                stroke_style: "strokeStyle",
                fill_style: "fillStyle",
                shadow_offset_x: "shadowOffsetX",
                shadow_offset_y: "shadowOffsetY",
                shadow_blur: "shadowBlur",
                shadow_color: "shadowColor",
                global_alpha: "globalAlpha",
                global_composite_operation: "globalCompositeOperation",

                line_width: "lineWidth",
                line_cap: "lineCap",
                line_join: "lineJoin",
                miter_limit: "miterLimit",

                font: "font",
                text_align: "textAlign",
                text_baseline: "textBaseline",
            };

            const colorProps = ["stroke_style", "fill_style", "shadow_color"];

            $loc["__getattr__"] = new Sk.builtin.func(function (self, pyName) {
                const name = pyName.toString();

                // If this is a property that we know about on the canvas context object, return it.
                if (name in contextProps) {
                    var val = self._anvil.ctx[contextProps[name]];
                    if (val instanceof CanvasGradient) {
                        return self._anvil.gradients[name];
                    } else {
                        return Sk.ffi.remapToPy(self._anvil.ctx[contextProps[name]]);
                    }
                }

                throw new Sk.builtin.AttributeError("'" + self.tp$name + "' object has no attribute '" + name + "'");
            });

            $loc["__setattr__"] = new Sk.builtin.func(function (self, pyName, pyValue) {
                const name = pyName.toString();

                // If this is a property that we know about on the canvas context object, set it.
                if (name in contextProps) {
                    if (pyValue instanceof $loc["Gradient"]) {
                        self._anvil.ctx[contextProps[name]] = pyValue._anvil.canvasGradient;
                        self._anvil.gradients[name] = pyValue;
                    } else if (colorProps.indexOf(name) > -1) {
                        let v = PyDefUtils.getColor(pyValue);
                        self._anvil.ctx[contextProps[name]] = v;
                    } else {
                        self._anvil.ctx[contextProps[name]] = Sk.ffi.remapToJs(pyValue);
                    }
                } else {
                    return Sk.builtin.object.prototype.tp$setattr.call(self, pyName, pyValue);
                }
            });

            // Context

            /*!defMethod(_)!2*/ ("Reset the drawing context for this canvas. Called automatically after a window resize.");
            $loc["reset_context"] = new Sk.builtin.func(function reset_context(self) {
                resetContext(self);
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_)!2*/ ("Saves the current drawing transform, which can be restored by calling 'restore()'");
            $loc["save"] = new Sk.builtin.func(function save(self) {
                self._anvil.ctx.save();
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_)!2*/ ("Restores a drawing transform saved by the 'save()' function");
            $loc["restore"] = new Sk.builtin.func(function restore(self) {
                self._anvil.ctx.restore();
                return Sk.builtin.none.none$;
            });

            // Transforms

            /*!defMethod(_,x,y)!2*/ ("Translate all subsequent drawing by 'x' pixels across and 'y' pixels down.");
            $loc["translate"] = new Sk.builtin.func(function translate(self, x, y) {
                self._anvil.ctx.translate(Sk.ffi.remapToJs(x), Sk.ffi.remapToJs(y));
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_,angle)!2*/ ("Rotate all subsequent drawing by 'angle' radians.");
            $loc["rotate"] = new Sk.builtin.func(function rotate(self, angle) {
                self._anvil.ctx.rotate(Sk.ffi.remapToJs(angle));
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_, x,y)!2*/ ("Scale all subsequent drawing operations by 'x' horizontally and 'y' vertically.");
            $loc["scale"] = new Sk.builtin.func(function scale(self, x, y) {
                self._anvil.ctx.scale(Sk.ffi.remapToJs(x), Sk.ffi.remapToJs(y));
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_,a,b,c,d,e,f)!2*/ ("Multiply the current transform matrix by the specified matrix.");
            $loc["transform"] = new Sk.builtin.func(function transform(self, a, b, c, d, e, f) {
                self._anvil.ctx.transform(Sk.ffi.remapToJs(a), Sk.ffi.remapToJs(b), Sk.ffi.remapToJs(c), Sk.ffi.remapToJs(d), Sk.ffi.remapToJs(e), Sk.ffi.remapToJs(f));
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_)!2*/ ("Set the current transform matrix to the specified values.");
            $loc["set_transform"] = new Sk.builtin.func(function set_transform(self, a, b, c, d, e, f) {
                self._anvil.ctx.setTransform(
                    Sk.ffi.remapToJs(a),
                    Sk.ffi.remapToJs(b),
                    Sk.ffi.remapToJs(c),
                    Sk.ffi.remapToJs(d),
                    Sk.ffi.remapToJs(e),
                    Sk.ffi.remapToJs(f)
                );
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_)!2*/ ("Reset the current transform to the identity matrix.");
            $loc["reset_transform"] = new Sk.builtin.func(function reset_transform(self) {
                self._anvil.ctx.setTransform(1, 0, 0, 1, 0, 0);
                return Sk.builtin.none.none$;
            });

            // Text

            /*!defMethod(_,text,x,y)!2*/ ("Draw the specified text at the required position.");
            $loc["fill_text"] = new Sk.builtin.func(function fill_text(self, text, x, y) {
                self._anvil.ctx.fillText(Sk.ffi.remapToJs(text), Sk.ffi.remapToJs(x), Sk.ffi.remapToJs(y));
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_,text,x,y)!2*/ ("Draw the outline of the specified text at the required position.");
            $loc["stroke_text"] = new Sk.builtin.func(function (self, text, x, y) {
                self._anvil.ctx.strokeText(Sk.ffi.remapToJs(text), Sk.ffi.remapToJs(x), Sk.ffi.remapToJs(y));
                return Sk.builtin.none.none$;
            });

            // TODO: Work out what this returns and document it.
            /*!defMethod(_,text)!2*/ ("Get the size of the specified text in the current font.");
            $loc["measure_text"] = new Sk.builtin.func(function measure_text(self, text) {
                return Sk.ffi.remapToPy(self._anvil.ctx.measureText(Sk.ffi.remapToJs(text)).width);
            });

            // Rectangles

            /*!defMethod(_,x,y,width,height)!2*/ ("Clear the specified rectangle with the background color of the canvas.");
            $loc["clear_rect"] = new Sk.builtin.func(function clear_rect(self, x, y, width, height) {
                self._anvil.ctx.clearRect(Sk.ffi.remapToJs(x), Sk.ffi.remapToJs(y), Sk.ffi.remapToJs(width), Sk.ffi.remapToJs(height));
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_,x,y,width,height)!2*/ ("Fill the specified rectangle with the current fill style of the canvas.");
            $loc["fill_rect"] = new Sk.builtin.func(function fill_rect(self, x, y, width, height) {
                self._anvil.ctx.fillRect(Sk.ffi.remapToJs(x), Sk.ffi.remapToJs(y), Sk.ffi.remapToJs(width), Sk.ffi.remapToJs(height));
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_,x,y,width,height)!2*/ ("Outline the specified rectangle with the current stroke style of the canvas.");
            $loc["stroke_rect"] = new Sk.builtin.func(function stroke_rect(self, x, y, width, height) {
                self._anvil.ctx.strokeRect(Sk.ffi.remapToJs(x), Sk.ffi.remapToJs(y), Sk.ffi.remapToJs(width), Sk.ffi.remapToJs(height));
                return Sk.builtin.none.none$;
            });

            // Paths

            /*!defMethod(_)!2*/ ("Begin a path on the canvas.");
            $loc["begin_path"] = new Sk.builtin.func(function begin_path(self) {
                self._anvil.ctx.beginPath();
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_)!2*/ ("Close the current path with a straight line back to the start point.");
            $loc["close_path"] = new Sk.builtin.func(function close_path(self) {
                self._anvil.ctx.closePath();
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_)!2*/ ("Fill the current path with the current fill style of the canvas.");
            $loc["fill"] = new Sk.builtin.func(function fill(self) {
                self._anvil.ctx.fill();
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_)!2*/ ("Draw the current path with the current stroke style of the canvas.");
            $loc["stroke"] = new Sk.builtin.func(function stroke(self) {
                self._anvil.ctx.stroke();
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_)!2*/ ("Turn the current path into the clipping region of the canvas.");
            $loc["clip"] = new Sk.builtin.func(function clip(self) {
                self._anvil.ctx.clip();
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_,x,y)!2*/ ("Moves the current path position to the specified point without drawing.");
            $loc["move_to"] = new Sk.builtin.func(function move_to(self, x, y) {
                self._anvil.ctx.moveTo(Sk.ffi.remapToJs(x), Sk.ffi.remapToJs(y));
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_,x,y)!2*/ ("Adds a straight line segment at the end of the current path to the specified position.");
            $loc["line_to"] = new Sk.builtin.func(function line_to(self, x, y) {
                self._anvil.ctx.lineTo(Sk.ffi.remapToJs(x), Sk.ffi.remapToJs(y));
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_,cpx,cpy,x,y)!2*/ ("Adds a quadratic curve at the end of the current path to (x,y) with control point (cpx, cpy).");
            $loc["quadratic_curve_to"] = new Sk.builtin.func(function quadratic_curve_to(self, cpx, cpy, x, y) {
                self._anvil.ctx.quadraticCurveTo(Sk.ffi.remapToJs(cpx), Sk.ffi.remapToJs(cpy), Sk.ffi.remapToJs(x), Sk.ffi.remapToJs(y));
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_,cp1x,cp1y,cp2x,cp2y,x,y)!2*/ ("Adds a Bezier curve at the end of the current path to (x,y) with control points (cp1x,cp1y) and (cp2x,cp2y).");
            $loc["bezier_curve_to"] = new Sk.builtin.func(function bezier_curve_to(self, cp1x, cp1y, cp2x, cp2y, x, y) {
                self._anvil.ctx.bezierCurveTo(
                    Sk.ffi.remapToJs(cp1x),
                    Sk.ffi.remapToJs(cp1y),
                    Sk.ffi.remapToJs(cp2x),
                    Sk.ffi.remapToJs(cp2y),
                    Sk.ffi.remapToJs(x),
                    Sk.ffi.remapToJs(y)
                );
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_,x,y,radius,start_angle=0,end_angle=PI*2,anticlockwise=False)!2*/ ("Adds an arc to the end of the current path with specified center and radius.");
            $loc["arc"] = new Sk.builtin.func(function arc(self, x, y, radius, start_angle, end_angle, anticlockwise) {
                const sa = start_angle === undefined ? 0 : start_angle;
                const ea = end_angle === undefined ? Math.PI * 2 : end_angle;

                const ac = Sk.misceval.isTrue(anticlockwise);

                self._anvil.ctx.arc(Sk.ffi.remapToJs(x), Sk.ffi.remapToJs(y), Sk.ffi.remapToJs(radius), Sk.ffi.remapToJs(sa), Sk.ffi.remapToJs(ea), ac);
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_,media,[x],[y],[width],[height])!2*/ ("Draw an image (from a Media object) onto the canvas at the specified coordinates (optionally scaling to the specified width and height)");
            $loc["draw_image"] = new Sk.builtin.func(function draw_image(self, media, x, y, width, height) {
                return PyDefUtils.pyCallOrSuspend($loc["draw_image_part"], [self, media, null, null, null, null, x, y, width, height]);
            });

            /*!defMethod(_,media,sx,sy,s_width,s_height,dx,dy,d_width,d_height)!2*/ ("Draw a subset of an image (from a Media object) onto the canvas.\n\nsx, sy, s_width and s_height specify which pixels within the source image of the source image to draw. dx and dy (and optionally d_width and d_height) specify where (and optionally what dimensions) on the canvas to draw the image.");
            $loc["draw_image_part"] = new Sk.builtin.func(function (self, media, sx, sy, s_width, s_height, dx, dy, d_width, d_height) {
                if (!media || !Sk.misceval.isTrue(Sk.builtin.isinstance(media, pyModule["Media"]))) {
                    throw new Sk.builtin.TypeError("Must pass a Media object to draw_image() or draw_image_part()");
                }

                if (arguments.length !== 10) {
                    throw new Sk.builtin.TypeError("draw_image_part() takes 9 arguments");
                }

                (sx = sx ? Sk.ffi.remapToJs(sx) : undefined),
                    (sy = sy ? Sk.ffi.remapToJs(sy) : undefined),
                    (s_width = s_width ? Sk.ffi.remapToJs(s_width) : undefined),
                    (s_height = s_height ? Sk.ffi.remapToJs(s_height) : undefined),
                    (dx = dx ? Sk.ffi.remapToJs(dx) : 0),
                    (dy = dy ? Sk.ffi.remapToJs(dy) : 0),
                    (d_width = d_width ? Sk.ffi.remapToJs(d_width) : undefined),
                    (d_height = d_height ? Sk.ffi.remapToJs(d_height) : undefined);

                const ctx = self._anvil.ctx;

                const draw = (img) => {
                    if (sx !== undefined && sy !== undefined) {
                        ctx.drawImage(img, sx, sy, s_width, s_height, dx, dy, d_width, d_height);
                    } else if (d_width !== undefined && d_height !== undefined) {
                        ctx.drawImage(img, dx, dy, d_width, d_height);
                    } else {
                        ctx.drawImage(img, dx, dy);
                    }
                };

                if (media._anvilCachedImage) {
                    draw(media._anvilCachedImage);
                    return Sk.builtin.none.none$;
                } else {
                    return Sk.misceval.chain(PyDefUtils.getUrlForMedia(media), (h) =>
                        Sk.misceval.tryCatch(
                            () => {
                                return PyDefUtils.suspensionPromise((resolve, reject) => {
                                    let img = new Image();

                                    img.onload = () => {
                                        try {
                                            media._anvilCachedImage = img;
                                            draw(img);
                                            resolve();
                                        } catch (e) {
                                            reject(e);
                                        } finally {
                                            h.release();
                                        }
                                    };

                                    img.onerror = (e) => {
                                        reject("Could not load image " + h.getUrl());
                                        h.release();
                                    };

                                    img.src = h.getUrl();
                                });
                            },
                            function catchErr(e) {
                                h.release();
                                throw e;
                            }
                        )
                    );
                }
            });

            /*!defMethod(_)!2*/ ("Take a snapshot of the canvas and return an image as a Media object.");
            $loc["get_image"] = new Sk.builtin.func(function (self) {
                return PyDefUtils.pyCallOrSuspend(pyModule["URLMedia"], [new Sk.builtin.str(self._anvil.domNode.toDataURL())]);
            });

            // Gradients

            $loc["Gradient"] = Sk.misceval.buildClass(
                pyModule,
                function ($gbl, $loc) {
                    $loc["__init__"] = new Sk.builtin.func(function (self, jsGradient) {
                        if (jsGradient instanceof CanvasGradient) {
                            self._anvil = {
                                canvasGradient: jsGradient,
                            };
                        } else {
                            throw new Sk.builtin.RuntimeError("Cannot construct Canvas.Gradient from python.");
                        }
                        return Sk.builtin.none.none$;
                    });

                    /*!defMethod(_,offset,color)!2*/ ("Creates a new color stop on the gradient object. The offset argument is a number between 0 and 1, and defines the relative position of the color in the gradient. The color argument must be a string representing a CSS color.");
                    $loc["add_color_stop"] = new Sk.builtin.func(function (self, offset, color) {
                        self._anvil.canvasGradient.addColorStop(Sk.ffi.remapToJs(offset), Sk.ffi.remapToJs(color));
                        return Sk.builtin.none.none$;
                    });
                },
                "Canvas.Gradient",
                []
            );

            /*!defMethod(_,x0,y0,x1,y1)!2*/ ("Returns a gradient object representing a linear gradient from (x0,y0) to (x1,y1).");
            $loc["create_linear_gradient"] = new Sk.builtin.func(function create_linear_gradient(self, x0, y0, x1, y1) {
                x0 = Sk.ffi.remapToJs(x0);
                y0 = Sk.ffi.remapToJs(y0);
                x1 = Sk.ffi.remapToJs(x1);
                y1 = Sk.ffi.remapToJs(y1);

                const g = self._anvil.ctx.createLinearGradient(x0, y0, x1, y1);

                return PyDefUtils.pyCallOrSuspend($loc["Gradient"], [g]);
            });

            /*!defMethod(_,x0,y0,x1,y1)!2*/ ("Returns a gradient object representing a radial gradient from (x0,y0) with radius r0 to (x1,y1) with radius r1.");
            $loc["create_radial_gradient"] = new Sk.builtin.func(function (self, x0, y0, r0, x1, y1, r1) {
                x0 = Sk.ffi.remapToJs(x0);
                y0 = Sk.ffi.remapToJs(y0);
                r0 = Sk.ffi.remapToJs(r0);
                x1 = Sk.ffi.remapToJs(x1);
                y1 = Sk.ffi.remapToJs(y1);
                r1 = Sk.ffi.remapToJs(r1);

                const g = self._anvil.ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);

                return PyDefUtils.pyCallOrSuspend($loc["Gradient"], [g]);
            });
        },
    });
};
/*!defClass(anvil,Canvas,Component)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout, height, appearance
 *  - Event groups: universal, mouse
 *  - Methods: get_width, get_height,
 *             reset_context, save, restore,
 *             translate, rotate, scale, transform, set_transform, reset_transform,
 *             fill_text, stroke_text, measure_text,
 *             clear_rect, fill_rect, stroke_rect,
 *             begin_path, close_path, fill, stroke, clip, move_to, line_to, quadratic_curve_to, bezier_curve_to, arc,
 *             get_image,
 *             create_linear_gradient,
 *             create_radial_gradient
 *  - Attributes: stroke_style, fill_style, shadow_offset_x, shadow_offset_y, shadow_blur, shadow_color, global_alpha, line_width, line_cap, line_join, miter_limit, font, text_align, text_baseline
 */



