import random
import os
import re
import sys
import anvil
import tempfile
import io
from ._client_side_only import _ClientSideOnly

_builtin_open = open

_SAFE_EXTENSION_RE = re.compile(r"\.([A-Za-z0-9]{1,50})\Z")


def _safe_extension(media):
    if media and media.name:
        m = _SAFE_EXTENSION_RE.search(media.name)
        if m:
            return "." + m.group(1)
    return ""


class TempFile():

    #!defMethod(string,[media])!2: "Create a temporary file initialised with the contents of the provided media, if any." ["__init__"]
    def __init__(self, media=None):
        self._media = media

    #!defMethod(string)!2: "" ["__enter__"]
    def __enter__(self):
        self._filename = tempfile.gettempdir() + os.sep + \
                         "".join([random.choice("1234567890abcdefghijklmnopqrstuvwxyz") for i in range(32)]) + \
                         _safe_extension(self._media)
        if self._media is not None:
            with _builtin_open(self._filename, "wb") as f:
                f.write(self._media.get_bytes())
        return self._filename

    #!defMethod(_)!2: "" ["__exit__"]
    def __exit__(self, e_type, e_val, tb):
        try:
            os.unlink(self._filename)
        except:
            # If it's already gone, we don't care.
            pass
#!defClass(anvil.media,%TempFile)!:


#!defFunction(anvil.media,%anvil.Media instance,filename,[mime_type],[name])!2: "Creates a Media object from the given file." ["from_file"]
def from_file(filename, mime_type=None, name=None):
    with _builtin_open(filename, "rb") as f:
        return anvil.BlobMedia(mime_type, f.read(), name=(name or filename.split(os.sep)[-1]))

#!defFunction(anvil.media,_,media,filename)!2: "Write a Media object to the given file" ["write_to_file"]
def write_to_file(media, filename):
    with _builtin_open(filename, "wb") as f:
        f.write(media.get_bytes())


#!defFunction(anvil.media,%BytesIO, media)!2: "Open a media file as Python BytesIO object" ["open"]
def open(media):
    return io.BytesIO(media.get_bytes())

print_media = _ClientSideOnly("media.print_media")
download = _ClientSideOnly("media.download")

TempUrl = _ClientSideOnly("media.TempUrl")
