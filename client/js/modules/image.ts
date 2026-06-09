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
import {
    pyBytes,
    pyCall,
    pyCallOrSuspend,
    pyCallable,
    pyFloat,
    pyFunc,
    pyGetAttr,
    pyObject,
    pyStr,
    toJs,
    toPy,
} from "@Sk";
import PyDefUtils from "PyDefUtils";
import { PyModMap, anvilMod } from "@runtime/runner/py-util";

interface MediaUrlHandle {
    getUrl(): string;
    release(): void;
}

// TODO: Make use of media._anvilCachedImage, as used in Canvas drawImage
const image = () => {
    const pyMod: PyModMap = { __name__: new pyStr("image") };

    function dataURItoBlob(dataURI: string) {
        // convert base64 to raw binary data held in a string
        // doesn't handle URLEncoded DataURIs - see SO answer #6850276 for code that does this
        const byteString = atob(dataURI.split(",")[1]);

        // separate out the mime component
        const mimeString = dataURI.split(",")[0].split(":")[1].split(";")[0];

        // write the bytes of the string to an ArrayBuffer
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
        }

        return new Blob([ab], { type: "image/jpeg" });
    }

    /*!defClass(anvil.image,ImageException)!*/
    pyMod["ImageException"] = Sk.misceval.buildClass(
        pyMod,
        function ($gbl, $loc) {
            $loc["__init__"] = new pyFunc(function init(self: pyObject, pyMsg: pyObject | undefined) {
                self.traceback = [];
                self.args = new Sk.builtin.list([pyMsg || toPy("Error loading image")]);
                return Sk.builtin.none.none$;
            });
        },
        "ImageException",
        [Sk.builtin.Exception]
    );

    /*!defFunction(anvil.image,_,image_media)!2*/ ("Get the dimensions of an image (width, height).\n\nPass in an anvil.Media object representing the image.");
    pyMod["get_dimensions"] = new pyFunc(function (pyImg: pyObject) {
        let blobUriToRevoke: string | null = null;
        const freeBlob = function () {
            if (blobUriToRevoke) window.URL.revokeObjectURL(blobUriToRevoke);
            blobUriToRevoke = null;
        };

        return Sk.misceval.chain(
            pyCallOrSuspend(pyGetAttr<pyCallable<pyStr>>(pyImg, new pyStr("get_url"))),
            function (pyUrl) {
                if (pyUrl instanceof pyStr) {
                    return pyUrl.v;
                } else {
                    let contentType: pyStr;

                    // No. Ick. We pull the content out as a binary JS string, then turn it right back
                    // into a Blob. There has *got* to be a nicer way to do this.

                    const blob =
                        pyImg._data instanceof Blob
                            ? pyImg._data
                            : Sk.misceval.chain(
                                  Sk.abstr.gattr(pyImg, new pyStr("content_type"), true),
                                  function (ct: pyStr) {
                                      contentType = ct;
                                      return pyCallOrSuspend(
                                          pyGetAttr<pyCallable<pyBytes | pyStr>>(pyImg, new pyStr("get_bytes"))
                                      );
                                  },
                                  function (c) {
                                      const bytes = PyDefUtils.getUint8ArrayFromPyBytes(c);
                                      return new Blob([bytes], { type: contentType.v });
                                  }
                              );
                    return Sk.misceval.chain(blob, function (blob) {
                        blobUriToRevoke = window.URL.createObjectURL(blob);
                        return blobUriToRevoke;
                    });
                }
            },
            function (jsUrl) {
                return PyDefUtils.suspensionPromise(function (resolve, reject) {
                    const img = new Image();
                    img.onerror = function () {
                        freeBlob();
                        reject(pyCall(pyMod["ImageException"]!, [new pyStr("Failed to load URL")]));
                    };
                    img.onload = function () {
                        const r = new Sk.builtin.tuple([toPy(img.width), toPy(img.height)]);
                        freeBlob();
                        resolve(r);
                    };
                    img.src = jsUrl;
                });
            }
        );
    });

    /*!defFunction(anvil.image,anvil.Media instance,image_media,max_size)!2*/ ("Resize the supplied image so that neither width nor height exceeds max_size (in pixels).\n\nPass in an anvil.Media object representing the image.");
    pyMod["generate_thumbnail"] = new pyFunc(function (pyImg: pyObject, pyMaxSize: pyFloat) {
        return PyDefUtils.suspensionPromise(function (resolve, reject) {
            let urlHandle: MediaUrlHandle | undefined;

            PyDefUtils.asyncToPromise(function () {
                return PyDefUtils.getUrlForMedia(pyImg);
            })
                .then(function (h: MediaUrlHandle) {
                    urlHandle = h;

                    const url = urlHandle.getUrl();

                    const maxSize = toJs(pyMaxSize);

                    const jqImg = $("<img>"),
                        img = jqImg[0] as HTMLImageElement;

                    img.onload = function () {
                        const w = img.naturalWidth;
                        const h = img.naturalHeight;
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

                        const newW = scale * w;
                        const newH = scale * h;

                        const canvas = $("<canvas>").attr("width", newW).attr("height", newH)[0] as HTMLCanvasElement;
                        const ctx = canvas.getContext("2d");

                        ctx!.drawImage(img, 0, 0, newW, newH);

                        let small: string;

                        try {
                            small = canvas.toDataURL("image/jpeg", 0.8);
                        } catch (e) {
                            if ((e as { name: string }).name == "SecurityError") {
                                reject(
                                    new Sk.builtin.RuntimeError(
                                        "Cannot rotate image from untrusted cross-origin source."
                                    )
                                );
                                return;
                            } else {
                                throw e;
                            }
                        }

                        const blob = dataURItoBlob(small);

                        const PyBlobMedia = anvilMod["BlobMedia"];

                        resolve(
                            PyDefUtils.callAsync(
                                PyBlobMedia,
                                undefined,
                                undefined,
                                undefined,
                                blob as unknown as pyObject
                            )
                        );
                    };

                    jqImg.attr("src", url);
                })
                .catch(reject)
                .finally(function () {
                    if (urlHandle) {
                        urlHandle.release();
                    }
                });
        });
    });

    /*!defFunction(anvil.image,anvil.Media instance,image_media,angle)!2*/ ("Rotate the supplied image clockwise by the given number of degrees.\n\nPass in an anvil.Media object representing the image.");
    pyMod["rotate"] = new pyFunc(function (pyImg: pyObject, pyAngle: pyFloat) {
        return Sk.misceval.chain(
            pyCallOrSuspend(pyImg.tp$getattr(new pyStr("get_content_type"))),
            (pyContentType: pyStr) =>
                PyDefUtils.suspensionPromise(function (resolve, reject) {
                    let urlHandle: MediaUrlHandle | undefined;

                    PyDefUtils.asyncToPromise(function () {
                        return PyDefUtils.getUrlForMedia(pyImg);
                    })
                        .then(function (h: MediaUrlHandle) {
                            urlHandle = h;
                            const url = urlHandle.getUrl();

                            const angle = (toJs(pyAngle) / 180) * Math.PI;

                            const jqImg = $("<img>"),
                                img = jqImg[0] as HTMLImageElement;

                            img.onload = function () {
                                const w = img.naturalWidth;
                                const h = img.naturalHeight;

                                const w1 = Math.abs(h * Math.sin(angle));
                                const w2 = Math.abs(w * Math.cos(angle));
                                const h1 = Math.abs(w * Math.sin(angle));
                                const h2 = Math.abs(h * Math.cos(angle));

                                const newWidth = w1 + w2;
                                const newHeight = h1 + h2;

                                const canvas = $("<canvas>")
                                    .attr("width", newWidth)
                                    .attr("height", newHeight)[0] as HTMLCanvasElement;
                                const ctx = canvas.getContext("2d");

                                ctx!.translate(newWidth / 2, newHeight / 2);
                                ctx!.rotate(angle);
                                ctx!.translate(-w / 2, -h / 2);
                                ctx!.drawImage(img, 0, 0, w, h);

                                let newImgDataURL: string;
                                try {
                                    newImgDataURL = canvas.toDataURL(toJs(pyContentType));
                                } catch (e) {
                                    if ((e as { name: string }).name == "SecurityError") {
                                        reject(
                                            new Sk.builtin.RuntimeError(
                                                "Cannot rotate image from untrusted cross-origin source."
                                            )
                                        );
                                        return;
                                    } else {
                                        throw e;
                                    }
                                }

                                const blob = dataURItoBlob(newImgDataURL);

                                const PyBlobMedia = anvilMod["BlobMedia"];

                                resolve(
                                    PyDefUtils.callAsync(
                                        PyBlobMedia,
                                        undefined,
                                        undefined,
                                        undefined,
                                        blob as unknown as pyObject
                                    )
                                );
                            };

                            jqImg.attr("src", url);
                        })
                        .catch(reject)
                        .finally(function () {
                            if (urlHandle) {
                                urlHandle.release();
                            }
                        });
                })
        );
    });

    return pyMod;
};

export default image;

/*
 * TO TEST:
 *
 *  - Methods: generate_thumbnail
 *
 */
