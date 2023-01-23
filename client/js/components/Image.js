"use strict";

var PyDefUtils = require("PyDefUtils");

/*#
id: image
docs_url: /docs/client/components/basic#image
title: Image
tooltip: Learn more about Images
description: |
  ```python
  c = Image(source="http://www.example.com/image.jpg")
  ```

  Image components display an image on a form. To manipulate images, see [the Image module](#image_module).

  Which image is displayed is determined by the *source* property. If this is set to a string,
  the image will be loaded from a URL given by that string.

  ```python
  c.source = anvil.google.drive.app_files.my_image_jpg
  ```

  However, you can also work with images in code using [Media objects](#media).
  For example, [Google Drive files](#google_drive) are Media objects, so you can display an image from
  Google Drive directly in an `Image` component.

  If you read the `source` attribute of an Image, you will always see a Media object, even if
  you set it to a string. (Anvil automatically generates a `URLMedia` object for that URL.)
*/

module.exports = (pyModule) => {
    const { isTrue } = Sk.misceval;

    pyModule["Image"] = PyDefUtils.mkComponentCls(pyModule, "Image", {
        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(Image)!1*/ ["layout", "height", "appearance", "tooltip", "user data"], {
            height: {
                defaultValue: new Sk.builtin.str("200"),
                pyVal: true,
                set(s, e, v) {
                    v = v.toString();
                    e.css("height", s._anvil.isSelfSizing ? "" : v);
                    s._anvil.height = v;
                },
                description: "The height of the image (ignored if in fill_width and original_size display modes)",
            },
            foreground: {
                hidden: true,
            },

            display_mode: /*!componentProp(Image)!1*/ {
                name: "display_mode",
                type: "enum",
                priority: 2,
                important: true,
                defaultValue: new Sk.builtin.str("shrink_to_fit"),
                pyVal: true,
                options: ["shrink_to_fit", "zoom_to_fill", "fill_width", "original_size"],
                description: "Determines how the image's size should be adjusted to fit the size of this Image component",
                initialize: true,
                set(self, element, v) {
                    v = v.toString();
                    self._anvil.isSelfSizing = v === "original_size" || v === "fill_width";
                    /* TODO: Toggle anvil-inlinable class (and somehow get parent container eg FlowPanel to pay attention to that) */
                    if (self._anvil.onPage) {
                        self._anvil.pageEvents.add();
                    }
                },
            },

            align: {
                name: "align",
                deprecated: true,
                hidden: true,
                type: "string",
                defaultValue: new Sk.builtin.str("center"),
                pyVal: true,
                set(s, e, v) {
                    s._anvil.setProp("horizontal_align", v);
                },
            },

            horizontal_align: /*!componentProp(Image)!1*/ {
                name: "horizontal_align",
                priority: 3,
                group: "Image Display",
                type: "enum",
                options: ["left", "center", "right"],
                description: "Position the image horizontally within this component",
                defaultValue: new Sk.builtin.str("center"),
                pyVal: true,
                important: true,
                set(s, e, v) {
                    v = v.toString();
                    e.css("text-align", v);
                    if (s._anvil.onPage) {
                        s._anvil.pageEvents.add();
                    }
                },
            },

            vertical_align: /*!componentProp(Image)!1*/ {
                name: "vertical_align",
                group: "Image Display",
                important: true,
                type: "enum",
                defaultValue: new Sk.builtin.str("center"),
                pyVal: true,
                options: ["top", "center", "bottom"],
                description: "Position the image vertically within this component",
                set(self, element, v) {
                    if (self._anvil.onPage) {
                        self._anvil.pageEvents.add();
                    }
                },
            },

            source: /*!componentProp(Image)!1*/ {
                name: "source",
                priority: 1,
                important: true,
                suggested: true,
                type: "uri",
                description: "The image source - set a string for a URL or a Media object in code",
                pyVal: true,
                defaultValue: new Sk.builtin.str(""),
                exampleValue: new Sk.builtin.str("http://mysite.com/logo.png"),
                initialize: true,
                dataBindingProp: true,
                get(s, e) {
                    return s._anvil.pyMedia || Sk.builtin.none.none$;
                },
                getJS(s, e) {
                    return s._anvil.urlString || "";
                },
                set(self, e, v) {
                    if (self._anvil.urlHandle) {
                        self._anvil.urlHandle.release();
                        self._anvil.urlHandle = null;
                    }
                    self._anvil.urlString = null;

                    if (Sk.builtin.checkNone(v)) {
                        self._anvil.pyMedia = v;
                    } else if (Sk.builtin.checkString(v)) {
                        const jsStr = v.toString();
                        self._anvil.urlString = jsStr;
                        setWithUrl(self, jsStr);
                        self._anvil.pyMedia = PyDefUtils.pyCall(pyModule["URLMedia"], [v]);
                    } else if (isTrue(Sk.builtin.isinstance(v, pyModule["Media"]))) {
                        self._anvil.pyMedia = v;
                    } else {
                        throw new Sk.builtin.TypeError("The 'source' property can only be set to a Media object or a URL");
                    }

                    return Sk.misceval.chain(PyDefUtils.getUrlForMedia(self._anvil.pyMedia), (h) => {
                        self._anvil.urlHandle = h;
                        if (self._anvil.onPage) {
                            self._anvil.pageEvents.add();
                        }
                    });
                },
            },
        }),

        events: PyDefUtils.assembleGroupEvents(/*!componentEvents()!2*/ "Image", ["universal", "mouse"]),

        element({ height, display_mode, horizontal_align, align, ...props }) {
            display_mode = display_mode.toString();
            height = display_mode === "original_size" || display_mode === "fill_width" ? "" : "height: " + PyDefUtils.cssLength(height.toString()) + ";";
            horizontal_align = horizontal_align.toString();

            return (
                <PyDefUtils.OuterElement
                    className="anvil-image"
                    style={"min-height:20px; text-align: " + horizontal_align + "; background-repeat: no-repeat; background-size: contain;" + height}
                    {...props}
                />
            );
        },

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["ClassicComponent"], (self) => {
                self._anvil.pageEvents = {
                    remove() {
                        if (self._anvil.urlHandle) {
                            self._anvil.urlHandle.release();
                        }
                    },
                    add() {
                        if (self._anvil.urlHandle) {
                            //console.log("Adding handle", self._anvil.urlHandle);
                            setWithUrl(self, self._anvil.urlHandle.getUrl());
                        }
                    },
                };

                PyDefUtils.setupDefaultMouseEvents(self);
                self._anvil.height = self._anvil.props["height"].toString();
            });
        },
    });

    function setWithUrl(self, jsU) {
        const e = self._anvil.element;
        if (jsU) {
            const displayMode = self._anvil.getProp("display_mode").toString();
            if (self._anvil.isSelfSizing) {
                e.empty().css({ "background-image": "none", height: "" });
                $("<img>")
                    .css(displayMode === "fill_width" ? "width" : "max-width", "100%")
                    .attr("src", jsU)
                    .appendTo(e);
            } else {
                e.empty();
                e.css({
                    "background-image": "url('" + ("" + jsU).replace("'", "%27") + "')",
                    "background-size": displayMode === "zoom_to_fill" ? "cover" : "contain",
                    "background-repeat": "no-repeat",
                    "background-position": self._anvil.getProp("horizontal_align") + " " + self._anvil.getProp("vertical_align"),
                    height: self._anvil.height,
                });
            }
            e.removeClass("anvil-image-empty");
        } else {
            e.empty();
            e.css({ "background-image": "", "background-size": "auto", "background-position": "center", "background-repeat": "no-repeat" });
            e.addClass("anvil-image-empty");
        }
    }

};

/*!defClass(anvil,Image,Component)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout, height, align, appearance
 *  - New props: source
 *  - Override props: align, height, background, foreground
 *  - Event groups: universal
 *
 */
