import anvil.server

from .._base_classes import AppTables as BaseAppTables
from ._constants import SERVER_PREFIX
from ._table import Table

_table_cache = None


def _fill_cache():
    global _table_cache
    if _table_cache is None:
        _table_cache = anvil.server.call(SERVER_PREFIX + "get_app_tables")
    return _table_cache


def _clear_cache():
    global _table_cache
    _table_cache = None


class AppTables(BaseAppTables):
    def __getattribute__(self, name):
        # use __getattribute__ so that we prioritise the table name
        try:
            return self[name]
        except KeyError:
            return object.__getattribute__(self, name)

    def __getitem__(self, name):
        cache = _fill_cache()
        table_args = cache[name]
        return Table._create(*table_args)

    def __setattr__(self, name, val):
        raise AttributeError("app_tables is read-only")

    def __dir__(self):
        return object.__dir__(self) + list(_fill_cache().keys())


def get_table_by_id(table_id):
    table_args = anvil.server.call(SERVER_PREFIX + "get_table_by_id", table_id)
    return table_args and Table._create(*table_args)


app_tables = AppTables()
