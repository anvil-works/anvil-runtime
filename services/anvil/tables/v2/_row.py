import anvil
import anvil.server
from anvil.server import Capability

from .._base_classes import Row as BaseRow
from .._errors import NoSuchColumnError, RowDeleted, TableError
from . import _batcher
from ._constants import (
    CAP_KEY,
    DATETIME,
    MEDIA,
    MULTIPLE,
    NOT_FOUND,
    SERVER_PREFIX,
    SHARED_DATA_KEY,
    SINGLE,
    UNCACHED,
)
from ._model import get_model_cls
from ._utils import (
    InternalDict,
    check_serialized,
    clean_local_datetime,
    init_spec_rows,
    init_view_data,
    maybe_handle_descriptors,
    merge_row_data,
    validate_cap,
)

PREFIX = SERVER_PREFIX + "row."
_make_refs = None  # for circular imports
_auto_create_is_enabled = NOT_FOUND


class _MODE:
    NORMAL = 0
    BUFFERED = 1
    DRAFT = 2
    # Buffered draft is when we explicitly call
    # buffer_changes(True) on a draft
    BUFFERED_DRAFT = 3


def _is_draft(row):
    return row._anvil.mode is _MODE.DRAFT or row._anvil.mode is _MODE.BUFFERED_DRAFT


def _is_buffered(row):
    return row._anvil.mode is not _MODE.NORMAL


def _copy(so):
    if isinstance(so, list):
        return [_copy(o) for o in so]
    if isinstance(so, dict):
        return {k: _copy(v) for k, v in so.items()}
    return so


# Version identifier for new cap update format - column names unlikely to start with $
VERSION_KEY = "$_V"


def _normalize_cap_update(cap_update):
    """Normalize cap_update to new format for backwards compatibility.

    Old format: False (deletion) or flat dict {col: value} (updates)
    New format: {"$_V": 0, "D": True} or {"$_V": 0, "U": dict, "S": spec}

    We use "$_V" as a version marker since column names can't start with $.
    """
    if cap_update is False:
        return {"D": True}
    if cap_update is None:
        return None
    if isinstance(cap_update, dict):
        if VERSION_KEY not in cap_update:
            # Old format: flat dict of updates
            return {"U": cap_update}
    return cap_update


class _BufferedContext(object):
    def __init__(self, row):
        self._row = row

    def __enter__(self):
        mode = self._row._anvil.mode
        if mode is _MODE.NORMAL:
            self._row._anvil.mode = _MODE.BUFFERED
        elif mode is _MODE.DRAFT:
            self._row._anvil.mode = _MODE.BUFFERED_DRAFT
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self._row._anvil.buffer.clear()
        if self._row._anvil.mode is _MODE.BUFFERED_DRAFT:
            # revert back to a state where if we call save()
            # then we will return to the default buffered mode
            self._row._anvil.mode = _MODE.DRAFT
        else:
            self._row._anvil.mode = _MODE.NORMAL


@anvil.server.portable_class
class Row(BaseRow):
    __slots__ = ("_anvil",)
    _Row_prefix_ = "anvil.tables.Row"
    _Row_buffered_ = False
    _Row_permissions_ = {"update": False, "create": False, "delete": False}

    @classmethod
    def _anvil_create(cls, view_key, table_id, row_id, spec=None, cap=None):
        cls = get_model_cls(table_id)
        buffer = {} if cls._Row_buffered_ else None
        row = object.__new__(cls)
        row._anvil_setup(view_key, table_id, row_id, spec, cap, buffer=buffer)
        return row

    def _anvil_setup(
        self, view_key, table_id, row_id, spec=None, cap=None, buffer=None
    ):
        object.__setattr__(self, "_anvil", InternalDict())
        self._anvil.view_key = view_key
        self._anvil.table_id = table_id
        self._anvil.id = row_id
        self._anvil.cap = cap
        self._anvil.cache = {}
        self._anvil.spec = (
            spec  # None when we are deserialized without access to table_data
        )
        self._anvil.cache_spec = spec["cache"] if spec is not None else []
        self._anvil.has_uncached = True
        self._anvil.exists = True
        self._anvil.dirty_spec = False  # used for serialization
        if view_key is None:
            self._anvil.mode = _MODE.DRAFT
        elif buffer is not None:
            self._anvil.mode = _MODE.BUFFERED
        else:
            self._anvil.mode = _MODE.NORMAL
        self._anvil.buffer = buffer or {}

        if cap is not None:
            cap.set_update_handler(self._anvil_cap_update_handler)

        return self

    @classmethod
    def _anvil_create_from_untrusted(cls, view_key, table_id, row_id, cap, local_data):
        # check that we can trust the data that was sent!
        row = local_data.get(cap)
        if row is None:
            row = local_data[cap] = cls._anvil_create(
                view_key, table_id, row_id, None, cap
            )
        return row

    @classmethod
    def _anvil_create_from_trusted(cls, view_key, table_id, row_id, table_data):
        table_id, row_id = str(table_id), str(row_id)
        view_data = table_data[view_key]
        rows = view_data["rows"]
        row_data = rows[row_id]
        if isinstance(row_data, Row):
            # prevent circular and use the created row from view_data
            return row_data
        spec = view_data["spec"]
        row = rows[row_id] = cls._anvil_create(view_key, table_id, row_id, spec)
        # Replace the compact row_data with ourself
        # This prevents circular references and has the benefit that
        # we create the same rows and linked rows when creating Row objects from the same data
        row._anvil_unpack(table_data, row_data)
        if view_data.get("dirty_spec"):
            # a serialized row marked its spec as dirty after an update
            row._anvil_clear_cache()
        return row

    @classmethod
    def _anvil_create_from_local_values(
        cls, view_key, table_id, row_id, spec, cap, local_items
    ):
        # the basic idea here is that we need to clean datetime objects and UNCACHE any linked rows
        # where the view_key doesn't match what we expect from the col_spec
        table_id, row_id = str(table_id), str(row_id)
        row = cls._anvil_create(view_key, table_id, row_id, spec, cap)
        clean_items = row._anvil_walk_local_items(local_items, missing=None)
        row._anvil.cache.update(clean_items)
        row._anvil_check_has_cached()
        return row

    # DESERIALIZE
    @classmethod
    def __new_deserialized__(cls, data, info):
        table_data, local_data = info.shared_data(SHARED_DATA_KEY)
        view_key, table_id, row_id, cap = data
        if not info.remote_is_trusted:
            validate_cap(cap, table_id, row_id)
            table_data = None  # just incase
        if not table_data:
            # table_data None is not enough because we may be sending rows back and forward
            # i.e. passing from client to server to client goes untrusted -> trusted -> client
            return cls._anvil_create_from_untrusted(
                view_key, table_id, row_id, cap, local_data
            )
        return cls._anvil_create_from_trusted(view_key, table_id, row_id, table_data)

    def _anvil_unpack(self, table_data, row_data):
        assert type(row_data) in (
            list,
            dict,
        ), "Unable to create Row object, bad row_data"
        spec = table_data[self._anvil.view_key]["spec"]
        if self._anvil.spec is None:
            self._anvil.spec = spec
        cols = spec["cols"] if spec is not None else []
        initial_load = not bool(self._anvil.cache)
        row_data_type = type(row_data)
        # if the spec is None we must have a dict data type with a single cap key
        # this potentially happens in (and is enforced by) serialization
        if row_data_type is list:
            unpacked_cache, cap = self._anvil_unpack_compact(
                table_data, spec, cols, row_data, initial_load
            )
        elif row_data_type is dict:
            unpacked_cache, cap = self._anvil_unpack_dict(
                table_data, cols, row_data, initial_load
            )
        else:
            raise TableError("the row data is invalid")

        assert type(cap) is Capability, "invalid row_data"
        if self._anvil.cap is None:
            self._anvil.cap = cap
            cap.set_update_handler(self._anvil_cap_update_handler)
        self._anvil.cache.update(unpacked_cache)
        self._anvil_check_has_cached()

    def _anvil_unpack_compact(self, table_data, spec, cols, row_data, initial_load):
        # spec["cache"] 1s matches the len(row_data) (+cap)
        iter_row_data = iter(row_data)
        unpacked_cache = {}
        for col, is_cached in zip(cols, spec["cache"]):
            if is_cached:
                val = self._anvil_maybe_unpack_linked(
                    next(iter_row_data), col, table_data
                )
            elif initial_load:
                val = UNCACHED  # there's nothing there yet so fill it
            else:
                continue
            unpacked_cache[col["name"]] = val
        return unpacked_cache, next(iter_row_data)

    def _anvil_unpack_dict(self, table_data, cols, row_data, initial_load):
        unpacked_cache = {}
        for i, col in enumerate(cols):
            val = row_data.pop(str(i), UNCACHED)
            if val is UNCACHED and not initial_load:
                # does this ever happen?
                continue
            unpacked_cache[col["name"]] = self._anvil_maybe_unpack_linked(
                val, col, table_data
            )
        cap = row_data.pop(CAP_KEY, None)
        assert len(row_data) == 0, "Invalid row data"
        return unpacked_cache, cap

    def _anvil_maybe_unpack_linked(self, val, col, table_data):
        table_id = col.get("table_id")
        did_return_value = 0
        if table_id is None:
            did_return_value += 1
            # not a linked row
            return val
        elif val is UNCACHED:
            did_return_value += 2
            # UNCACHED linked row
            return val
        elif val is None:
            did_return_value += 3
            # linked row is None
            return val
        else:
            try:
                return self._anvil_unpack_linked(table_id, val, col, table_data)
            except KeyError:
                # This line is failing for some users - wrap in a try except
                # it has since been reported on the forum and it seemed to be a client-side issue
                # where the early return was not being triggered
                import json

                msg = (
                    'Failed to get "view_key" or "type" from col={!r}, '
                    "found table_id={!r}, "
                    "table_id is None={!r},"
                    "val={!r}, val is UNCACHED={!r}"
                    "row_id={!r}, "
                    "did_return_value={!r}, "
                    "server_side={!r}".format(
                        col,
                        table_id,
                        table_id is None,
                        val,
                        val is UNCACHED,
                        self._anvil.id,
                        did_return_value,
                        anvil.is_server_side(),
                    )
                )
                try:
                    _data = json.dumps(
                        table_data, indent=2, default=lambda o: str(type(o))
                    )
                    msg += "\n\nTable data:\n{}".format(_data)
                except Exception:
                    pass

                raise KeyError(msg)

    def _anvil_unpack_linked(self, table_id, val, col, table_data):
        col_type, view_key = col["type"], col["view_key"]

        if col_type == SINGLE:
            row_id = val
            return Row._anvil_create_from_trusted(
                view_key, table_id, row_id, table_data
            )
        elif col_type == MULTIPLE:
            row_ids = val
            return [
                Row._anvil_create_from_trusted(view_key, table_id, row_id, table_data)
                for row_id in row_ids
            ]

        raise AssertionError("bad col type with table_id")

    # SERIALIZATION
    def __serialize__(self, info):
        self._anvil_check_can_serialize()
        table_data, local_data = info.shared_data(SHARED_DATA_KEY)
        if table_data is not None and info.local_is_trusted:
            self._anvil_merge_and_reduce(table_data, local_data)
        else:
            # We want to ensure we're not trying to send a linked draft or row that has buffered changes
            # TODO - we could be a bit more efficient about this since we don't actually need the data!
            self._anvil_merge_and_reduce({}, local_data)
        return [
            self._anvil.view_key,
            self._anvil.table_id,
            self._anvil.id,
            self._anvil.cap,
        ]

    def _anvil_check_can_serialize(self, linked=False):
        error = None
        pre = "Linked " if linked else ""
        if _is_draft(self):
            error = "Draft Rows cannot be serialized. Call save() first. (Found {!r})"
        elif self._anvil.buffer:
            error = "Rows with buffered changes cannot be serialized. Call save() or reset() first, (Found {!r})"
        if error:
            raise anvil.server.SerializationError(pre + error.format(self))

    def _anvil_merge_linked(self, val, col, g_table_data, local_data):
        type = col["type"]
        if val is UNCACHED or val is None:
            # maybe we were serialized and converted linked row(s) to UNCACHED
            # or actually the linked row is None
            pass
        elif type == SINGLE:
            row = val
            val = row._anvil_merge_and_reduce(g_table_data, local_data)
        elif type == MULTIPLE:
            val = [row._anvil_merge_and_reduce(g_table_data, local_data) for row in val]
        return val

    def _anvil_make_row_data(self, g_table_data, local_data, cache_spec):
        self._anvil_check_can_serialize(linked=True)
        table_spec = self._anvil.spec
        table_cols = table_spec["cols"] if table_spec is not None else []
        cache = self._anvil.cache
        # we can't rely on the order of cache in python 2
        cached_data = []
        for i, (col, is_cached) in enumerate(zip(table_cols, cache_spec)):
            if not is_cached:
                continue
            name = col["name"]
            val = self._anvil_merge_linked(cache[name], col, g_table_data, local_data)
            cached_data.append((i, val))
        cached_data.append((CAP_KEY, self._anvil.cap))
        return cached_data

    def _anvil_merge_and_reduce(self, g_table_data, local_data):
        if check_serialized(self, local_data):
            return int(self._anvil.id)
        g_view_data = init_view_data(self._anvil.view_key, g_table_data)
        table_spec, row_id, cache_spec = (
            self._anvil.spec,
            self._anvil.id,
            self._anvil.cache_spec,
        )

        # We assert that there is no way for rows from the same view_key to have different col_specs
        # This includes the order
        # the only thing they may differ on is cache_specs
        g_table_spec, g_table_rows = init_spec_rows(g_view_data, table_spec, cache_spec)
        g_cache_spec = g_table_spec["cache"] if g_table_spec is not None else None

        if table_spec is not None and g_cache_spec is not None:
            is_dirty = self._anvil.dirty_spec or len(cache_spec) != len(g_cache_spec)
        else:
            is_dirty = self._anvil.dirty_spec

        if is_dirty:
            g_view_data["dirty_spec"] = True
            cache_spec = []

        cached_data = self._anvil_make_row_data(g_table_data, local_data, cache_spec)
        existing = g_table_rows.get(row_id, [])

        if not is_dirty and cache_spec == g_cache_spec and type(existing) is list:
            row_data = [val for _, val in cached_data]
        else:
            row_data = {str(key): val for key, val in cached_data}

        merge_row_data(row_id, row_data, g_table_rows, g_table_spec, cache_spec)
        return int(row_id)

    # PRIVATE METHODS
    def _anvil_cap_update_handler(self, cap_update):
        # Normalize old format to new format for backwards compatibility
        cap_update = _normalize_cap_update(cap_update)
        if cap_update is None:
            return

        D = cap_update.get("D")
        U = cap_update.get("U")

        if D:
            # We've been deleted - clear cache so that
            # server calls are required for data access
            self._anvil_clear_cache()
            self._anvil.mode = _MODE.NORMAL
            self._anvil.buffer.clear()
            self._anvil.exists = False
            return

        if self._anvil.spec is None:
            return

        if U:
            clean_items = self._anvil_walk_local_items(U)
            self._anvil.cache.update(clean_items)
            for key in clean_items:
                self._anvil.buffer.pop(key, None)
            self._anvil_check_has_cached()

    def _anvil_check_has_cached(self):
        if self._anvil.spec is None:
            return
        self._anvil.cache_spec = [
            int(self._anvil.cache[col["name"]] is not UNCACHED)
            for col in self._anvil.spec["cols"]
        ]
        self._anvil.has_uncached = any(
            val is UNCACHED for val in self._anvil.cache.values()
        )

    def _anvil_clear_cache(self):
        # clearing the cache also clears the spec - this forces a call to the server to update a spec
        self._anvil.spec = None
        self._anvil.cache.clear()
        self._anvil.cache_spec = []
        self._anvil.has_uncached = True

    def _anvil_fill_cache(self, fetch=None):
        if fetch is not None:
            uncached_keys = None if fetch is True else fetch
        elif self._anvil.spec is None:
            uncached_keys = None
        elif self._anvil.has_uncached:
            uncached_keys = [
                key for key, val in self._anvil.cache.items() if val is UNCACHED
            ]
        else:
            return  # no uncached values

        table_data = _batcher.flush_and_call(
            PREFIX + "fetch", self._anvil.cap, uncached_keys
        )
        rows = table_data[self._anvil.view_key]["rows"]
        row_data = rows[self._anvil.id]
        # Replace the compact row data with this Row instance
        # so circular references don't clobber the data while we're unpacking.
        rows[self._anvil.id] = self
        self._anvil_unpack(table_data, row_data)

    def _anvil_walk_local_items(self, items, missing=NOT_FOUND):
        # We are about to put local items in the cache
        # so check linked rows have valid view keys datetimes have tz.offset applied
        items = items.copy()
        rv = {}
        cols = self._anvil.spec["cols"]
        for col in cols:
            name, type = col["name"], col["type"]
            val = items.pop(name, missing)
            if val is NOT_FOUND:
                continue
            else:
                rv[name] = _copy(val)
            if val is UNCACHED or val is None:
                continue
            elif type == DATETIME:
                rv[name] = clean_local_datetime(val)
                continue
            elif type == MEDIA:
                rv[name] = UNCACHED  # we need to fetch a lazy media with a valid url
                continue
            elif type == SINGLE:
                val = [val]
            elif type != MULTIPLE:
                continue
            rows = val
            expected_view_key = col["view_key"]
            if any(row._anvil.view_key != expected_view_key for row in rows):
                rv[name] = UNCACHED
        if len(items):
            # more items than we should have - our col spec is no good anymore
            self._anvil.dirty_spec = True
            rv.update(items)
        return rv

    def _anvil_check_exists(self):
        # only call this if we're not doing a server call
        if not self._anvil.exists:
            raise RowDeleted("This row has been deleted")
        elif _is_draft(self):
            raise ValueError("This row is a draft and does not yet exist")

    # DUNDER METHODS
    def __setattr__(self, attr, val):
        if not maybe_handle_descriptors(self, attr, val):
            raise AttributeError(
                f"Rows cannot have local state, trying to set {attr!r} attribute on {self!r}"
            )

    def __iter__(self):
        # call to __iter__ can't suspend
        # so only do suspension stuff in __next__
        # note that this will not get called for dict(row)
        # keys() and __getitem__ wins for a call to dict
        return RowIterator(self)

    def __contains__(self, key):
        return key in self.keys()

    def __getitem__(self, key):
        if not isinstance(key, str):
            raise TypeError(
                "Row columns are always strings, not {}".format(type(key).__name__)
            )
        if _is_buffered(self):
            rv = self._anvil.buffer.get(key, NOT_FOUND)
            if rv is not NOT_FOUND:
                return _copy(rv)
            if _is_draft(self):
                return None

        if _batcher.batch_update.active:
            rv = _batcher.batch_update.read(self._anvil.cap, key)
            if rv is not NOT_FOUND:
                return _copy(rv)
        if self._anvil.spec is None:
            self._anvil_fill_cache()
        hit = self._anvil.cache.get(key, NOT_FOUND)
        if hit is UNCACHED:
            # we have a spec now so we'll fetch the remaining columns
            self._anvil_fill_cache()
        elif hit is NOT_FOUND:
            global _auto_create_is_enabled
            if _auto_create_is_enabled is NOT_FOUND:
                _auto_create_is_enabled = anvil.server.call(PREFIX + "can_auto_create")
            if _auto_create_is_enabled:
                # try to force fetch this key - incase we have a bad spec - i.e auto-columns
                self._anvil_fill_cache([key])
        else:
            return _copy(hit)
        try:
            return _copy(self._anvil.cache[key])
        except KeyError:
            raise NoSuchColumnError("No such column '" + key + "'")

    def __setitem__(self, key, value):
        return self.update(**{key: value})

    def __eq__(self, other):
        if not isinstance(other, Row):
            return NotImplemented
        if self is other:
            return True
        return (
            self._anvil.id is not None
            and other._anvil.id == self._anvil.id
            and other._anvil.table_id == self._anvil.table_id
        )

    def __hash__(self):
        if _is_draft(self):
            raise ValueError("draft rows are unhashable")
        self._anvil_check_exists()
        return hash((self._anvil.table_id, self._anvil.id))

    def __repr__(self):
        cls = type(self)
        prefix = cls._Row_prefix_
        if _is_draft(self):
            return "<{} (draft) object>".format(prefix)

        if self._anvil.spec is None:
            return "<{} object>".format(prefix)

        # custom reprs depending on type
        def trunc_str(s):
            return repr(s) if len(s) < 20 else repr(s[:17] + "...")

        def dt_repr(d):
            return "datetime(" + str(d) + ")"

        def d_repr(d):
            return "date(" + str(d) + ")"

        printable_types = {
            "string": trunc_str,
            "bool": repr,
            "date": d_repr,
            "datetime": dt_repr,
            "number": repr,
        }

        # Find cols that are both cached and easily printed
        cache, cols = self._anvil.cache, self._anvil.spec["cols"]
        cached_printable_cols = [
            (c["name"], printable_types[c["type"]], cache[c["name"]])
            for c in cols
            if c["type"] in printable_types and cache[c["name"]] is not UNCACHED
        ]
        # Only keep the first 5
        cached_printable_cols = cached_printable_cols[:5]
        # Find all the remaining columns
        num_remaning = len(cols) - len(cached_printable_cols)

        vals = ", ".join(
            "{}={}".format(name, None if val is None else meth(val))
            for name, meth, val in cached_printable_cols
        )

        if not num_remaning:
            and_more = ""
        elif cached_printable_cols:
            and_more = ", plus {} more column{}".format(
                num_remaning, "s" if num_remaning != 1 else ""
            )
        else:
            and_more = "{} column{}".format(
                num_remaning, "s" if num_remaning != 1 else ""
            )

        return "<{}: {}{}>".format(prefix, vals, and_more)

    # PUBLIC API
    def buffer_changes(self, buffered=None):
        if buffered:
            if _is_draft(self):
                # we are explicitly setting the mode to buffered
                # this effects the save behaviour
                # this would be an unusual thing to do - but it does mean you can re-use logic between drafts and rows
                self._anvil.mode = _MODE.BUFFERED_DRAFT
            else:
                self._anvil.mode = _MODE.BUFFERED
            return _BufferedContext(self)
        elif buffered is None:
            # we don't start buffering until we enter the context manager
            return _BufferedContext(self)
        elif _is_draft(self):
            # alternatively we could go to `DRAFT` mode from `BUFFERED_DRAFT` mode
            raise ValueError(
                "Changes in a draft row must always be buffered"
                " - call save() to convert to a realized row or reset to clear the buffer"
            )
        else:
            self._anvil.mode = _MODE.NORMAL
            self._anvil.buffer.clear()

    @property
    def buffered_changes(self):
        if _is_buffered(self):
            return _copy(self._anvil.buffer)
        else:
            return None

    def save(self):
        # TODO - add a cascade argument and decide on the correct behaviour
        # e.g. what happens if cascade is false but you have draft linked rows?
        save_all(self)

    def reset(self):
        reset_all(self)

    # deprecated
    def get_id(self):
        # For compatibility with LiveObjects
        self._anvil_check_exists()
        return "[{},{}]".format(self._anvil.table_id, self._anvil.id)

    # TODO reinclude this api
    # @property
    # def id(self):
    #     return self._anvil.id

    # TODO reinclude this api
    # @property
    # def table_id(self):
    #     return self._anvil.table_id

    def get(self, key, default=None):
        if key in self.keys():
            return self[key]
        return default

    def keys(self):
        if _is_draft(self):
            return self._anvil.buffer.keys()
        if self._anvil.spec is None:
            # if we don't have a _spec we don't have any keys
            # but we don't need to blindly call _fill_uncached: UNCACHED values are fine
            self._anvil_fill_cache([])
        return self._anvil.cache.keys()

    def _anvil_get_view(self):
        fetch = None
        if _is_buffered(self):
            fetch = [k for k in self.keys() if k not in self._anvil.buffer]
        self._anvil_fill_cache(fetch)

        view = _copy(self._anvil.cache)

        if _batcher.batch_update.active:
            batched = _batcher.batch_update.get_updates(self._anvil.cap)
            view.update(_copy(batched))

        if _is_buffered(self):
            view.update(_copy(self._anvil.buffer))

        return view

    def items(self):
        return self._anvil_get_view().items()

    def values(self):
        return self._anvil_get_view().values()

    def update(*args, **new_items):
        # avoid name conflicts with columns, could use (self, other, /, **kws)
        # but positioin only args not available in py2/Skulpt
        if not args:
            raise TypeError("method 'update' of 'Row' object needs an argument")
        elif len(args) > 2:
            raise TypeError("expected at most 1 argument, got %d" % (len(args) - 1))
        elif len(args) == 2:
            new_items = dict(args[1], **new_items)
        self = args[0]
        if not new_items:
            # backwards compatability hack
            self._anvil_clear_cache()
            return

        if _is_buffered(self):
            self._anvil.buffer.update(new_items)
        elif not anvil.is_server_side() and type(self)._Row_permissions_["update"]:
            # If we are on the client and we are a client-updatable model, we should send updates via the
            # server.
            _batcher.flush_and_call(
                "anvil.tables.v2._update_row_on_server", self, new_items, [type(self)]
            )
        else:
            self._do_update(new_items, not anvil.is_server_side())

    def delete(self):
        if not anvil.is_server_side() and type(self)._Row_permissions_["delete"]:
            # If we are a client-deletable model, we should send delete requests via the server
            _batcher.flush_and_call(
                "anvil.tables.v2._delete_row_on_server", self, type(self)
            )
        else:
            self._do_delete(not anvil.is_server_side())

    def _do_delete(self, from_client):
        on_behalf_of_client = self._anvil_on_behalf_of_client("delete", from_client)

        if _batcher.batch_delete.active:
            return _batcher.batch_delete.push(
                self._anvil.cap, False, on_behalf_of_client
            )

        _batcher.flush_and_call(PREFIX + "delete", self._anvil.cap, on_behalf_of_client)
        self._anvil.cap.send_update(False)

    def refresh(self, fetch=None):
        self._anvil_clear_cache()
        if fetch is None:
            self._anvil_fill_cache()
        else:
            self.fetch(fetch)

    def fetch(self, fetch):
        from ..query import fetch_only

        if not isinstance(fetch, fetch_only):
            nm = type(fetch).__name__
            raise TypeError("expected a q.fetch_only() object, got {!r}".format(nm))

        self._anvil_fill_cache(fetch.spec)

    @classmethod
    def _anvil_on_behalf_of_client(cls, permission, from_client):
        # We're on the server, this request originated on the client, and the client doesn't have permission to do this
        return (
            anvil.is_server_side()
            and from_client
            and not cls._Row_permissions_[permission]
        )

    def _do_update(self, updates, from_client):
        on_behalf_of_client = self._anvil_on_behalf_of_client("update", from_client)

        if _batcher.batch_update.active:
            # a batch update might be on_behalf_of_client, if we are called during a save
            # and the save was from the client
            # and one of the updates does not have client_updatable permissions set
            return _batcher.batch_update.push(
                self._anvil.cap, updates, on_behalf_of_client
            )

        global _make_refs
        if _make_refs is None:
            from ._refs import make_refs  # circular import

            _make_refs = make_refs

        _batcher.flush_and_call(
            PREFIX + "update", self._anvil.cap, _make_refs(updates), on_behalf_of_client
        )
        self._anvil.cap.send_update(updates)

    @classmethod
    def _do_create(cls, buffer, from_client):
        raise NotImplementedError("Must be implemented by a subclass")


class RowIterator:
    def __init__(self, row):
        self._row = row
        self._fill_required = row._anvil.spec is None and not _is_draft(row)
        if _is_draft(row):
            self._iter = iter(row._anvil.buffer.items())
        else:
            self._iter = iter(row._anvil.cache.items())

    def __iter__(self):
        return self

    def __next__(self):
        if self._fill_required:
            self._row._anvil_fill_cache()
            self.__init__(self._row)

        key, value = next(self._iter)

        if _batcher.batch_update.active:
            batched = _batcher.batch_update.read(self._row._anvil.cap, key)
            if batched is not NOT_FOUND:
                value = batched

        if not _is_draft(self._row) and key in self._row._anvil.buffer:
            value = self._row._anvil.buffer[key]

        if value is UNCACHED:
            # fill the rest of the cache
            # since we probably want all the items!
            # we rely here on the _cache keys not changing during iteration
            # which works since we've filled it with UNCACHED values that match our expected keys
            self._row._anvil_fill_cache()
            value = self._row._anvil.cache[key]

        return (key, _copy(value))

    next = __next__


if anvil.is_server_side():
    import anvil.tables

    @anvil.tables.in_transaction(relaxed=True)
    def _save_on_server(changes, from_client):
        from . import get_table_by_id

        drafts = []

        for draft_info in changes["draft_info"]:
            table_id = draft_info["table_id"]
            table = get_table_by_id(table_id)
            from ._model import get_model_cls

            model = get_model_cls(table_id)
            rv = model._do_create(draft_info["buffer"], from_client)
            if not isinstance(rv, table.Row):
                raise Exception("Row._do_create() must return a Row")
            drafts.append(rv)

        # create empty buffers for each draft
        # these buffers will be filled with any links/mulitlinks that contained drafts
        # we couldn't include these changes with creation - so we write the changes later
        draft_buffers = [{} for _ in changes["draft_info"]]

        for single in changes["single"]:
            # single has paths to drafts and we inject the crated drafts into the appropriate paths
            path = single["path"]
            row_index = single["row"]
            row = drafts[row_index]
            if path[0] == "rows":
                buffer = changes["buffers"][path[1]]
            elif path[0] == "drafts":
                buffer = draft_buffers[path[1]]
            key = path[2]
            buffer[key] = row

        for multi in changes["multi"]:
            # multi has paths to drafts and we inject the crated drafts into the appropriate paths
            path = multi["path"]
            rows = multi["rows"]
            for i, row in enumerate(rows):
                if isinstance(row, int):
                    rows[i] = drafts[row]
            if path[0] == "rows":
                buffer = changes["buffers"][path[1]]
            elif path[0] == "drafts":
                buffer = draft_buffers[path[1]]
            key = path[2]
            buffer[key] = rows

        with _batcher.batch_update:
            for row, buffer in zip(changes["rows"], changes["buffers"]):
                buffer = buffer or {}
                table = get_table_by_id(row._anvil.table_id)
                if not isinstance(row, Row):
                    raise TypeError("changes['rows'] must consist of Row objects")
                row._do_update(buffer, from_client)

            for row, buffer in zip(drafts, draft_buffers):
                if not buffer:
                    continue

                table = get_table_by_id(row._anvil.table_id)
                row._do_update(buffer, from_client)

        return drafts

    if anvil.server.context.type != "uplink":

        @anvil.server.callable("anvil.tables.v2._save_on_server")
        def _wrap_save_on_server(changes, models=None):
            return _save_on_server(changes, True)

        @anvil.server.callable("anvil.tables.v2._update_row_on_server")
        def _wrap_update_on_server(row, changes, models=None):
            if not isinstance(row, Row):
                raise TypeError("Must pass a table row")
            row._do_update(changes, True)

        @anvil.server.callable("anvil.tables.v2._delete_row_on_server")
        def _wrap_delete_on_server(row, models=None):
            if not isinstance(row, Row):
                raise TypeError("Must pass a table row")
            row._do_delete(True)


def _walk_buffered_changes(row, changes, drafts, buffered, seen):
    # Approach: we fill the changes dict with draft buffers, rows with bufferred changes and their buffers
    # where drafts exist in any of the buffers we replace the value with None
    # we keep track of the path to the where the draft was
    # we do something similar with multilinke, but replace the element in the list with None
    # when it comes to saving these changes, we fill the links and multi links after we've created the drafts

    # we can't hash a draft, use the id, because to equal rows might have different buffered changes
    row_key = id(row)
    if row_key in seen:
        return changes

    seen[row_key] = {}
    buffer = {}
    path_start = "rows"
    index = None

    if _is_draft(row):
        buffer = _copy(row._anvil.buffer)
        index = len(drafts)
        seen[row_key]["index"] = index
        drafts.append(row)
        changes["draft_info"].append(
            {"buffer": buffer, "table_id": row._anvil.table_id}
        )
        path_start = "drafts"

    elif _is_buffered(row):
        buffered.append(row)
        buffer = _copy(row._anvil.buffer)
        if buffer:
            index = len(changes["rows"])
            changes["rows"].append(row)
            changes["buffers"].append(buffer)

    else:
        assert not buffer, "buffer should be empty"

    # now check for any linked drafts
    for key, val in buffer.items():
        if isinstance(val, Row):
            _walk_buffered_changes(
                val,
                changes=changes,
                seen=seen,
                buffered=buffered,
                drafts=drafts,
            )

            if _is_draft(val):
                buffer[key] = None
                val_index = seen[id(val)]["index"]
                path = [path_start, index, key]
                changes["single"].append({"path": path, "row": val_index})

        elif isinstance(val, list):
            has_draft = False
            for i, v in enumerate(val):
                if isinstance(v, Row):
                    _walk_buffered_changes(
                        v,
                        changes=changes,
                        seen=seen,
                        buffered=buffered,
                        drafts=drafts,
                    )

                    if _is_draft(v):
                        has_draft = True
                        val[i] = seen[id(v)]["index"]

            if has_draft:
                changes["multi"].append({"path": [path_start, index, key], "rows": val})
                buffer[key] = None

    if row._anvil.spec is None:
        # we don't have anything in our cache that needs changing
        return

    # we don't need to worry about drafts in the cache
    for val in row._anvil.cache.values():
        if isinstance(val, Row):
            _walk_buffered_changes(
                val,
                changes=changes,
                seen=seen,
                buffered=buffered,
                drafts=drafts,
            )
        elif isinstance(val, list):
            for v in val:
                if isinstance(v, Row):
                    _walk_buffered_changes(
                        v,
                        changes=changes,
                        seen=seen,
                        buffered=buffered,
                        drafts=drafts,
                    )


def _initialize_drafts(server_drafts, drafts):
    # we now walk the rows that need changing
    # we clear the buffer for each row
    # and we update the buffer mode
    # when we have drafts, the response should include capabilities that we need to map to the draft
    assert len(server_drafts) == len(drafts), "Draft count doesn't match response count"
    for server_draft, draft in zip(server_drafts, drafts):
        draft_internal = draft._anvil
        assert draft_internal.table_id == server_draft._anvil.table_id, (
            "Table ids don't match"
        )
        object.__setattr__(draft, "_anvil", _copy(server_draft._anvil))
        draft._anvil.buffer = draft_internal.buffer
        draft._anvil.mode = draft_internal.mode

        # mode switches to the default mode - unless we have explicitly set buffer_changes(True)
        if draft._anvil.mode is _MODE.BUFFERED_DRAFT:
            # explicitly set to buffered mode
            draft._anvil.mode = _MODE.BUFFERED
        elif type(draft)._Row_buffered_:
            draft._anvil.mode = _MODE.BUFFERED
        else:
            draft._anvil.mode = _MODE.NORMAL


def _reset_changes(buffered, drafts):
    for row in buffered:
        row._anvil.buffer.clear()

    for row in drafts:
        row._anvil.buffer.clear()


def save_all(*rows):
    # TODO - only check this on the client
    # but wait for auto batching to be implemented
    if not anvil.is_server_side() and _batcher.batch_update.active:
        raise RuntimeError(
            "Cannot call save() inside a batch_update block on the client"
        )

    changes = {
        "rows": [],
        "buffers": [],
        "draft_info": [],
        "single": [],
        "multi": [],
    }
    drafts = []
    buffered = []
    seen = {}

    for row in rows:
        _walk_buffered_changes(
            row,
            changes=changes,
            drafts=drafts,
            buffered=buffered,
            seen=seen,
        )

    temp_buffers = [{**row._anvil.buffer} for row in buffered]
    _reset_changes(buffered, [])
    server_drafts = []

    try:
        if changes["draft_info"] or changes["rows"]:
            if anvil.is_server_side():
                server_drafts = _save_on_server(changes, False)
            else:
                from ._model import serialize_model

                table_ids = {d["table_id"] for d in changes["draft_info"]}
                models = [serialize_model(id, True) for id in table_ids]
                server_drafts = _batcher.flush_and_call(
                    "anvil.tables.v2._save_on_server", changes, models
                )
    except:
        for row, buffer in zip(buffered, temp_buffers):
            row._anvil.buffer.update(buffer)
        raise

    _initialize_drafts(server_drafts, drafts)
    _reset_changes(buffered, drafts)


def reset_all(*rows):
    changes = {
        "rows": [],
        "buffers": [],
        "draft_info": [],  # {"buffer": dict, "table_id": str}[]
        "single": [],  # {"path": ["rows" | "drafts", index, key], "row": int}
        # the row row is where to find the draft in the draft list
        # the path is the path to the hole that should be replaced by the draft row
        "multi": [],  # {"path": ["rows" | "drafts", index, key], "rows": [Row | int]}
        # the rows is a list of realized rows and ints
        # the ints represent where to find the draft in the draft list
        # the path is the path to the hole that should be replaced by the rows
    }
    drafts = []
    seen = {}
    buffered = []

    for row in rows:
        _walk_buffered_changes(
            row,
            changes=changes,
            drafts=drafts,
            buffered=buffered,
            seen=seen,
        )

    _reset_changes(buffered, drafts)
