"use strict";

var PyDefUtils = require("PyDefUtils");

/**
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

module.exports = function(pyModule) {

	pyModule["Image"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var properties = PyDefUtils.assembleGroupProperties(
            /*!componentProps(Image)!1*/["layout", "height", "appearance", "tooltip", "user data"], {
                height: {
                    defaultValue: 200,
                    set: function(s,e,v) {
                        e.css("height", s._anvil.isSelfSizing ? "" : v);
                        s._anvil.height = v;
                    },
                    description: "The height of the image (ignored if in fill_width and original_size display modes)",
                },
                background: {
                    set: function(s,e,v) { e.css("background-color", v); },
                },
                foreground: {
                    hidden: true,
                },
            }
        );

        var setWithUrl = function(self, jsU) {
            var e = self._anvil.element;
            if (jsU) {
                let displayMode = self._anvil.getPropJS("display_mode");
                if (self._anvil.isSelfSizing) {
                    e.empty().css({"background-image": "none", "height": ""});
                    $("<img>")
                        .css((displayMode=="fill_width") ? "width" : "max-width", "100%")
                        .attr("src", jsU)
                        .appendTo(e);
                } else {
                    e.empty();
                    e.css({"background-image": "url('" + (""+jsU).replace("'", "%27") + "')",
                           "background-size": (displayMode == "zoom_to_fill") ? "cover" : "contain",
                           "background-repeat": "no-repeat",
                           "background-position": self._anvil.getPropJS("horizontal_align")+" "+self._anvil.getPropJS("vertical_align"),
                           "height": self._anvil.height});
                }
                e.removeClass("anvil-image-empty");
            } else {
                e.empty();
                e.css({"background-image": "", "background-size": "auto", "background-position": "center", "background-repeat": "no-repeat"});
                e.addClass("anvil-image-empty");
            }
        }

        /*!componentProp(Image)!1*/
        properties.push({
            name: "display_mode",
            type: "string",
            priority: 2,
            important: true,
            defaultValue: "shrink_to_fit",
            enum: ["shrink_to_fit", "zoom_to_fill", "fill_width", "original_size"],
            description: "Determines how the image's size should be adjusted to fit the size of this Image component",
            set: function(self, element, v) {
                self._anvil.isSelfSizing = (v == "original_size" || v == "fill_width");
                /* TODO: Toggle anvil-inlinable class (and somehow get parent container eg FlowPanel to pay attention to that) */
                if (self._anvil.onPage) {
                    self._anvil.pageEvents.add();
                }
            }
        });

        properties.push({
            name: "align",
            deprecated: true,
            hidden: true,
            type: "string",
            defaultValue: "center",
            set: function(s,e,v) {
                s._anvil.setPropJS("horizontal_align", v);
            }
        })

        properties.push({
            name: "horizontal_align",
            priority: 3,
            group: "Image Display",
            type: "string",
            enum: ["left", "center", "right"],
            description: "Position the image horizontally within this component",
            defaultValue: "center",
            important: true,
            set: function(s,e,v) {
                e.css("text-align", v);
                if (s._anvil.onPage) {
                    s._anvil.pageEvents.add();
                }
            }
        })

        /*!componentProp(Image)!1*/
        properties.push({
            name: "vertical_align",
            group: "Image Display",
            important: true,
            type: "string",
            defaultValue: "center",
            enum: ["top", "center", "bottom"],
            description: "Position the image vertically within this component",
            set: function(self, element, v) {
                if (self._anvil.onPage) {
                    self._anvil.pageEvents.add();
                }
            }
        });


        /*!componentProp(Image)!1*/
        properties.push({
            name: "source",
            priority: 1,
            important: true,
            suggested: true,
            type: "uri",
            description: "The image source - set a string for a URL or a Media object in code",
            pyVal: true,
            defaultValue: new Sk.builtin.str(""),
            exampleValue: new Sk.builtin.str("http://mysite.com/logo.png"),
            get: function(s,e) {
                return s._anvil.pyMedia || Sk.builtin.none.none$;
            },
            getJS: function(s,e) {
                return s._anvil.urlString || "";
            },
            set: function(self,e,v) {
                if (self._anvil.urlHandle) {
                    self._anvil.urlHandle.release();
                    self._anvil.urlHandle = null;
                }
                self._anvil.urlString = null;

                if (!v || v === Sk.builtin.none.none$) {
                    self._anvil.pyMedia = Sk.builtin.none.none$;
                } else if (v instanceof Sk.builtin.str) {
                    self._anvil.urlString = v.v;
                    setWithUrl(self, v.v);
                    self._anvil.pyMedia = Sk.misceval.call(pyModule["URLMedia"], undefined, undefined, undefined, v);
                } else if (Sk.misceval.isTrue(Sk.builtin.isinstance(v, pyModule["Media"]))) {
                    self._anvil.pyMedia = v;
                } else {
                    throw new Sk.builtin.Exception("The 'source' property can only be set to a Media object or a URL");
                }

                return Sk.misceval.chain(PyDefUtils.getUrlForMedia(self._anvil.pyMedia), function(h) {
                    self._anvil.urlHandle = h;
                    if (self._anvil.onPage) {
                        self._anvil.pageEvents.add();
                    }
                });
            },
        });

        var events = PyDefUtils.assembleGroupEvents(/*!componentEvents()!2*/ "Image", ["universal", "mouse"]);

		$loc["__init__"] = PyDefUtils.mkInit(function init(self) {
            self._anvil.element = $('<div>').addClass("anvil-image").css({
                minHeight: "20px",
                "text-align": "center",
                "background-repeat": "no-repeat",
                "background-size": "contain"
            });

            self._anvil.pageEvents = {
                remove: function() {
                    if (self._anvil.urlHandle) {
                        self._anvil.urlHandle.release();
                    }
                },
                add: function() {
                    if (self._anvil.urlHandle) {
                        //console.log("Adding handle", self._anvil.urlHandle);
                        setWithUrl(self, self._anvil.urlHandle.getUrl());
                    }
                },
            };
            self._anvil.dataBindingProp = "source";

            PyDefUtils.setupDefaultMouseEvents(self);

        }, pyModule, $loc, properties, events, pyModule["Component"]);

    }, /*!defClass(anvil,Image,Component)!*/ 'Image', [pyModule["Component"]]);
};

/*
 * TO TEST:
 *
 *  - Prop groups: layout, height, align, appearance
 *  - New props: source
 *  - Override props: align, height, background, foreground
 *  - Event groups: universal
 *
 */
