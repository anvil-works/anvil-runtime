import anvil.google.auth
import anvil.regex
import anvil.server as rpc

add_missing_fields = False

def index_to_col(idx):
    idx -= 1
    if idx < 26:
        return chr(65 + (idx % 26))
    else:
        idx -= 26
        return chr(65 + (idx // 26)) + chr(65 + (idx % 26))

class ApiItem(object):

    def __getitem__(self, item_name):

        if item_name in self._obj:
            return self._obj[item_name]
        else:
            raise KeyError(item_name)

    def __getattr__(self, attr_name):
        if attr_name in self._obj:
            return self._obj[attr_name]
        elif attr_name == "id":
            return self._obj["id"]
        else:
            raise AttributeError("Could not find attribute: %s" % attr_name)

    def __init__(self, obj, other):
        self._obj = obj
        self._other = other

@anvil.server.serializable_type
class Cell(ApiItem):

    #!defAttr()!1: {name:"row",type:"number",description:"This cell's row index (starting from 1)"}
    #!defAttr()!1: {name:"col",type:"number",description:"This cell's column index (starting from 1)"}
    #!defAttr()!1: {name:"value",type:"string",description:"The value in this cell"}
    def __getattr__(self, name):
        if name == "input_value":
            # This used to be different. In v4 we just return the value, because it would take two API calls to get the input_value too.
            return self["value"]
        else:
            return ApiItem.__getattr__(self, name)

    def __setattr__(self, name, value):
        if name == "value" or name == "inputValue":

            rpc.call("anvil.private.google.sheets.v4.update_cell", self._other["capability"], value)

            self._obj['value'] = value

            return value
        else:
            object.__setattr__(self, name, value)

    def __repr__(self):
        return "<Google Worksheet Cell: %s>" % self.value
#!defClass(anvil.google.sheets,#Cell)!:


def old_field_transform(new_field_name):
    return anvil.regex.replace(new_field_name, "[^A-Za-z0-9\\-]", "").lower()

@anvil.server.serializable_type
class Row(ApiItem):
    def __getitem__(self, key):
        return self._other["data"][self._other['fields_old'].get(key, key)]

    def __setitem__(self, key, value):
        key = self._other['fields_old'].get(key, key)
        if key in self._other['data']:
            rpc.call("anvil.private.google.sheets.v4.update_cell", self._other["capability"].narrow([index_to_col(self._other['fields'].index(key)+1)]), value)
        else:
            raise KeyError(key)

    #!defMethod(_)!2: "Delete this row from the worksheet. (This will cause data in subsequent rows to shift up)" ["delete"]
    def delete(self):
        rpc.call("anvil.private.google.sheets.v4.delete_row", self._other["capability"])

    def __iter__(self):
        return iter(self._other['data'])

    def __repr__(self):
        return "<Google Worksheet Row: %s>" % self._other['data']
#!defClass(anvil.google.sheets,#Row)!:


class RowIterator(object):

    def __init__(self, cap, query_dict):
        self.cap = cap

        self.fields, rows, self.next_start, self.done = rpc.call("anvil.private.google.sheets.v4.list_initial_rows", cap, query_dict)
        self.query_list = [query_dict.get(f) for f in self.fields]
        self.fields_old = {old_field_transform(f): f for f in self.fields}
        self.iterator = iter(rows)

    def _load_next_page(self):
        rows, self.next_start, self.done = rpc.call("anvil.private.google.sheets.v4.list_more_rows", self.cap, self.query_list, self.next_start)
        self.iterator = iter(rows)

    def __next__(self):
        while True:
            try:
                r = next(self.iterator)
                return Row({}, {
                    "data": {self.fields[i]: (r['data'][i] if i < len(r['data']) else "") for i in range(len(self.fields))},
                    "capability": self.cap.narrow([r['row']]),
                    "fields": self.fields,
                    "fields_old": self.fields_old
                })
            except StopIteration:
                if self.done:
                    raise
                else:
                    self._load_next_page()

    next = __next__


class RowList(object):

    def __init__(self, cap, query_dict):
        self.cap = cap
        self.query_dict = query_dict
        self.it = RowIterator(cap, query_dict)

    def __iter__(self):
        if not self.it:
            return RowIterator(self.cap, self.query_dict)
        try:
            return self.it
        finally:
            self.it = None


@anvil.server.serializable_type
class Worksheet(ApiItem):

    #!defAttr()!1: {name:"title",type:"string",description:"The title of this worksheet"}
    #!defAttr()!1: {name:"row_count",type:"number",description:"The number of rows in this worksheet"}
    #!defAttr()!1: {name:"column_count",type:"number",description:"The number of columns in this worksheet"}
    #!defAttr()!1: {name:"fields",type:"list",description:"The fields in this worksheet (ie the column headers, or the values in the first row)"}
    #!defAttr()!1: {name:"rows",pyType:"list(anvil.google.sheets.Row instance)",description:"The rows in this worksheet (excluding the header)"}
    #!defAttr()!1: {name:"cells",pyType:"list(anvil.google.sheets.Cell instance)",description:"A list of all the cells in this worksheet"}
    def __getattr__(self, name):
        if name == "fields":
            return self.get_fields()
        elif name == "rows":
            return list(self.list_rows())
        elif name == "cells":
            return list(self.list_cells())
        else:
            return ApiItem.__getattr__(self, name)

    #!setItemType(anvil.google.sheets.Cell instance)!:
    def __getitem__(self, cell_tuple):
        row, col = cell_tuple

        return self.get_cell(row, col)

    def get_fields(self):
        cs = self.column_count

        return [c.value for c in self.list_cells(1,1,1,cs)]

    #!defMethod(list[anvil.google.sheets.Row instance],**query)!2: "List rows in this worksheet, optionally restricting to rows with the specified column values specified as keyword arguments" ["list_rows"]
    def list_rows(self, **query):
        return RowList(self._other['capability'], query)

    #!defMethod(anvil.google.sheets.Row instance,**fields)!2: "Add a row to the end of the worksheet, specifying values for columns as keywords arguments" ["add_row"]
    def add_row(self, **kwargs):

        fields = self.get_fields()
        fields_old = {old_field_transform(f): f for f in fields}

        values = {}

        for [k,v] in kwargs.items():
            key = fields_old.get(k,k)
            values[key] = v

        data = []
        for i in range(len(fields)):
            data.append(values.get(fields[i],""))

        added_row_index = rpc.call("anvil.private.google.sheets.v4.add_row", self._other['capability'], data)

        return Row({}, {
            "data": {fields[i]: data[i] for i in range(len(fields))},
            "capability": self._other["capability"].narrow([added_row_index]),
            "fields": fields,
            "fields_old": fields_old
        })

    #!defMethod(list[anvil.google.sheets.Cell instance],[min_row=],[max_row=],[min_col=],[max_col=])!2: "List cells in the worksheet, optionally specifying a region" ["list_cells"]
    def list_cells(self, min_row=None, max_row=None, min_col=None, max_col=None):

        min_col_str = index_to_col(min_col)
        max_col_str = index_to_col(max_col)

        range = min_col_str + str(min_row) + ":" + max_col_str + str(max_row)

        cells = rpc.call("anvil.private.google.sheets.v4.list_cells", self._other['capability'], range)
        return [Cell(c,{
            "capability": self._other['capability'].narrow([c['row'], index_to_col(c['col'])])
        }) for c in cells]

    #!defMethod(anvil.google.sheets.Cell instance,row,col)!2: "Get a particular cell from the spreadsheet" ["get_cell"]
    def get_cell(self, row, col):
        cells = self.list_cells(row, row, col, col)
        if len(cells) > 0:
            return cells[0]
        return None


    def __repr__(self):
        return "<Google Worksheet: %s>" % self._obj['title']
#!defClass(anvil.google.sheets,#Worksheet)!:


@anvil.server.serializable_type
class Spreadsheet(ApiItem):
    #!setItemType(anvil.google.sheets.Worksheet instance)!:
    def __getitem__(self, name):
      if isinstance(name, str):
        for w in self.list_worksheets():
          if w.title == name:
            return w
        raise KeyError("Spreadsheet contains no worksheet '%s'" % name)
      else:
        return list(self.list_worksheets())[name]

    #!defAttr()!1: {name:"worksheets",pyType:"list(anvil.google.sheets.Worksheet instance)",description:"The worksheets in this spreadsheet."}
    #!defAttr()!1: {name:"title",type:"string",description:"The title of this spreadsheet."}
    #!defAttr()!1: {name:"id",type:"string",description:"The ID of this spreadsheet in Google Drive"}
    def __getattr__(self, name):
        if name in self._obj:
            return self._obj[name]
        elif name == "worksheets":
            return self
        else:
            raise AttributeError("Could not find attribute: %s" % name)

    def __iter__(self):
        return iter(self.list_worksheets())

    def __len__(self):
        return len(list(self.list_worksheets()))

    #!defMethod(list[anvil.google.sheets.Worksheet instance])!2: "Get a list of all worksheets in this spreadsheet" ["list_worksheets"]
    def list_worksheets(self):
        return [Worksheet({
            "title": w['title'],
            "row_count": w['gridProperties']['rowCount'],
            "column_count": w['gridProperties']['columnCount']
        }, {
            "capability": self._other['capability'].narrow([[w['title'], w['sheetId']]])
        }) for w in self._other['worksheets']]


    def __repr__(self):
        return "<Google Sheet: %s>" % self._obj["title"]
#!defClass(anvil.google.sheets,#Spreadsheet)!:



Sheet = Spreadsheet # Alias for backwards-compatibility


def login():
    return anvil.google.auth.login(['https://www.googleapis.com/auth/spreadsheets'])


def get_sheet(id, creds):
    s = Spreadsheet(**rpc.call("anvil.private.google.sheets.v4.get_sheet", id, creds))
    return s


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

  An Exception will be raised if you try to set a non-existent field.

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
