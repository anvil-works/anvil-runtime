import random
import os
import sys
import anvil
import tempfile

class TempFile():

    #!defMethod(string,[media])!2: "Create a temporary file initialised with the contents of the provided media, if any." ["__init__"]
    def __init__(self, media=None):
        self._media = media

    #!defMethod(string)!2: "" ["__enter__"]
    def __enter__(self):
        self._filename = tempfile.gettempdir() + os.sep + "".join([random.choice("1234567890abcdefghijklmnopqrstuvwxyz") for i in range(32)])
        if self._media is not None:
            with open(self._filename, "wb") as f:
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
    with open(filename, "rb") as f:
        return anvil.BlobMedia(mime_type, f.read(), name=(name or filename.split(os.sep)[-1]))

#!defFunction(anvil.media,_,media,filename)!2: "Write a Media object to the given file" ["write_to_file"]
def write_to_file(media, filename):
    with open(filename, "wb") as f:
        f.write(media.get_bytes())
