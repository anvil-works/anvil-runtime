"use strict";

var PyDefUtils = require("PyDefUtils");

/**
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

module.exports = function(pyModule) {

	pyModule["FileLoader"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var properties = PyDefUtils.assembleGroupProperties(/*!componentProps(FileLoader)!1*/["layout", "text", "appearance", "icon", "interaction", "user data", "tooltip"], {
          text: {
            set: function(s,e,v) {
              e.toggleClass("has-text", v ? true : false);
              e.find(".label-text").text(v);
            },
            defaultValue: "Upload"
          },
          align: {
            defaultValue: "center"
          },
          icon: {
            defaultValue: new Sk.builtin.str("fa:upload")
          },
          bold: {
            set: function(s,e,v) {
              // ew
              e.find("label").css("font-weight", v ? "bold" : "");
            }
          },
          font_size: {
            set: function(s,e,v) {
              e.find("label").css("font-size", v);
            }
          },
          border: {
            set: function(s,e,v) {
              e.find("label").css("border", v);
            }
          },
          background: {
              set: function(s,e,v) {
                  let m = (""+v).match(/^theme:(.*)$/);
                  if (m) {
                      v = s._anvil.themeColors[m[1]] || '';
                  }
                  e.find("label").css("background-color", v);
              }
          },
          foreground: {
              set: function(s,e,v) {
                  let m = (""+v).match(/^theme:(.*)$/);
                  if (m) {
                      v = s._anvil.themeColors[m[1]] || '';
                  }
                  e.find("label").css("color", v);
              }
          },
          enabled: {
              set: function(s,e,v) {
                  e.find(".to-disable").prop("disabled", !v);
                  e.toggleClass("anvil-disabled", !v);
              }
          }
        });

        let updateStateText = self => {
            if (self._anvil.files && self._anvil.files.v.length > 0 && self._anvil.element.hasClass("show-state-message")) {
                self._anvil.element.find(".label-text").text(self._anvil.files.v.length + " file" + (self._anvil.files.v.length == 1 ? "" : "s") + " selected");
            } else {
                self._anvil.element.find(".label-text").text(self._anvil.getPropJS("text"));
            }
        }

        properties.push(/*!componentProp(FileLoader)!1*/{
            name: "multiple",
            type: "boolean",
            defaultValue: false,
            description: "If True, this FileLoader can load multiple files at the same time",
            set: function(s,e,v) {
                if (v) {
                    e.find("input").prop("multiple", "multiple");
                } else {
                    e.find("input").prop("multiple", false);
                }
            }
        });

        properties.push(/*!componentProp(FileLoader)!1*/{
            name: "show_state",
            type: "boolean",
            defaultValue: true,
            description: "If True, display a message describing selected files.",
            set: function(s,e,v) {
                if (v) {
                    e.addClass("show-state-message");
                } else {
                    e.removeClass("show-state-message");
                }
                updateStateText(s);
            }
        });

        properties.push(/*!componentProp(FileLoader)!1*/{
            name: "file",
            type: "object",
            pyType: "anvil.Media instance",
            suggested: true,
            pyVal: true,
            readOnly: true,
            description: "The currently selected file (or the first, if multiple files are selected). This is a Media object.",
            get: function(s,e) {
                return s._anvil.firstFile || Sk.builtin.none.none$;
            }
        });

        properties.push(/*!componentProp(FileLoader)!1*/{
            name: "files",
            type: "object",
            pyType: "list(anvil.Media instance)",
            pyVal: true,
            readOnly: true,
            allowBindingWriteback: true,
            description: "A list of currently selected files. Each file is a Media object.",
            get: function(s,e) {
                return s._anvil.files || new Sk.builtin.list();
            }
        });

        properties.push(/*!componentProp(FileLoader)!1*/{
            name: "file_types",
            type: "string",
            description: "Specify what type of file to upload. Can accept a MIME type (eg \"image/png\" or \"image/*\"), or an extension (eg \".png\"), or a comma-separated set of them (eg \".png,.jpg,.jpeg\")",
            exampleValue: "image/*",
            set: function(s,e,v) {
                e.find("input").attr('accept', v ? v : null);
            }
        });

        var events = PyDefUtils.assembleGroupEvents("FileLoader", /*!componentEvents(FileLoader)!1*/ ["universal", "focus"]);
        events.push(/*!componentEvent(FileLoader)!1*/ {
            name: "change", description: "When a new file is loaded into this FileLoader",
            parameters: [{
                name: "file",
                pyType: "anvil.Media instance",
                pyVal: true,
                description: "The first selected file. Set the 'multiple' property to allow loading more than one file.",
                important: true,
            },{
                name: "files",
                pyType: "list(anvil.Media instance)",
                pyVal: true,
                description: "A list of loaded files. Set the 'multiple' property to allow loading more than one file.",
                important: false,
            }],
            important: true,
            defaultEvent: true,
        });

        let resetInputElement = self => {
          self._anvil.element.find("form").empty().append(
            $('<input type="file" class="file-upload to-disable" style="display: none">')
              .prop("multiple", (self._anvil && self._anvil.getPropJS && self._anvil.getPropJS("multiple")) ? "multiple" : false)
              .prop("disabled", !(self._anvil && self._anvil.getPropJS && self._anvil.getPropJS("enabled")))
              .on("change", function(e) {
                  var fileObjs = self._anvil.element.find("input[type=file]")[0].files;

                  var files = [];
                  for (var i = 0; i < fileObjs.length; i++) {
                      files.push(Sk.misceval.callsim(pyModule["FileMedia"], fileObjs[i]));
                  }

                  self._anvil.files = new Sk.builtin.list(files);
                  self._anvil.firstFile = (files.length == 0) ? Sk.builtin.none.none$ : files[0];

                  updateStateText(self);

                  PyDefUtils.raiseEventAsync({files: self._anvil.files, file: self._anvil.firstFile}, self, "change");
              }).on("focus", function(e) {
                  PyDefUtils.raiseEventAsync({}, self, "focus");
              }).on("blur", function(e) {
                  PyDefUtils.raiseEventAsync({}, self, "lost_focus");
              })
          );
          if (self._anvil && self._anvil.getPropJS) {
            self._anvil.element.toggleClass("anvil-disabled", !(self._anvil && self._anvil.getPropJS && self._anvil.getPropJS("enabled")));
          }
        }

		    $loc["__init__"] = PyDefUtils.mkInit(function init(self) {
            self._anvil.element = $('<a class="file-loader" href="javascript:void(0)"><label anvil-inlinable"><i class="anvil-component-icon fa left"></i><span class="label-text"></span><i class="anvil-component-icon fa right"></i>' +
                    '<form class="file-upload"></form></label></a>');

            resetInputElement(self);

            self._anvil.dataBindingProp = "text";
        }, pyModule, $loc, properties, events, pyModule["Component"]);


        /*!defMethod(_)!2*/ "Set the keyboard focus to this FileLoader"
        $loc["focus"] = new Sk.builtin.func(function(self) {
            self._anvil.element.trigger("focus");
            return Sk.builtin.none.none$;
        });

        /*!defMethod(_)!2*/ "Clear any selected files from this FileLoader"
        $loc["clear"] = new Sk.builtin.func(function(self) {
            resetInputElement(self);
            self._anvil.element.find(".label-text").text(self._anvil.getPropJS("text"));
            
            self._anvil.files = new Sk.builtin.list();
            self._anvil.firstFile = Sk.builtin.none.none$;

            return Sk.builtin.none.none$;
        })


    }, /*!defClass(anvil,FileLoader,Component)!*/ 'FileLoader', [pyModule["Component"]]);
};

/*
 * TO TEST:
 *
 *  - Prop groups: layout
 *  - New props: multiple, file, files
 *  - Event groups: universal
 *  - New events: change
 *
 */
