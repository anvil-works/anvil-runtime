import anvil.google.auth
import anvil.google.sheets
import anvil
import anvil.server as rpc

google_api_scopes = ["https://www.googleapis.com/auth/drive", 'http://spreadsheets.google.com/feeds/']

try:
    basestring
except NameError:
    basestring = str

#####
# Internal helper methods
#####

def _query_single(parent_id, creds, **kwargs):
    r = rpc.call("anvil.private.google.drive.list_files", parent_id, creds, max_results=1, **kwargs)

    items = r["items"]
    if len(items) == 0:
        return None
    else:
        return items[0]

def _list_gen(request_page_fn):
    queue = []
    nextPageToken = ""

    while True:

        if len(queue) > 0:
            yield queue.pop(0)
        elif nextPageToken or nextPageToken == "":

            result = request_page_fn(nextPageToken)

            if 'nextPageToken' in result:
                nextPageToken = result["nextPageToken"]
            else:
                nextPageToken = None

            if "items" in result and len(result["items"]) > 0:
                queue.extend(result["items"])
                yield queue.pop(0)
            else:
                break
        else:
            break



def wrap_gen(items, creds, item_class=None):
    for i in items:
        if item_class is None:
          yield wrap_item(i, creds)
        else:
          yield item_class(i, creds)

def wrap_item(f, creds):
    if f == None:
        return None
    elif f["mimeType"] == 'application/vnd.google-apps.folder':
        return Folder(f, creds)
    elif f["mimeType"] == 'application/vnd.google-apps.spreadsheet':
        return anvil.google.sheets.get_sheet(f["id"], creds)
    else:
        return File(f, creds)

def create_item_simple(title, folder, mime_type, creds):

    # Use simple metadata-only endpoint to create item.

    return wrap_item(rpc.call("anvil.private.google.drive.create_item_simple", title, folder.id, mime_type, creds), creds)

def create_item_multipart(title, folder, content, creds, content_type=None):

    return wrap_item(rpc.call("anvil.private.google.drive.create_item_multipart", title, folder.id, content, creds, content_type=content_type), creds)

def update_metadata(item, metadata, creds):

    ctor = type(item)
    return ctor(rpc.call("anvil.private.google.drive.update_metadata", item.id, metadata, creds), creds)


#####
# Google Drive classes
#####

class ApiItem(object):

    def __getitem__(self, item_name):

        if item_name in self._obj:
            return self._obj[item_name]
        else:
            raise AttributeError("Could not find item: %s" % item_name)

    def __getattr__(self, attr_name):
        if attr_name == "id":
            return self._obj["id"]
        else:
            raise AttributeError("Could not find attribute: %s" % attr_name)

    def __init__(self, dict, creds):
        self._obj = dict
        self.creds = creds



class DriveItem(ApiItem):

    def __setitem__(self, item_name, value):
        if item_name in ["title"]: # List of valid fields to set
            update_metadata(self, {item_name: value}, self.creds)
        else:
            object.__setitem__(self, item_name, value)

    def move(self, dest_folder):
        return update_metadata(self, { 'parents': [{ 'id': dest_folder.id, 'old_id': self['parents'][0]['id'] }]}, self.creds)

    def trash(self):
        ctor = type(self)
        return ctor(rpc.call("anvil.private.google.drive.trash", self.id, self.creds), self.creds)

    def delete(self):
        rpc.call("anvil.private.google.drive.delete", self.id, self.creds)


class File(DriveItem,rpc.LazyMedia):

    def __init__(self,d,creds):
      rpc.LazyMedia.__init__(self,d["anvil_LazyMedia"])
      ApiItem.__init__(self,d,creds)

    def __getattribute__(self, attr_name):
        # Using __getattribute__ instead of __getattr__ here is a massive hack,
        # because client-side LazyMedia defines __getattribute__ as a workaround for some
        # Skulpt nastiness. Wheels within wheels...
        try:
            return object.__getattribute__(self, attr_name)
        except AttributeError:
            if attr_name == "revisions":
                return list(self.list_revisions())
            elif attr_name == "url" or attr_name == "content_type" or attr_name == "length" or attr_name == "name":
                return anvil.Media.__getattribute__(self, attr_name)
            else:
                return DriveItem.__getattr__(self, attr_name)

    def __setattr__(self, attr_name, value):
        if attr_name == "content_type":
            raise Exception("Cannot set a Google Drive file's content type as an attribute. Use set_media() instead.")
        # Was "elif attr_name == "_obj" or attr_name == "creds":"
        # but that broke at least _spec, and possibly something else
        else:
            object.__setattr__(self, attr_name, value)
        #else:
        #    raise Exception("Cannot set attribute '" + attr_name + "' of a Google Drive file")


    def get_bytes(self, revision=None):

        if revision:
            url = revision["downloadUrl"]
        else:
            url = self._obj["downloadUrl"]

        b = rpc.call("anvil.private.google.drive.get_content", url, self.creds).get_bytes()
        self._obj["fileSize"] = len(b)
        return b

    def get_content_type(self):
        return self["mimeType"]

    def get_name(self):
        return self["title"]

    def get_length(self):
        return int(self["fileSize"])

    def set_bytes(self, content):

        # Use simple upload to replace content. Don't need to touch metadata.

        content_type = "text/plain"

        if not isinstance(content, str):
            raise Exception("The 'bytes' of a file must be a Python string. To upload a Media object, use set_media().")

        r = rpc.call("anvil.private.google.drive.set_content", self.id, content, self.creds)

        self._obj["mimeType"] = content_type
        return File(r, self.creds)

    def set_media(self, media):
        if not isinstance(media, anvil.Media):
            raise Exception("set_media() must be called with a Media object.")

        r = rpc.call("anvil.private.google.drive.set_content", self.id, media, self.creds)

        self._obj["mimeType"] = media.content_type
        return File(r, self.creds)


    def list_revisions(self):

        def request_page_fn(page_token):
            return rpc.call("anvil.private.google.drive.list_file_revisions", self.id, self.creds, page_token)

        return wrap_gen(_list_gen(request_page_fn), self.creds, FileRevision);

    def __str__(self):
        return "<Google Drive File: %s>" % self["title"]


class FileRevision(ApiItem):

    def __getattr__(self, attr_name):
        if attr_name == "date":
            return self["modifiedDate"]
        else:
            return ApiItem.__getattr__(self, attr_name)


class Folder(DriveItem):

    def __getattr__(self, attr_name):
        if attr_name == "files":
            return list(self.list_files())
        elif attr_name == "folders":
            return list(self.list_folders())
        else:
            return DriveItem.__getattr__(self, attr_name)

    # Bear in mind that these query strings must correspond exactly to the server
    # proxy whitelist, or the request will be refused for app files.

    def list_files(self):

        def request_page_fn(page_token):
            return rpc.call("anvil.private.google.drive.list_files", 
                            self.id, 
                            self.creds, 
                            page_token=page_token,
                            trashed=False,
                            mime_type='!application/vnd.google-apps.folder')

        return wrap_gen(_list_gen(request_page_fn), self.creds);

    def list_folders(self):

        def request_page_fn(page_token):
            return rpc.call("anvil.private.google.drive.list_files", 
                            self.id, 
                            self.creds, 
                            page_token=page_token,
                            trashed=False,
                            mime_type='application/vnd.google-apps.folder')

        return wrap_gen(_list_gen(request_page_fn), self.creds);

    def get(self, title):
        return wrap_item(_query_single(self.id, self.creds, title=title, trashed=False), self.creds)

    def get_by_id(self, id):
        if not isinstance(id, basestring):
            raise Exception("ID must be a string")

        if id == "":
            raise Exception("The empty string is not a valid ID")

        return wrap_item(rpc.call("anvil.private.google.drive.get_file_by_id", self.id, id, self.creds), self.creds)

    def create_folder(self, title):
        return create_item_simple(title, self, "application/vnd.google-apps.folder", self.creds)

    def create_file(self, title, content_bytes = None, content_type = "text/plain"):
        if content_bytes:
            return create_item_multipart(title, self, content_bytes, self.creds, content_type=content_type)
        else:
            return create_item_simple(title, self, content_type, self.creds)

    def __str__(self):
        return "<Google Drive Folder: %s>" % self["title"]

#####
# Documentation
#####
"""
id: google_drive
docs_url: /docs/integrations/google/google-drive
title: Google Drive
description: |
  <div class="tutorial-link">Tutorial: Photo gallery with Google Drive<br><a href="/blog/photo-gallery"><i class="fa fa-play"></i> Play video</a></div>

  This service allows you to integrate Google Drive functionality into your Anvil app.
  You can select "app files" to which all users have access, or ask users to log in and
  then create, update and delete files in their own Google Drives.

  To add the Google Drive service to your app, click the plus sign (<i style="color:#428bca" class="fa fa-plus"></i>)
  next to **Services** in the [App browser](#app_browser).

  <img src="img/add_service.png" style="border: 1px solid #ccc; margin: 10px 0;">

includes: [drive_app_files,drive_file_io,drive_file_folders,drive_file_management,drive_sheets,drive_user_files]
"""

"""
id: drive_app_files
docs_url: /docs/integrations/google/google-drive#drive-app-files
title: App files
tooltip: Click for more about app files
description: |
  ```python
  from anvil.google.drive import app_files

  f = app_files.hello_txt
  print "File contents: " + f.get_bytes()
  ```

  App files are files or folders from your Google Drive that are available to any user of the app. Your users do not have to log in with Google; these files can always be accessed by this app.

  From the Google configuration page (under **services** in the [App browser](#app_browser)), you can click **Add app files** to add a file or folder from your Google Drive.

  Each app file (or folder) has a Python identifier derived from its filename.
  You can access these files as <code>app_files.<i>&lt;python-identifier&gt;</i></code>.

popup_includes: [drive_app_files_extra_link]
includes: [drive_permissions]
"""

"""
id: drive_permissions
docs_url: /docs/integrations/google/google-drive#drive-app-files
title: Permissions
tooltip: Click for more about permissions
description: |
  App files can have three levels of permission, indicated by symbols in the Google configuration page:

  <i class="fa fa-pencil"></i> **Client can read and write**<br>
  By default, any code in your app can read or modify an app file.
  This is convenient, but it also means anyone who can access your app could read or modify that file.
  (This is because the code in your forms - the *client code* - runs in the user's browser, so a malicious person could change that code
  to do whatever they like.) This is fine if you only share the app with people you trust - or if the app file
  is something you deliberately want the world to have access to.

  <i class="fa fa-eye"></i> **Client can read**<br>
  You can also make app files "read-only" for clients. This means that
  all of your code can read this app file, but only your [server modules](#server_modules) can change it.

  <i class="fa fa-eye-slash"></i> **No client access**<br>
  Finally, you can make your app file entirely private. This means only
  your [server modules](#server_modules) can read or write it.
"""


"""
id: drive_app_files_extra_link
docs_url: /docs/integrations/google/google-drive#drive-app-files
description:
 - "[Learn more about using Google Drive](#google_drive)"

"""

"""
id: drive_file_folders
docs_url: /docs/integrations/google/google-drive#folders
title: Folders
description: |
  ```python
  from anvil.google.drive import app_files

  folder = app_files.my_folder

  for f in folder.list_files():
    print f["title"]
  ```

  If you have an object representing a Google Drive folder, you can list the files in that folder with `list_files()`.

  `list_files()` returns an iterator, so you can loop over it in a `for` loop.

  ```python
  l1 = folder.files
  l2 = folder.folders
  print "This folder has %s files and %s folders in it" % (len(l1), len(l2))
  ```

  If you want to do more than just loop through the files, you can request a full list of files directly. Bear in mind that this might be slow if there are many files in the folder.

  Remember, a folder can contain other folders as well as files.

  ```python
  my_file = folder.get("my_file.txt")
  my_folder = folder.get("My Subfolder")
  ```

  You can even get an item by its title:

  ```python
  f = folder.create_file("new_file.txt")

  id = f.id

  # ... later ...

  my_file = folder.get_by_id(id)
  ```

  Every file has an ID, and you can get a file from a folder by its ID too,
  with `get_by_id`

"""
"""
id: drive_file_io
docs_url: /docs/integrations/google/google-drive#file-io
title: Files
description: |
  ```python
  from anvil.google.drive import app_files

  f = app_files.hello_txt
  f.set_bytes("My name is Bob.")
  ```

  If you have an object representing a Google Drive file, you can get or set its contents as a string with the `get_bytes()` and `set_bytes()` functions.

  ```python
  from anvil.google.drive import app_files

  f = app_files.my_file
  f.set_media(self.file_loader_1.file)
  ```

  You can also upload a [Media](#media) object (for example, from a [FileLoader](#fileloader) component) to a Google File.

  ```python
  from anvil.google.drive import app_files

  f = app_files.my_image

  self.image_1.source = f
  ```

  You can use a Google Drive file as a [Media](#media) object. Here we use a Google Drive file as the source of an [Image](#image) component:

  ```python
  from anvil.google.drive import app_files

  folder = app_files.my_folder

  new_file = folder.create_file("new_file.txt")
  ```

  To create files, use the `Folder.create_file` method.

  Calling `create_file` with a single file name argument creates a
  new file with MIME type `text/plain`.

  ```python
  new_file = folder.create_file("new_file.txt",
                                "Hello, world!")

  new_image = folder.create_file("new_file.jpg",
                                 file_loader_1.file)
  ```

  You can also pass an optional second argument, providing the initial
  content of the file. This can either be a string, or a [Media object](#media).
  If it is a Media object, the new file is automatically created with the correct
  MIME type.

  If possible, you should provide initial content when creating a file, rather than
  creating an empty file and then uploading its content. This way, if something goes
  wrong during upload then you won't end up with a new empty file.
"""
"""
id: drive_file_management
docs_url: /docs/integrations/google/google-drive#file-management
title: File management
description: |
  ```python
  from anvil.google.drive import app_files

  my_file = app_files.my_file
  folder = app_files.my_folder

  my_file.move(folder)
  ```

  You can move a Drive item (file or folder) from one folder to another by calling <code>move(<i>&lt;destination-folder&gt;</i>)</code>.

  ```python
  new_file = folder.create_file("new_file.txt")
  new_folder = folder.create_folder("new_folder")
  ```

  You can create a new file or folder, by calling <code>create_file(<i>&lt;title&gt;</i>)</code>
  or <code>create_folder(<i>&lt;title&gt;</i>)</code> on a folder.

  ```python
  file1 = folder.create_file("new_file.txt")
  file2 = folder.create_file("new_file.txt")

  saved_id = file1.id

  # (... some time later ...)

  # This will retrieve file1, not file2
  f = folder.get_by_id(saved_id)

  ```

  Google Drive permits you to create many files or folders with the same title. You can tell them apart by their `id` property,
  which is a unique string. If you want to store a reference to a file, you should use the `id`.

  ```python
  new_file.trash()
  new_folder.delete()
  ```

  You can put a Drive item in the trash by calling `trash()`, or delete it forever by calling `delete()` (this cannot be undone).
"""
"""
id: drive_user_files
docs_url: /docs/integrations/google/google-drive#user-files
title: Using a logged-in user's files
description: |
  As well as app files, you can use the Google service to access your users' own files when they log into your app with Google.

  To do this, you will need a Google API client ID (same as for the [Google REST API](#google_rest_api)).

  ```python
  import anvil.google.drive

  anvil.google.drive.login()

  folder = anvil.google.drive.get_user_files()

  for f in folder.list_files():
    print f["title"]
  ```

  To read and write files in a user's Google Drive, you must first call `anvil.google.drive.login()`, which will ask the user for permission to access their files. This is different from calling
  `anvil.google.auth.login()`, which only asks for their email address.

  Once a user has logged into your app using `anvil.google.drive.login()` you can read and write files in their Google Drive. (You can also pass a list of extra scopes to `anvil.google.drive.login()`, just like `anvil.google.auth.login()`.)

  You can get the top-level folder containing all the files in their drive by calling `anvil.google.drive.get_user_files()`.

  You will need to get a client ID and secret from the
  <a href="/doc/#linking_anvil_and_google" target="_blank">Google Developer Console <i class="fa fa-external-link"></i></a>
  if you want to use `anvil.google.drive.login()`. This client ID and secret must be pasted
  into the settings page for the Google service.

"""


#####
# API methods
#####

def login(extra_scopes=[]):
    return anvil.google.auth.login(google_api_scopes + extra_scopes)

def get_user_files():
    return Folder(rpc.call("anvil.private.google.drive.get_user_files"), "google-user")

class AppFilesCollection:

    def __getattr__(self, python_name):
        id = None
        for df in anvil.google.get_config().get("app_files", []):
            if df["python_name"] == python_name:
                id = df["id"]
                break

        if id == None:
            raise Exception("No such app file: %s" % python_name)

        f = rpc.call("anvil.private.google.drive.get_app_file", id)

        return wrap_item(f, "google-delegated")

app_files = AppFilesCollection()
