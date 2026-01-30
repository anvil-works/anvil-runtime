import { PyModMap } from "@runtime/runner/py-util";
import {
    chainOrSuspend,
    checkNone,
    checkString,
    isTrue,
    pyCall,
    pyIsInstance,
    pyNone,
    pyStr,
    pyType,
    pyTypeError,
} from "@Sk";
import PyDefUtils from "PyDefUtils";
import { ClassicComponent, ClassicComponentConstructor } from "./ClassicComponent";

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

interface ImageAnvil {
    elements: { root: HTMLDivElement; img: HTMLImageElement };
    isSelfSizing: boolean;
    height: string;
    pyMedia: any;
    urlString: string | null;
    urlHandle: any;
    pageEvents: {
        remove: () => void;
        add: () => void;
    };
}

interface Image extends ClassicComponent<ImageAnvil> {}

const ImageFactory = (pyModule: PyModMap) => {
    const ClassicComponent = pyModule["ClassicComponent"] as ClassicComponentConstructor;

    pyModule["Image"] = PyDefUtils.mkComponentCls<Image>(pyModule, "Image", {
        base: ClassicComponent,
        properties: PyDefUtils.assembleGroupProperties<Image>(
            /*!componentProps(Image)!1*/ ["layout", "layout_margin", "height", "appearance", "tooltip", "user data"],
            {
                height: {
                    defaultValue: new pyStr("200"),
                    pyVal: true,
                    set(s, e, v) {
                        const height = v.toString();
                        e.style.height = s._anvil.isSelfSizing ? "" : PyDefUtils.cssLength(height);
                        s._anvil.height = height;
                    },
                    description: "The height of the image (ignored in fill_width and original_size display modes)",
                },
                foreground: {
                    hidden: true,
                },

                alt_text: /*!componentProp(Image)!1*/ {
                    name: "alt_text",
                    type: "string",
                    defaultValue: pyStr.$empty,
                    pyVal: true,
                    description:
                        "Textual replacement for the image used by screen readers and displayed on the page if the image can't be loaded",
                    set(self, element, pyV) {
                        const v = checkNone(pyV) ? "" : pyV.toString();
                        self._anvil.elements.img.setAttribute("alt", v);
                    },
                },

                display_mode: /*!componentProp(Image)!1*/ {
                    name: "display_mode",
                    type: "enum",
                    priority: 2,
                    important: true,
                    defaultValue: new pyStr("shrink_to_fit"),
                    pyVal: true,
                    options: ["shrink_to_fit", "zoom_to_fill", "fill_width", "original_size"],
                    initialize: true,
                    description:
                        "Determines how the image's size should be adjusted to fit the size of this Image component.\n\n - `shrink_to_fit` scales the image to fit while maintaining its aspect ratio.\n- `zoom_to_fill` scales the image to fill the entire container while maintaining its aspect ratio. If the image is too large, it will be cropped to fit.\n- `fill_width` shrinks or grows the image so the width fits the container.\n- `original_size` - displays the image at whatever the browser thinks the original size is. If that would cause the image to be wider than the Image component, it shrinks the image to ensure it fits within the width of the Image component.",
                    set(self, element, pyV) {
                        const v = pyV.toString();
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
                    defaultValue: new pyStr("center"),
                    pyVal: true,
                    set(s, e, pyV) {
                        s._anvil.setProp("horizontal_align", pyV);
                    },
                },
                border_radius: /*!componentProp(Image)!1*/ {
                    name: "border_radius",
                    type: "string",
                    description: "The border radius of this component",
                    group: "Appearance",
                    defaultValue: pyStr.$empty,
                    pyVal: true,
                    exampleValue: "5px",
                    set(s, e, pyV) {
                        const v = checkNone(pyV) ? "" : PyDefUtils.cssLength(pyV.toString());
                        e.style.borderRadius = v;
                    },
                },

                horizontal_align: /*!componentProp(Image)!1*/ {
                    name: "horizontal_align",
                    priority: 3,
                    group: "Image Display",
                    type: "enum",
                    options: ["left", "center", "right"],
                    description: "Position the image horizontally within this component",
                    defaultValue: new pyStr("center"),
                    pyVal: true,
                    important: true,
                    set(s, e, pyV) {
                        const v = pyV.toString();
                        e.style.textAlign = v;
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
                    defaultValue: new pyStr("center"),
                    pyVal: true,
                    options: ["top", "center", "bottom"],
                    description: "Position the image vertically within this component",
                    set(self, element, pyV) {
                        if (self._anvil.onPage) {
                            self._anvil.pageEvents.add();
                        }
                    },
                },

                source: /*!componentProp(Image)!1*/ {
                    name: "source",
                    priority: 1,
                    designerHint: "asset-upload",
                    important: true,
                    suggested: true,
                    type: "uri",
                    accept: "image/*",
                    description: "The image source - set a string for a URL or a Media object in code",
                    pyVal: true,
                    defaultValue: new pyStr(""),
                    exampleValue: new pyStr("http://mysite.com/logo.png"),
                    initialize: true,
                    dataBindingProp: true,
                    get(s, e) {
                        return s._anvil.pyMedia || pyNone;
                    },
                    getJS(s, e) {
                        return s._anvil.urlString || "";
                    },
                    set(self, e, pyV) {
                        if (self._anvil.urlHandle) {
                            self._anvil.urlHandle.release();
                            self._anvil.urlHandle = null;
                        }
                        self._anvil.urlString = null;

                        if (checkNone(pyV)) {
                            self._anvil.pyMedia = pyV;
                        } else if (checkString(pyV)) {
                            const jsStr = pyV.toString();
                            self._anvil.urlString = jsStr;
                            setWithUrl(self, jsStr);
                            self._anvil.pyMedia = pyCall(pyModule["URLMedia"], [pyV]);
                        } else if (isTrue(pyIsInstance(pyV, pyModule["Media"] as pyType))) {
                            self._anvil.pyMedia = pyV;
                        } else {
                            throw new pyTypeError("The 'source' property can only be set to a Media object or a URL");
                        }

                        return chainOrSuspend(PyDefUtils.getUrlForMedia(self._anvil.pyMedia), (h) => {
                            self._anvil.urlHandle = h;
                            if (self._anvil.onPage) {
                                self._anvil.pageEvents.add();
                            }
                        });
                    },
                },
            }
        ),

        events: PyDefUtils.assembleGroupEvents(/*!componentEvents()!2*/ "Image", ["universal", "mouse"]),

        element({ height, display_mode, horizontal_align, align, alt_text, ...props }) {
            display_mode = display_mode.toString();
            height =
                display_mode === "original_size" || display_mode === "fill_width"
                    ? ""
                    : "height: " + PyDefUtils.cssLength(height.toString()) + ";";
            horizontal_align = horizontal_align.toString();

            // use the tooltip if alt not set
            const alt = alt_text.toString() || props.tooltip.toString();

            return (
                <PyDefUtils.OuterElement
                    className="anvil-image"
                    style={`min-height:20px;text-align:${horizontal_align};${height};overflow:hidden;overflow:clip`}
                    {...props}>
                    <img refName="img" alt={alt} style="max-width:100%;max-height:100%;" />
                </PyDefUtils.OuterElement>
            );
        },

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew<Image>(ClassicComponent, (self) => {
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

    function setWithUrl(self: Image, jsU: string | null) {
        const e = self._anvil.domNode;
        const img = self._anvil.elements.img;
        const imgStyle = img.style;
        const height = self._anvil.height;
        if (jsU) {
            imgStyle.display = "";
            img.setAttribute("src", jsU);
            const displayMode = self._anvil.getProp("display_mode").toString();
            const objectPosition =
                self._anvil.getProp("horizontal_align") + " " + self._anvil.getProp("vertical_align");
            switch (displayMode) {
                case "shrink_to_fit":
                    Object.assign(imgStyle, { width: "100%", height: "100%", objectFit: "contain", objectPosition });
                    break;
                case "zoom_to_fill":
                    Object.assign(imgStyle, { width: "100%", height: "100%", objectFit: "cover", objectPosition });
                    break;
                case "fill_width":
                    Object.assign(imgStyle, { width: "100%", height: "", objectFit: "", objectPosition: "" });
                    break;
                case "original_size":
                default:
                    Object.assign(imgStyle, { width: "", height: "", objectFit: "", objectPosition: "" });
                    break;
            }
            if (typeof height === "string") {
                // height might not have been initialized yet
                e.style.height = self._anvil.isSelfSizing ? "" : PyDefUtils.cssLength(height);
            }
            e.classList.remove("anvil-image-empty");
        } else {
            imgStyle.display = "none";
            e.classList.add("anvil-image-empty");
        }
    }
};

export default ImageFactory;

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
