"use strict";

const { getCssPrefix } = require("@runtime/runner/legacy-features");
var PyDefUtils = require("PyDefUtils");
const { setElementMargin, setElementPadding, getUnsetSpacing } = require("@runtime/runner/components-in-js/public-api/property-utils");

/*#
id: fileloader
docs_url: /docs/client/components/basic#fileloader
title: FileLoader
tooltip: Learn more about FileLoader
description: |
  ```python
  c = FileLoader()
  ```

  A FileLoader allows you to load files from your computer or mobile device into an Anvil app.

  ```python
  if c.file != None:
      self.my_image.source = c.file
  ```

  The currently selected file in a file loader can be accessed from the `file` attribute. It is
  a [Media object](#media), so you can use it to draw images, upload it to Google Drive, and so on.

  The `files` attribute gives a list of files. If the `multiple` property is set, then multiple
  files may be loaded; otherwise this list will always either be empty or contain one element.

  ```python
  upload_folder = anvil.google.drive.app_files.uploads
  for f in c.files:
      small_img = anvil.image.generate_thumbnail(f, 640)
      uploaded = upload_folder.create_file(f.name)
      uploaded.set_media(small_img)
  ```

  This example uses the [Google Drive](#google_drive) API to upload images to an app folder.
  Before upload, they are resized using the [Image module](#image_module). For other things
  you can do with uploaded files, see the [Media object documentation](#media).


  ```python
  c.clear()
  ```
  To reset the file-loader and make it ready to receive more files, call its `clear()` method.
*/

module.exports = (pyModule) => {
    const { isTrue } = Sk.misceval;

    pyModule["FileLoader"] = PyDefUtils.mkComponentCls(pyModule, "FileLoader", {
        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(FileLoader)!1*/ ["layout", "layout_spacing", "text", "appearance", "icon", "interaction", "user data", "tooltip"], {
            text: {
                dataBindingProp: true,
                defaultValue: new Sk.builtin.str("Upload"),
                group: undefined,
                inlineEditElement: "text",
            },
            align: {
                defaultValue: new Sk.builtin.str("center"),
            },
            icon: {
                defaultValue: new Sk.builtin.str("fa:upload"),
                group: undefined,
            },
            bold: {
                set(s, e, v) {
                    s._anvil.elements.label.style.fontWeight = isTrue(v) ? "bold" : "";
                    // ew
                },
            },
            font_size: {
                set(s, e, v) {
                    v = Sk.ffi.remapToJs(v);
                    s._anvil.elements.label.style.fontSize = typeof v === "number" ? v + "px" : "";
                },
            },
            border: {
                set(s, e, v) {
                    s._anvil.elements.label.style.border = isTrue(v) ? v.toString() : "";
                },
            },
            background: {
                set(s, e, v) {
                    s._anvil.elements.label.style.backgroundColor = PyDefUtils.getColor(v);
                },
            },
            underline: {
                set(s, e, v) {
                    s._anvil.elements.label.style.textDecoration = isTrue(v) ? "underline" : "";
                },
            },
            foreground: {
                set(s, e, v) {
                    s._anvil.elements.label.style.color = PyDefUtils.getColor(v);
                },
            },
            enabled: {
                set(s, e, v) {
                    v = !isTrue(v);
                    s._anvil.elements.input.disabled = v;
                    e.toggleClass("anvil-disabled", v);
                },
            },
            multiple: /*!componentProp(FileLoader)!1*/ {
                name: "multiple",
                type: "boolean",
                defaultValue: Sk.builtin.bool.false$,
                pyVal: true,
                description: "If True, this FileLoader can load multiple files at the same time",
                set(s, e, v) {
                    s._anvil.elements.input.multiple = isTrue(v);
                },
            },
            show_state: /*!componentProp(FileLoader)!1*/ {
                name: "show_state",
                type: "boolean",
                defaultValue: Sk.builtin.bool.true$,
                pyVal: true,
                description: "If True, display a message describing selected files.",
                set(s, e, v) {
                    if (isTrue(v)) {
                        updateStateText(s);
                    } else {
                        s._anvil.setProp("text", s._anvil.props["text"]);
                    }
                },
            },
            file: /*!componentProp(FileLoader)!1*/ {
                name: "file",
                type: "object",
                pyType: "anvil.Media instance",
                suggested: true,
                pyVal: true,
                readOnly: true,
                description: "The currently selected file (or the first, if multiple files are selected). This is a Media object.",
                get(s, e) {
                    return s._anvil.firstFile;
                },
            },
            files: /*!componentProp(FileLoader)!1*/ {
                name: "files",
                type: "object",
                pyType: "list(anvil.Media instance)",
                pyVal: true,
                readOnly: true,
                allowBindingWriteback: true,
                description: "A list of currently selected files. Each file is a Media object.",
                get(s, e) {
                    return s._anvil.files;
                },
            },
            file_types: /*!componentProp(FileLoader)!1*/ {
                name: "file_types",
                type: "string",
                description:
                    'Specify what type of file to upload. Can accept a MIME type (eg "image/png" or "image/*"), or an extension (eg ".png"), or a comma-separated set of them (eg ".png,.jpg,.jpeg")',
                exampleValue: "image/*",
                pyVal: true,
                defaultValue: Sk.builtin.none.none$,
                set(s, e, v) {
                    s._anvil.elements.input.accept = isTrue(v) ? Sk.ffi.remapToJs(v) : "";
                },
            },
            spacing: {
                set(s, e, v) {
                    setElementMargin(e[0], v?.margin);
                    setElementPadding(s._anvil.elements.label, v?.padding);
                },
                getUnset(s, e, currentValue) {
                    return getUnsetSpacing(e[0], s._anvil.elements.label, currentValue);
                }
            },
        }),

        events: PyDefUtils.assembleGroupEvents("FileLoader", /*!componentEvents(FileLoader)!1*/ ["universal", "focus"], {
            change: /*!componentEvent(FileLoader)!1*/ {
                name: "change",
                description: "When a new file is loaded into this FileLoader",
                parameters: [
                    {
                        name: "file",
                        pyType: "anvil.Media instance",
                        pyVal: true,
                        description: "The first selected file. Set the 'multiple' property to allow loading more than one file.",
                        important: true,
                    },
                    {
                        name: "files",
                        pyType: "list(anvil.Media instance)",
                        pyVal: true,
                        description: "A list of loaded files. Set the 'multiple' property to allow loading more than one file.",
                        important: false,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
        }),

        element({ bold, font_size, border, background, foreground, multiple, enabled, file_types, underline, ...props }) {
            const prefix = getCssPrefix();
            const outerStyle = PyDefUtils.getOuterStyle(props, false);
            const outerClass = PyDefUtils.getOuterClass(props) + (isTrue(enabled) ? "" : " anvil-disabled");
            const outerAttrs = PyDefUtils.getOuterAttrs(props);
            const labelStyle = PyDefUtils.getOuterStyle({ bold, font_size, border, background, foreground, underline });
            const labelPaddingStyle = PyDefUtils.getPaddingStyle({spacing: props.spacing});
            const { icon, icon_align } = props;
            const inputAttrs = {};
            if (isTrue(multiple)) {
                inputAttrs.multiple = true;
            }
            if (!isTrue(enabled)) {
                inputAttrs.disabled = "";
            }
            file_types = isTrue(file_types) ? file_types.toString() : ""
            return (
                <a refName="outer" className={`${prefix}file-loader ${outerClass}`} href="javascript:void(0)" style={outerStyle} {...outerAttrs}>
                    <label refName="label" className="anvil-inlinable" style={labelStyle + labelPaddingStyle}>
                        <PyDefUtils.IconComponent side="left" icon={icon} icon_align={icon_align} />
                        <span refName="text" className={`${prefix}label-text`}>
                            {Sk.builtin.checkNone(props.text) ? "" : props.text.toString()}
                        </span>
                        <PyDefUtils.IconComponent side="right" icon={icon} icon_align={icon_align} />
                        <form refName="fileUpload" className={`${prefix}file-upload`}>
                            <input refName="input" type="file" className={`${prefix}file-upload ${prefix}to-disable`} style="display: none" accept={file_types} {...inputAttrs} />
                        </form>
                    </label>
                </a>
            );
        },

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["ClassicComponent"], (self) => {
                self._anvil.files = new Sk.builtin.list([]);
                self._anvil.firstFile = Sk.builtin.none.none$;

                $(self._anvil.elements.input)
                    .on("change", (e) => {
                        const fileObj = self._anvil.elements.input.files;
                        const files = [];
                        for (let i = 0; i < fileObj.length; i++) {
                            files.push(PyDefUtils.pyCall(pyModule["FileMedia"], [fileObj[i]]));
                        }
                        self._anvil.files = new Sk.builtin.list(files);
                        self._anvil.firstFile = files.length === 0 ? Sk.builtin.none.none$ : files[0];
                        if (isTrue(self._anvil.getProp("show_state"))) {
                            updateStateText(self);
                        }
                        PyDefUtils.raiseEventAsync({ files: self._anvil.files, file: self._anvil.firstFile }, self, "change");
                    })
                    // todo this doesn't work
                    .on("focus", (e) => PyDefUtils.raiseEventAsync({}, self, "focus"))
                    .on("blur", (e) => PyDefUtils.raiseEventAsync({}, self, "lost_focus"));

                if (ANVIL_IN_DESIGNER) {
                    Object.defineProperty(self._anvil, "inlineEditing", {
                        set(v) {
                            // see CheckBox.js
                            self._anvil.elements.input.type = v ? "hidden" : "checkbox";
                        }
                    });
                }
            });

            /*!defMethod(_)!2*/ "Open the file selector from code, this should be called within a click event handler for another component";
            $loc["open_file_selector"] = new Sk.builtin.func((self) => {
                self._anvil.elements.input.click();
                return Sk.builtin.none.none$;
            });


            /*!defMethod(_)!2*/ "Set the keyboard focus to this FileLoader"
            $loc["focus"] = new Sk.builtin.func(function focus(self) {
                // todo this doesn't work
                self._anvil.element.trigger("focus");
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_)!2*/ "Clear any selected files from this FileLoader"
            $loc["clear"] = new Sk.builtin.func(function clear(self) {
                // todo is this IE compatible?
                $(self._anvil.elements.input).val("");
                self._anvil.files = new Sk.builtin.list();
                self._anvil.firstFile = Sk.builtin.none.none$;
                if (isTrue(self._anvil.getProp("show_state"))) {
                    updateStateText(self);
                }
                return Sk.builtin.none.none$;
            });
        },
    });


    function updateStateText(self) {
        const numFiles = self._anvil.elements.input.files.length;
        if (numFiles) {
            self._anvil.elements.text.textContent = numFiles + " file" + (numFiles === 1 ? "" : "s") + " selected";
        } else {
            self._anvil.setProp("text", self._anvil.props["text"]);
        }
    }

};

/*!defClass(anvil,FileLoader,Component)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout
 *  - New props: multiple, file, files
 *  - Event groups: universal
 *  - New events: change
 *
 */
