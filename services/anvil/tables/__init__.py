import time

import anvil.server

from . import _config
from ._base_classes import Row, SearchIterator, Table
from ._errors import (
    NoSuchColumnError,
    QuotaExceededError,
    RowDeleted,
    TableError,
    TransactionConflict,
)
from ._helpers import _hash_wrapper


# Use old app tables by default
class AppTables(object):
    cache = None

    def __getattr__(self, name):
        if AppTables.cache is None:
            AppTables.cache = anvil.server.call("anvil.private.tables.get_app_tables")

        tbl = AppTables.cache.get(name)
        if tbl is not None:
            return tbl

        raise AttributeError("No such app table: '%s'" % name)

    def __setattr__(self, name, val):
        raise Exception("app_tables is read-only")

    def __iter__(self):
        return AppTableIterator()


class AppTableIterator:
    def __init__(self):
        self._it = None

    def __iter__(self):
        return self

    def __next__(self):
        # because __iter__ can't suspend
        if AppTables.cache is None:
            AppTables.cache = anvil.server.call("anvil.private.tables.get_app_tables")
        if self._it is None:
            self._it = AppTables.cache.keys().__iter__()
        return next(self._it)

    next = __next__


_set_class = object.__dict__["__class__"].__set__


def _lazy_replace_class(self):
    if _config.get_client_config().get("enable_v2"):
        from . import v2

        v2._app_tables._clear_cache()
        _set_class(self, type(v2.app_tables))
    else:
        AppTables.cache = None
        _set_class(self, AppTables)


def _wrap_dunder(method):
    def wrapped(self, *args, **kws):
        _lazy_replace_class(self)
        return getattr(self, method)(*args, **kws)

    return wrapped


class _LazyAppTables(object):
    def __getattribute__(self, name):
        if name == "__module__":
            return "anvil.tables"

        _lazy_replace_class(self)
        return getattr(self, name)

    __setattr__ = _wrap_dunder("__setattr__")
    __getitem__ = _wrap_dunder("__getitem__")
    __dir__ = _wrap_dunder("__dir__")
    __iter__ = AppTables.__iter__


_ThreadLocal = object

if anvil.is_server_side():
    try:
        from anvil._threaded_server import ThreadLocal as _ThreadLocal
    except ImportError:
        pass


class _LazyContext(_ThreadLocal):
    def __enter__(self):
        batchers = {"batch_update": batch_update, "batch_delete": batch_delete, "batch": batch}
        if not _config.get_client_config().get("enable_v2"):
            for obj in batchers.values():
                obj.__class__ = type(None)
            return self.__enter__()

        from .v2 import _batcher as _b

        for orig, obj in batchers.items():
            obj.__class__ = type(getattr(_b, orig))
            obj.__init__()
            setattr(_b, orig, obj)
        return self.__enter__()

    def __exit__(self, *args):
        assert not isinstance(self, _LazyContext)
        return self.__exit__(*args)


def _clear_cache():
    _config.reset_config()
    _set_class(app_tables, _LazyAppTables)


anvil.server._on_invalidate_client_objects(_clear_cache)


#!defModuleAttr(anvil.tables)!1:
# {
# 	name: "app_tables",
# 	type: "any",
# 	anvil$helpLink: "/docs/data-tables/data-tables-in-code",
# 	$doc: "Access Table objects from the datatables services. You can access a Table object with dot notation e.g. `app_tables.my_table`. To access a table with strings use `getattr(app_tables, 'my_table')`. If no table is present an AttributeError will be thrown."
# }
#
app_tables = _LazyAppTables()
batch_update = _LazyContext()
batch_delete = _LazyContext()
batch = _LazyContext()
_raise_on_cache_miss = False
# Not very nice but these references exist in uplink code
# before we have a chance to know if we're using the v1/v2 config option
# we can't call anvil.server until the uplink has made a connetion

#!defFunction(anvil.tables,anvil.tables.Table,table_id)!2:
# {
# 	$doc: "Get a table by id. Can pass a row id in, and the table the row belongs to will be returned.",
# anvil$helpLink: "/docs/data-tables/accelerated-tables"
#  } ["get_table_by_id"]
def get_table_by_id(table_id):
    if _config.get_client_config().get("enable_v2"):
        from .v2 import get_table_by_id

        return get_table_by_id(table_id)
    raise TableError("get_table_by_id is only available in Accelerated Tables beta")


#!defModuleAttr(anvil.tables)!1:
# {
# 	name: "app_tables",
# 	type: "any",
# 	anvil$helpLink: "/docs/data-tables/data-tables-in-code",
# 	$doc: "Access Table objects from the datatables services. You can access a Table object with dot notation e.g. `app_tables.my_table`. To access a table with strings use `getattr(app_tables, 'my_table')`. If no table is present an AttributeError will be thrown."
# }
#


def _get_call_info():
    # call_info only exists in server-side (downlink/uplink) runtimes; this module also runs
    # under Skulpt on the client
    if anvil.is_server_side():
        from anvil._threaded_server import call_info

        return call_info
    return None


_NO_CALLBACKS = {"before_commit": (), "after_commit": (), "after_rollback": ()}


def _effective_isolation(txn):
    return "relaxed" if txn._isolation == "relaxed" else "serializable"


def _outer_isolation(ci):
    # Isolation of the transaction already open in this call chain, or None if there isn't one
    if ci.active_transaction is not None:
        return _effective_isolation(ci.active_transaction)
    return ci.outer_transaction_isolation


class Transaction:
    def __init__(self, relaxed=False):
        self._aborting = False
        self._isolation = "relaxed" if relaxed else None
        self._entered_depth = 0

    #!defMethod(anvil.tables.Transaction instance)!2: "Begin the transaction. If a transaction is already open, this block is merged into it: it commits or rolls back with the outermost transaction." ["__enter__"]
    def __enter__(self):
        ci = _get_call_info()
        outer_isolation = _outer_isolation(ci) if ci is not None else None
        if outer_isolation is not None:
            # A transaction is already open: merge this block into it
            if outer_isolation == "relaxed" and _effective_isolation(self) == "serializable":
                raise TableError(
                    "Can't open a fully-isolated transaction inside a relaxed transaction"
                )
            self._entered_depth += 1
            return self

        anvil.server.call(
            "anvil.private.tables.open_transaction", isolation=self._isolation
        )
        if ci is not None:
            ci.active_transaction = self
            ci.txn_end_callbacks = {
                "before_commit": [],
                "after_commit": [],
                "after_rollback": [],
            }
        self._entered_depth += 1
        return self

    #!defMethod(_)!2: "End the transaction" ["__exit__"]
    def __exit__(self, e_type, e_val, tb):
        self._entered_depth -= 1
        ci = _get_call_info()
        if ci is not None and not (
            ci.active_transaction is self and self._entered_depth == 0
        ):
            # Nested block: committing is a no-op, and an exception keeps propagating to
            # the outermost transaction
            return
        if ci is not None:
            ci.active_transaction = None
        callbacks = None
        if ci is not None:
            callbacks = ci.txn_end_callbacks
            ci.txn_end_callbacks = None
        if callbacks is None:
            callbacks = _NO_CALLBACKS

        rolling_back = self._aborting or e_val is not None
        rollback_reason = e_val  # None for an explicit abort()

        if not rolling_back:
            try:
                for cb in callbacks["before_commit"]:
                    cb()
            except Exception as e:
                anvil.server.call("anvil.private.tables.close_transaction", True)
                for cb in callbacks["after_rollback"]:
                    cb(e)
                raise

        try:
            anvil.server.call("anvil.private.tables.close_transaction", rolling_back)
        except Exception as e:
            # The transaction is gone either way: a commit that failed (eg a conflict detected
            # at commit time) has been rolled back
            for cb in callbacks["after_rollback"]:
                cb(e)
            raise

        if rolling_back:
            for cb in callbacks["after_rollback"]:
                cb(rollback_reason)
        else:
            for cb in callbacks["after_commit"]:
                cb()

    #!defMethod(_)!2: "Abort the transaction this block is part of. When the outermost transaction ends, all write operations performed during it will be cancelled. Raises an error if this block is nested in a transaction opened by a different server call (for example, the server function that called this one), or if this transaction is not open." ["abort"]
    def abort(self):
        if self._entered_depth == 0:
            raise TableError("Can't abort() a transaction that is not open")
        ci = _get_call_info()
        if ci is None:
            # No server-side call context; nothing to delegate to
            self._aborting = True
        elif ci.active_transaction is not None:
            # Roll back the outermost transaction, whether that's us or a transaction
            # we're nested inside
            ci.active_transaction._aborting = True
        else:
            raise TableError(
                "Can't abort() a nested transaction in a call that does not own the outermost transaction"
            )


#!defClass(anvil.tables,%Transaction)!:


#!defFunction(anvil.tables,%,[before_commit=],[after_commit=],[after_rollback=])!2:
# {
# 	$doc: "Register callbacks to run when the current data tables transaction ends. before_commit callbacks run (with no arguments) just before the transaction attempts to commit; after_commit callbacks run (with no arguments) after it commits successfully; after_rollback callbacks run after the transaction is rolled back, receiving the exception that caused the rollback (or None for an explicit abort()). If no transaction is open, before_commit and then after_commit are called immediately.",
# anvil$helpLink: "/docs/data-tables/TODO"
#  } ["on_transaction_end"]
def on_transaction_end(before_commit=None, after_commit=None, after_rollback=None):
    for cb in (before_commit, after_commit, after_rollback):
        if cb is not None and not callable(cb):
            raise TypeError("on_transaction_end() callbacks must be callable")

    ci = _get_call_info()
    callbacks = ci.txn_end_callbacks if ci is not None else None
    if callbacks is not None:
        # This call owns the open transaction: run the callbacks when it ends
        if before_commit is not None:
            callbacks["before_commit"].append(before_commit)
        if after_commit is not None:
            callbacks["after_commit"].append(after_commit)
        if after_rollback is not None:
            callbacks["after_rollback"].append(after_rollback)
    elif ci is not None and ci.outer_transaction_isolation is not None:
        # We're inside a transaction our caller opened; we'll never see it end
        raise TableError(
            "Cannot call anvil.tables.on_transaction_end() in a call that doesn't own this transaction"
        )
    else:
        if before_commit is not None:
            before_commit()
        if after_commit is not None:
            after_commit()


#!defFunction(anvil.tables,%,function,server_function)!2:
# {
# 	$doc: "When applied to a function (as a decorator), the whole function will run in a data tables transaction. If it conflicts with another transaction, it will retry up to five times.",
# anvil$helpLink: "/docs/data-tables/transactions"
#  } ["in_transaction"]
def in_transaction(maybe_f=None, relaxed=None):
    # we don't want to import this on the client unnecessarily
    import functools

    def wrap(f):
        @functools.wraps(f)
        def new_f(*args, **kwargs):
            ci = _get_call_info()
            if ci is not None and _outer_isolation(ci) is not None:
                # Already in a transaction: merge into it, and leave retrying to whoever
                # owns it (a conflict dooms the whole outer transaction, so retrying just
                # this body could never succeed)
                with Transaction(relaxed=relaxed):
                    return f(*args, **kwargs)
            n = 0
            while True:
                try:
                    with Transaction(relaxed=relaxed):
                        return f(*args, **kwargs)
                except TransactionConflict:
                    # lazy load random incase we make random.js a slow path on the client
                    import random

                    n += 1
                    if n == 18:
                        raise
                    # print(f"RETRYING TXN {n}")
                    # Max total sleep time is a little under 150 seconds (avg 75), so server calls will timeout before this finishes usually.
                    sleep_amt = random.random() * (1.5**n) * 0.05
                    try:
                        time.sleep(sleep_amt)
                    except:
                        anvil.server.call("anvil.private._sleep", sleep_amt)

        try:
            reregister = f._anvil_reregister
        except AttributeError:
            pass
        else:
            reregister(new_f)

        return new_f

    if maybe_f is None:
        return wrap
    else:
        return wrap(maybe_f)


#!defFunction(anvil.tables,_,column_name,ascending=)!2: "Sort the results of this table search by a particular column. Default to ascending order." ["order_by"]
@anvil.server.portable_class
class order_by(object):
    def __init__(self, column_name, ascending=True):
        self.column_name = column_name
        self.ascending = ascending

    __hash__, __eq__ = _hash_wrapper("column_name", "ascending")


# backward compatability
from .query import fetch_only
from .query import page_size as _page_size


#!defFunction(anvil.tables,%,[via_host=],[via_port=])!2: "Get a Postgres connection string for accessing this app's Data Tables via SQL.\n\nThe returned string includes temporary login credentials and sets the search path to a schema representing this app's Data Table environment.\n\nYou can override the host and port for the database connection to connect via a secure tunnel.\n\n(Available on the Dedicated Plan only.)" ["get_connection_string"]
def get_connection_string(via_host=None, via_port=None):
    return anvil.server.call(
        "anvil.private.get_direct_postgres_connection_string",
        via_host=via_host,
        via_port=via_port,
    )


#!defMethod(table row, **column_values)!2: "Add a row to the data table. Use keyword arguments to specify column values." ["add_row"]
#!defMethod(client readable view)!2: "Return a view on the table that can be read by client code. Use keyword arguments to specify view restrictions" ["client_readable"]
#!defMethod(client writable view)!2: "Return a view on the table that can be written by client code. Use keyword arguments to specify view restrictions. This does not give the client write access to other tables referred to by the table." ["client_writable"]
#!defMethod(client writable view)!2: "Return a view on this table that can be written by client code. Use keyword arguments to specify view restrictions." ["client_writable_cascade"]
#!defMethod(_)!2: "Delete all the rows from the data table" ["delete_all_rows"]
#!defMethod(_)!2: "Get a single matching row from the data table whose columns match the keyword arguments. Returns None if no matching row exists, and raises an exception if more than one row matches.\n\nEg: app_tables.table_1.get(name='John Smith')" ["get"]
#!defMethod(row,id)!2: "Get the matching row from this data table, by its unique ID" ["get_by_id"]
#!defMethod(bool,row)!2: "Returns true if the table (or view) contains the provided row." ["has_row"]
#!defMethod(list of dicts)!2: "Get the spec for the table as a list of dicts. Each dict contains the name and type of a column." ["list_columns"]
#!defMethod(Row or None)!2: "Get rows from a data table. If you specify keyword arguments, you will retrieve only rows whose columns match those values.\n\nEg: app_tables.table_1.search(name='John Smith')" ["search"]
#!defMethod(Media object, [escape_for_excel=False])!2: "Get the table in CSV format, optionally escaped for use in Excel. Returns a downloadable Media object; use its url property." ["to_csv"]
#!defClassNoConstructor(anvil.tables,#Table)!1: "A table returned from app_tables"

#!defMethod(Media object, [escape_for_excel=False])!2: "Get the results of the SearchIterator in CSV format, optionally escaped for use in Excel. Returns a downloadable Media object; use its url property." ["to_csv"]
#!defMethod(_)!2: "Delete all the rows matching this search from the data table.\n\nNot available with Legacy Tables." ["delete_all_rows"]
#!defClassNoConstructor(anvil.tables,#SearchIterator)!1: "An iterator of table rows returned from a search()";


#!defMethod(_)!2: "Delete the row from its data table" ["delete"]
#!defMethod(id)!2: "Get the unique ID of the table row" ["get_id"]
#!defMethod(_,**column_values)!2:
# {
#   $doc: "Set values for multiple columns of this row at once. Use keyword arguments to specify column values.\n\nChanges are written to the database, or buffered until save() is called if this Row is buffering changes.",
#   anvil$helpLink: "/docs/data-tables/data-tables-in-code#updating-and-deleting-rows"
# } ["update"]
#!defMethod(_,[fetch=None])!2:
# {
#   $doc: "Clear this Row object's cached column values and immediately fetch fresh values from the database.\n\nWith no fetch argument, fetches all accessible columns. Pass a query.fetch_only(...) object to fetch only the specified columns; other columns remain uncached until accessed.",
#   anvil$args: {fetch: "A query.fetch_only(...) object specifying which columns to fetch, or None to fetch all accessible columns."},
#   anvil$helpLink: "/docs/data-tables/data-tables-in-code#explicit-cache-control"
# } ["refresh"]
#!defMethod(_,fetch)!2:
# {
#   $doc: "Fetch fresh values for specific columns of this Row from the database, even if those columns are already cached.\n\nPass a query.fetch_only(...) object specifying which columns to fetch. Other columns keep their existing cached values or remain uncached.",
#   anvil$args: {fetch: "A query.fetch_only(...) object specifying which columns to fetch."},
#   anvil$helpLink: "/docs/data-tables/data-tables-in-code#explicit-cache-control"
# } ["fetch"]
#!defClassNoConstructor(anvil.tables,#Row)!1: "A Data Table row.";
