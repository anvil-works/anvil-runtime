import anvil.google.auth
import anvil.regex
import anvil.server as rpc

add_missing_fields = True

def _list_gen(request_page_fn):
    queue = []
    start_index = 1
    total_results = None

    while True:

        if len(queue) > 0:
            yield queue.pop(0)
        elif total_results == None or start_index <= total_results:
            result = request_page_fn(start_index)

            total_results = result["total_results"]
            start_index += len(result["items"])

            if "items" in result and len(result["items"]) > 0:
                queue.extend(result["items"])
        else:
            break


def wrap_gen(items, item_class, creds):
    for i in items:
        yield item_class(i, creds)

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

class Cell(ApiItem):

    def __init__(self, obj, creds):
        ApiItem.__init__(self, obj, creds)

        # These won't change, so set them here.

        self.row = self._obj["row"]
        self.col = self._obj["col"]


    def __getattr__(self, name):
        if name == "value":
            # Return the calculated value of the cell
            return self["value"]
        elif name == "input_value":
            # Return the input value of the cell
            return self["input_value"]

    def __setattr__(self, name, value):
        if name == "value" or name == "inputValue":
            url = self._obj["edit_url"]

            r = rpc.call("anvil.private.google.sheets.update_cell", self._obj["id"], url, self.row, self.col, value, self.creds)

            self._obj = r

            return value
        else:
            object.__setattr__(self, name, value)

    def __str__(self):
        return "<Google Worksheet Cell: %s>" % self._obj["value"]

class Worksheet(ApiItem):

    def __getattr__(self, name):
        if name == "fields":
            return self.get_fields()
        elif name == "rows":
            return list(self.list_rows())
        elif name == "cells":
            return list(self.list_cells())
        else:
            raise AttributeError("Could not find attribute: %s" % name)

    def __getitem__(self, cell_tuple):
        row, col = cell_tuple

        return self.get_cell(row, col)

    def get_fields(self):
        cs = self._obj["col_count"]

        return [anvil.regex.replace(c.value, "[^A-Za-z0-9\\-]", "").lower() for c in self.list_cells(1,1,1,cs)]

    def list_rows(self, limit=100, **kwargs):

        url = self._obj["list_feed_url"]

        query = ""
        if (len(kwargs) > 0):

            for k in kwargs.keys():
                if (len(query) > 0):
                    query += " and "
                if isinstance(kwargs[k], int) or isinstance(kwargs[k], float):
                  query += k + "=" + str(kwargs[k])
                else:
                  query += k + "=\"" + str(kwargs[k]) + "\""

        def next_page_fn(start_index):
          return rpc.call("anvil.private.google.sheets.list_rows", url, query, limit, self.creds, start_index=start_index)
        
        return _list_gen(next_page_fn)

    def add_row(self, **kwargs):

        values = {}
 
        count = 0
        for f in [k for k in kwargs if kwargs[k]!=""]:
            field_name = anvil.regex.replace(f, "[^A-Za-z0-9\\-]", "").lower()
            values[field_name] = str(kwargs[f])
            count += 1

        if count == 0:
            print("[WARNING: Skipping adding empty row to worksheet]")
            return None

        try:
          added_row = rpc.call("anvil.private.google.sheets.add_row", self._obj["list_feed_url"], values, self.creds)
        except Exception:
          added_row = None

        # The returned row will only contain fields that already exist in the sheet.
        # If we didn't specify any existing fields, no row will be returned at all.

        existing_fields = self.fields

        missing_fields = [k for k in values if not k in existing_fields]

        if len(missing_fields) > 0:

          if not add_missing_fields:
            if added_row:
              added_row.delete()
            raise Exception("Field(s) not found: %s" % ",".join(missing_fields))

          print("[WARNING: Adding missing fields to worksheet: %s]" % ",".join(missing_fields))

          # Create the field headers

          for i in range(len(missing_fields)):
            h = self.get_cell(1, len(existing_fields) + i + 1)
            h.value = missing_fields[i]



          if added_row:
            # If we previously added the row, we need to set the newly-added fields

            for f in missing_fields:
              added_row[f] = values[f]

          else:
            # Otherwise, we never added the row in the first place, 
            # so we just add it now directly.
            r = rpc.call("anvil.private.google.sheets.add_row", self._obj["list_feed_url"], values, self.creds)

            added_row = r

        return added_row

    def list_cells(self, min_row=None, max_row=None, min_col=None, max_col=None):
        url = self._obj["cells_feed_url"]

        query = ""

        if min_row:
            query += "&min-row=%d" % min_row
        if max_row:
            query += "&max-row=%d" % max_row
        if min_col:
            query += "&min-col=%d" % min_col
        if max_col:
            query += "&max-col=%d" % max_col


        def next_page_fn(start_index):
          return rpc.call("anvil.private.google.sheets.list_cells", url, query, self.creds, start_index=start_index)
        return wrap_gen(_list_gen(next_page_fn), Cell, self.creds)

    def get_cell(self, row, col):

        return Cell(rpc.call("anvil.private.google.sheets.get_cell", self._obj["cells_feed_url"], row, col, self.creds), self.creds)


    def __str__(self):
        return "<Google Worksheet: %s>" % self._obj["title"]


class Sheet(ApiItem):

    def __getitem__(self, name):
      if isinstance(name, str):
        for w in self.list_worksheets():
          if w._obj["title"] == name:
            return w
        raise KeyError("Spreadsheet contains no worksheet '%s'" % name)
      else:
        return list(self.list_worksheets())[name]

    def __getattr__(self, name):
        if name == "worksheets":
            return self
        else:
            raise AttributeError("Could not find attribute: %s" % name)

    def __iter__(self):
        return iter(self.list_worksheets())

    def __len__(self):
        return len(list(self.list_worksheets()))

    def list_worksheets(self):

        def request_page_fn(start_index):
            return rpc.call("anvil.private.google.sheets.list_worksheets", self._obj["worksheets_feed_url"], self.creds, start_index=start_index)

        return wrap_gen(_list_gen(request_page_fn), Worksheet, self.creds)


    def __str__(self):
        return "<Google Sheet: %s>" % self._obj["title"]




def login():
    return anvil.google.auth.login(['http://spreadsheets.google.com/feeds/'])

# This is so rarely used, and never documented, it was never ported to native modules.
#
# def list_sheets():
#     return wrap_gen(google.utils.feed_list_generator({
#         "url": "https://spreadsheets.google.com/feeds/spreadsheets/private/full",
#         "creds": "google-user"
#     }), Sheet)

def get_sheet(id, creds):
    return Sheet(rpc.call("anvil.private.google.sheets.get_sheet", id, creds), creds)


"""
id: drive_sheets
docs_url: /docs/integrations/google/google-drive#google-sheets
title: Google Sheets
description: |
  ```python
  db = app_files.my_sheet
  ```

  Google Sheets make ideal databases for Anvil apps. You can access sheets using Google Drive in the same way you access files.

  ```python
  ws = db["Sheet 1"]
  ```

  Once you have an object representing a Google Sheet, you can look up its individual worksheets. (It is also possible to look up a worksheet by number, eg `db[0]`, or obtain a list with `list(db.worksheets)`.)

  ```python
  print db["Sheet 1"].fields
  # Expect output similar to: '[name, age]'
  ```

  You should set up your Sheet using [Google Drive](https://drive.google.com) so that the column names are in the first row. Once your sheet is set up, you can get a list of the fields in a worksheet using the `fields` attribute.

  Fields will always be in lower case (even if your column headings use capital letters).

  ```python
  # Assuming columns "name" and "age"
  for r in db["Sheet 1"].rows:
    print "%s is %s years old" % (r["name"], r["age"])
  ```

  You can access rows of data like so:

  ```python
  # Convert age to dog years:
  for r in db["Sheet 1"].rows:
    r["age"] = 7 * int(r["age"])
  ```

  You can update them as well as reading them. You can assign numbers or strings,
  but the data you read from a row will always be a string:

  ```python
  ws = db["Sheet 1"]
  row = ws.add_row(name="Bob", age=56)
  ```

  You can add rows to your spreadsheet using the `add_row(...)` method:

  (Note: `add_row()` normally returns the new created row. However, if you
  attempt to insert an empty row, it will return `None`.)

  If you try to add a row containing a field that does not exist in the sheet, the field will be created automatically.
  You can change this behaviour by setting `anvil.google.sheets.add_missing_fields` to `False`, in which case an Exception will be raised if you try to set a non-existent field.

  ```python
  row.delete()
  ```

  You can delete a row using the `delete()` method.

  Beware: If you delete a row, other rows in the worksheet may shift unpredictably. If you delete a row, you should not re-use any other `row` objects from that worksheet. Call `list_rows()` again to find the rows you want again.

  ```python
  ## Display the calculated value of
  ## the cell in row 1, col 2

  print ws[1,2].value

  ## Display the formula in cell (1,2)

  print ws[1,2].input_value

  ## Set the value of a cell

  ws[3,4].value = "Some text"
  ```

  It is also possible to access individual cells of your spreadsheet.

"""
