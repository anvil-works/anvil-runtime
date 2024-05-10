/*#
id: image_module
docs_url: /docs/working-with-files/media/image-manipulation
title: Image Module
description: |
  ```python
  import anvil.image

  # Load an image from a FileLoader 
  # or Google Drive here

  img = ...

  # Get its size
  width, height = anvil.image.get_dimensions(img)

  # Resize the image to have a maximum dimension of 640px.

  small_img = anvil.image.generate_thumbnail(img, 640)
  ```

  The Image module allows you to manipulate images in your Anvil app. Begin by importing the `anvil.image` module.


  To generate a thumbnail of an image (for uploading, for example) use the `generate_thumbnail` method.

  ```python
  # Rotate the image by 30 degrees.

  rotated_image = anvil.image.rotate(img, 30)
  ```

  To rotate an image clockwise by some number of degrees, use the `rotate` method.
*/

const { anvilMod } = require("@runtime/runner/py-util");


// TODO: Make use of media._anvilCachedImage, as used in Canvas drawImage
module.exports = function() {

    var pyMod = {"__name__": new Sk.builtin.str("image")};
	var PyDefUtils = require("PyDefUtils");

    function dataURItoBlob(dataURI) {
        // convert base64 to raw binary data held in a string
        // doesn't handle URLEncoded DataURIs - see SO answer #6850276 for code that does this
        var byteString = atob(dataURI.split(',')[1]);

        // separate out the mime component
        var mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];

        // write the bytes of the string to an ArrayBuffer
        var ab = new ArrayBuffer(byteString.length);
        var ia = new Uint8Array(ab);
        for (var i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
        }

        return new Blob([ab], {type : 'image/jpeg'});
    }

    /*!defClass(anvil.image,ImageException)!*/
    pyMod["ImageException"] = Sk.misceval.buildClass(pyMod, function($gbl, $loc) {
        $loc["__init__"] = new Sk.builtin.func(function init(self, pyMsg) {
            self.traceback = []
            self.args = new Sk.builtin.list([pyMsg || Sk.ffi.remapToPy("Error loading image")]);
            return Sk.builtin.none.none$;
        });
    }, "ImageException", [Sk.builtin.Exception]);


    /*!defFunction(anvil.image,_,image_media)!2*/ "Get the dimensions of an image (width, height).\n\nPass in an anvil.Media object representing the image."
    pyMod["get_dimensions"] = new Sk.builtin.func(function(pyImg) {
        var blobUriToRevoke = null;
        var freeBlob = function() {
            if (blobUriToRevoke)
                window.URL.revokeObjectURL(blobUriToRevoke);
            blobUriToRevoke = null;
        };

        return Sk.misceval.chain(
            Sk.misceval.callsimOrSuspend(pyImg.tp$getattr(new Sk.builtin.str("get_url"))),
            function(pyUrl) {
                if (pyUrl instanceof Sk.builtin.str) {
                    return pyUrl.v;
                } else {
                    var contentType;

                    // No. Ick. We pull the content out as a binary JS string, then turn it right back
                    // into a Blob. There has *got* to be a nicer way to do this.

                    var blob = (pyImg._data instanceof Blob) ? pyImg._data : Sk.misceval.chain(
                        Sk.abstr.gattr(pyImg, new Sk.builtin.str("content_type"), true),
                        function (ct) {
                            contentType = ct;
                            return Sk.misceval.callsimOrSuspend(Sk.abstr.gattr(pyImg, new Sk.builtin.str("get_bytes")));
                        },
                        function (c) {
                            const bytes = PyDefUtils.getUint8ArrayFromPyBytes(c);
                            return new Blob([bytes], {type: contentType.v});
                        }
                    );
                    return Sk.misceval.chain(blob, function(blob) {
                        blobUriToRevoke = window.URL.createObjectURL(blob);
                        return blobUriToRevoke;
                    });
                }
            },
            function (jsUrl) {
                return PyDefUtils.suspensionPromise(function(resolve, reject) {
                    var img = new Image();
                    img.onerror = function() {
                        freeBlob();
                        reject(Sk.misceval.callsim(pyMod["ImageException"], Sk.builtin.str("Failed to load URL")));
                    };
                    img.onload = function() {
                        var r = new Sk.builtin.tuple([Sk.ffi.remapToPy(img.width), Sk.ffi.remapToPy(img.height)]);
                        freeBlob();
                        resolve(r);
                    };
                    img.src = jsUrl;
                });
            }
        );

    });

    /*!defFunction(anvil.image,anvil.Media instance,image_media,max_size)!2*/ "Resize the supplied image so that neither width nor height exceeds max_size (in pixels).\n\nPass in an anvil.Media object representing the image."
    pyMod["generate_thumbnail"] = new Sk.builtin.func(function(pyImg, pyMaxSize) {

        return PyDefUtils.suspensionPromise(function(resolve, reject) {

            var urlHandle;

            PyDefUtils.asyncToPromise(function() {
                return PyDefUtils.getUrlForMedia(pyImg);
            }).then(function(h) {
                urlHandle = h;

                var url = urlHandle.getUrl();

                var maxSize = Sk.ffi.remapToJs(pyMaxSize);

                var jqImg = $("<img>"), img = jqImg[0];

                img.onload = function() {
                    var w = img.naturalWidth;
                    var h = img.naturalHeight;
                    let scale;
                    if (w >= h) {
                        scale = maxSize / w;
                    } else {
                        scale = maxSize / h;
                    }
                    if (scale >= 1) {
                        resolve(pyImg);
                        return;
                    }
                    scale = Math.min(scale, 1);

                    var newW = scale*w;
                    var newH = scale*h;

                    var canvas = $("<canvas>").attr("width",newW).attr("height",newH)[0];
                    var ctx = canvas.getContext("2d");

                    ctx.drawImage(img, 0,0,newW, newH);


                    try {
                        var small = canvas.toDataURL("image/jpeg", 0.8);
                    } catch (e) {
                        if (e.name == "SecurityError") {
                            reject(
                                new Sk.builtin.RuntimeError("Cannot rotate image from untrusted cross-origin source.")
                            );
                            return;
                        } else {
                            throw e;
                        }
                    }

                    var blob = dataURItoBlob(small);


                    var PyBlobMedia = anvilMod["BlobMedia"];

                    resolve(PyDefUtils.callAsync(PyBlobMedia, undefined, undefined, undefined, blob));
                }

                jqImg.attr("src", url);

            }).catch(reject).finally(function() {
                if (urlHandle) {
                    urlHandle.release();
                }
            });
        });
    })

    /*!defFunction(anvil.image,anvil.Media instance,image_media,angle)!2*/ "Rotate the supplied image clockwise by the given number of degrees.\n\nPass in an anvil.Media object representing the image."
    pyMod["rotate"] = new Sk.builtin.func(function(pyImg, pyAngle) {

        return Sk.misceval.chain(Sk.misceval.callsimOrSuspend(pyImg.tp$getattr(new Sk.builtin.str("get_content_type"))),
            pyContentType => PyDefUtils.suspensionPromise(function(resolve, reject) {
                var urlHandle;

                PyDefUtils.asyncToPromise(function() {
                    return PyDefUtils.getUrlForMedia(pyImg);
                }).then(function(h) {
                    urlHandle = h;
                    var url = urlHandle.getUrl();

                    var angle = (Sk.ffi.remapToJs(pyAngle) / 180) * Math.PI;

                    var jqImg = $("<img>"), img = jqImg[0];

                    img.onload = function() {
                        var w = img.naturalWidth;
                        var h = img.naturalHeight;

                        var w1 = Math.abs(h * Math.sin(angle));
                        var w2 = Math.abs(w * Math.cos(angle));
                        var h1 = Math.abs(w * Math.sin(angle));
                        var h2 = Math.abs(h * Math.cos(angle));

                        var newWidth = w1+w2;
                        var newHeight = h1+h2;

                        var canvas = $("<canvas>").attr("width",newWidth).attr("height",newHeight)[0];
                        var ctx = canvas.getContext("2d");

                        ctx.translate(newWidth/2, newHeight/2);
                        ctx.rotate(angle);
                        ctx.translate(-w/2, -h/2);
                        ctx.drawImage(img, 0, 0, w, h);

                        try {
                            var newImgDataURL = canvas.toDataURL(Sk.ffi.remapToJs(pyContentType));                            
                        } catch (e) {
                            if (e.name == "SecurityError") {
                                reject(new Sk.builtin.RuntimeError("Cannot rotate image from untrusted cross-origin source."));
                                return;
                            } else {
                                throw e;
                            }
                        }

                        var blob = dataURItoBlob(newImgDataURL);

                        var PyBlobMedia = anvilMod["BlobMedia"];

                        resolve(PyDefUtils.callAsync(PyBlobMedia, undefined, undefined, undefined, blob));
                    }

                    jqImg.attr("src", url);

                }).catch(reject).finally(function() {
                    if (urlHandle) {
                        urlHandle.release();
                    }
                });
            })
        );
    })

    return pyMod;
}

/*
 * TO TEST:
 * 
 *  - Methods: generate_thumbnail
 *
 */