# Wrap any SQL database in a Data-Tables-like API
try:
    from typing import Dict, Tuple
except ImportError:
    import collections
    Tuple = Dict = collections.defaultdict(dict)
import anvil.server
from anvil.server import Capability


class DatabaseImpl:
    def search(self, table: "TableInfo"):
        raise NotImplementedError

    def add_row(self, table: "TableInfo", data: dict):
        raise NotImplementedError

    def update_row(self, table: "TableInfo", primary_key: tuple, updates: dict):
        raise NotImplementedError

    def delete_row(self, table: "TableInfo", primary_key: tuple):
        raise NotImplementedError


def shared_data(gd, db_name):
    return gd.shared_data("anvil.ext_tables/"+db_name,
                          local_data_factory=lambda: {"TableInfo": {}},
                          remote_data_factory=lambda: {"tables": {}})

@anvil.server.portable_class
class TableInfo:
    def __init__(self, db_name, name, primary_key: Tuple[str], columns, db: DatabaseImpl):
        self.db_name = db_name
        self.name = name
        self.primary_key = primary_key
        self.columns = columns
        self.db = db

    @property
    def safe_version(self):
        return self

    def __serialize__(self, gd):
        return self.db_name, self.name, self.primary_key, self.columns

    def __deserialize__(self, value, gd):
        self.db_name, self.name, self.primary_key, self.columns = value
        self.db = None
    # def __serialize__(self, gd):
    #     txdata, _ = shared_data(gd, self.db_name)
    #     txdata["tables"][self.name] = (self.primary_key, self.columns)
    #     return self.db_name, self.name
    #
    # @classmethod
    # def __new_deserialized__(cls, data, gd):
    #     db_name, name = data
    #     txdata, localdata = shared_data(gd, db_name)
    #     inst = localdata["TableInfo"].get(name)
    #     if not inst:
    #         primary_key, columns = txdata["tables"][name]
    #         inst = cls(db_name, name, primary_key, columns, None)
    #     return inst


@anvil.server.portable_class
class Table:
    def __init__(self, info: TableInfo):
        self.info = info
        self.cap = anvil.server.Capability(["ext_tables/"+info.db_name, info.name])

    def search(self):
        if self.info.db:
            return self.info.db.search(table=self.info)
        else:
            return anvil.server.call("anvil.ext_tables.search/"+self.db_name, cap=self.cap)

    def add_row(self, **data):
        if self.info.db:
            return self.info.db.add_row(table=self.info, data=data)
        else:
            return anvil.server.call("anvil.ext_tables.add_row/"+self.db_name, cap=self.cap, data=data)


@anvil.server.portable_class
class Row:
    def __init__(self, table: TableInfo, data: dict, cap: Capability=None):
        self.table = table
        self.data = data
        self.cap = cap or Capability(["ext_tables/"+table.db_name, table.name, self.primary_key])

    def __getitem__(self, item):
        return self.data[item]

    def __setitem__(self, key, value):
        self.update(**{key: value})

    def __serialize__(self, gd):
        return {"table": self.table.safe_version, "data": self.data, "cap": self.cap}

    @property
    def primary_key(self):
        return tuple(self.data[col] for col in self.table.primary_key)

    def update(self, **updates):
        if self.table.db:
            self.table.db.update_row(self.table, self.primary_key, updates)
        else:
            anvil.server.call("anvil.ext_tables.update_row/"+self.table.db_name, cap=self.cap, updates=updates)
        self.data.update(updates)

    def delete(self):
        if self.table.db:
            self.table.db.delete_row(self.table, self.primary_key)
        else:
            anvil.server.call("anvil.ext_tables.delete_row/"+self.table.db_name, cap=self.cap)
