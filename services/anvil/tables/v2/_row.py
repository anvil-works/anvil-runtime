import anvil.server
from anvil.server import Capability

from .._base_classes import Row as BaseRow
from .._errors import NoSuchColumnError, RowDeleted, TableError
from . import _batcher
from ._constants import CAP_KEY, DATETIME, MEDIA, MULTIPLE, NOT_FOUND, SERVER_PREFIX, SHARED_DATA_KEY, SINGLE, UNCACHED
from ._utils import check_serialized, clean_local_datetime, init_spec_rows, init_view_data, merge_row_data, validate_cap

PREFIX = SERVER_PREFIX + "row."
_make_refs = None  # for circular imports
_auto_create_is_enabled = None


@anvil.server.portable_class
class Row(BaseRow):
    @classmethod
    def _create(cls, view_key, table_id, row_id, spec=None, cap=None):
        row = object.__new__(cls)
        row._view_key = view_key
        row._table_id = table_id
        row._id = row_id
        row._cap = cap
        row._cache = {}
        row._spec = spec  # None when we are deserialized without access to table_data
        row._cache_spec = spec["cache"] if spec is not None else []
        row._has_uncached = True
        row._exists = True
        row._dirty_spec = False  # used for serialization
        if cap is not None:
            cap.set_update_handler(row._cap_update_handler)
        return row

    @classmethod
    def _create_from_untrusted(cls, view_key, table_id, row_id, cap, local_data):
        # check that we can trust the data that was sent!
        row = local_data.get(cap)
        if row is None:
            row = local_data[cap] = cls._create(view_key, table_id, row_id, None, cap)
        return row

    @classmethod
    def _create_from_trusted(cls, view_key, table_id, row_id, table_data):
        table_id, row_id = str(table_id), str(row_id)
        view_data = table_data[view_key]
        rows = view_data["rows"]
        row_data = rows[row_id]
        if isinstance(row_data, Row):
            # prevent circular and use the created row from view_data
            return row_data
        spec = view_data["spec"]
        row = rows[row_id] = cls._create(view_key, table_id, row_id, spec)
        # Replace the compact row_data with ourself
        # This prevents circular references and has the benefit that
        # we create the same rows and linked rows when creating Row objects from the same data
        row._unpack(table_data, row_data)
        if view_data.get("dirty_spec"):
            # a serialized row marked its spec as dirty after an update
            row._clear_cache()
        return row

    @classmethod
    def _create_from_local_values(cls, view_key, table_id, row_id, spec, cap, local_items):
        # the basic idea here is that we need to clean datetime objects and UNCACHE any linked rows
        # where the view_key doesn't match what we expect from the col_spec
        table_id, row_id = str(table_id), str(row_id)
        row = cls._create(view_key, table_id, row_id, spec, cap)
        clean_items = row._walk_local_items(local_items, missing=None)
        row._cache.update(clean_items)
        row._check_has_cached()
        return row

    # DESERIALIZE
    @classmethod
    def __new_deserialized__(cls, data, info):
        table_data, local_data = info.shared_data(SHARED_DATA_KEY)
        view_key, table_id, row_id, cap = data
        if not info.remote_is_trusted:
            validate_cap(cap, view_key, table_id, row_id)
            table_data = None  # just incase
        if not table_data:
            # table_data None is not enough because we may be sending rows back and forward
            # i.e. passing from client to server to client goes untrusted -> trusted -> client
            return cls._create_from_untrusted(view_key, table_id, row_id, cap, local_data)
        return cls._create_from_trusted(view_key, table_id, row_id, table_data)

    def _unpack(self, table_data, row_data):
        assert type(row_data) in (list, dict), "Unable to create Row object, bad row_data"
        spec = table_data[self._view_key]["spec"]
        if self._spec is None:
            self._spec = spec
        cols = spec["cols"] if spec is not None else []
        initial_load = not bool(self._cache)
        row_data_type = type(row_data)
        # if the spec is None we must have a dict data type with a single cap key
        # this potentially happens in (and is enforced by) serialization
        if row_data_type is list:
            unpacked_cache, cap = self._unpack_compact(table_data, spec, cols, row_data, initial_load)
        elif row_data_type is dict:
            unpacked_cache, cap = self._unpack_dict(table_data, cols, row_data, initial_load)
        else:
            raise TableError("the row data is invalid")

        assert type(cap) is Capability, "invalid row_data"
        if self._cap is None:
            self._cap = cap
            cap.set_update_handler(self._cap_update_handler)
        self._cache.update(unpacked_cache)
        self._check_has_cached()

    def _unpack_compact(self, table_data, spec, cols, row_data, initial_load):
        # spec["cache"] 1s matches the len(row_data) (+cap)
        iter_row_data = iter(row_data)
        unpacked_cache = {}
        for col, is_cached in zip(cols, spec["cache"]):
            if is_cached:
                val = self._unpack_linked(next(iter_row_data), col, table_data)
            elif initial_load:
                val = UNCACHED  # there's nothing there yet so fill it
            else:
                continue
            unpacked_cache[col["name"]] = val
        return unpacked_cache, next(iter_row_data)

    def _unpack_dict(self, table_data, cols, row_data, initial_load):
        unpacked_cache = {}
        for i, col in enumerate(cols):
            val = row_data.pop(str(i), UNCACHED)
            if val is UNCACHED and not initial_load:
                # does this ever happen?
                continue
            unpacked_cache[col["name"]] = self._unpack_linked(val, col, table_data)
        cap = row_data.pop(CAP_KEY, None)
        assert len(row_data) == 0, "Invalid row data"
        return unpacked_cache, cap

    def _unpack_linked(self, val, col, table_data):
        table_id = col.get("table_id")
        if table_id is None or val is UNCACHED or val is None:
            # not a linked row, or UNCACHED linked row (serialize cache dispute), or linked row is None
            return val
        col_type, view_key = col["type"], col["view_key"]
        if col_type == SINGLE:
            row_id = val
            return Row._create_from_trusted(view_key, table_id, row_id, table_data)
        elif col_type == MULTIPLE:
            row_ids = val
            return [Row._create_from_trusted(view_key, table_id, row_id, table_data) for row_id in row_ids]

        raise AssertionError("bad col type with table_id")

    # SERIALIZATION
    def __serialize__(self, info):
        table_data, local_data = info.shared_data(SHARED_DATA_KEY)
        if table_data is not None and info.local_is_trusted:
            self._merge_and_reduce(table_data, local_data)
        return [self._view_key, self._table_id, self._id, self._cap]

    def _merge_linked(self, val, col, g_table_data, local_data):
        type = col["type"]
        if val is UNCACHED or val is None:
            # maybe we were serialized and converted linked row(s) to UNCACHED
            # or actually the linked row is None
            pass
        elif type == SINGLE:
            row = val
            val = row._merge_and_reduce(g_table_data, local_data)
        elif type == MULTIPLE:
            val = [row._merge_and_reduce(g_table_data, local_data) for row in val]
        return val

    def _make_row_data(self, g_table_data, local_data, cache_spec, adder):
        table_spec = self._spec
        table_cols = table_spec["cols"] if table_spec is not None else []
        cache = self._cache
        # we can't rely on the order of cache in python 2
        for i, (col, is_cached) in enumerate(zip(table_cols, cache_spec)):
            if not is_cached:
                continue
            name = col["name"]
            val = self._merge_linked(cache[name], col, g_table_data, local_data)
            adder(i, val)
        adder(CAP_KEY, self._cap)

    def _merge_and_reduce(self, g_table_data, local_data):
        if check_serialized(self, local_data):
            return int(self._id)
        g_view_data = init_view_data(self._view_key, g_table_data)
        table_spec, row_id, cache_spec = self._spec, self._id, self._cache_spec

        # We assert that there is no way for rows from the same view_key to have different col_specs
        # This includes the order
        # the only thing they may differ on is cached_specs
        g_table_spec, g_table_rows = init_spec_rows(g_view_data, table_spec, cache_spec)
        g_row_data = g_table_rows.get(row_id, [])
        g_cache_spec = g_table_spec["cache"] if g_table_spec is not None else None
        # the local cache spec is always a list
        # so if the g_gable_spec is None then is_compact will always be False
        if table_spec is not None and g_cache_spec is not None:
            is_dirty = self._dirty_spec or len(cache_spec) != len(g_cache_spec)
            is_compact = not is_dirty and cache_spec == g_cache_spec and type(g_row_data) is list
        else:
            is_dirty = self._dirty_spec
            is_compact = False

        if is_compact:
            row_data = []

            def adder(_, val):
                row_data.append(val)

        else:
            row_data = {}

            def adder(index, val):
                row_data[str(index)] = val

        if is_dirty:
            g_view_data["dirty_spec"] = True
            cache_spec = []

        self._make_row_data(g_table_data, local_data, cache_spec, adder)

        merge_row_data(row_id, row_data, g_table_rows, g_table_spec, cache_spec)
        return int(row_id)

    # PRIVATE METHODS
    def _cap_update_handler(self, updates):
        if updates is False:
            # We've been deleted clear_cache so that
            # server calls are required for data access
            self._clear_cache()
            self._exists = False
            return
        elif self._spec is None:
            return
        clean_items = self._walk_local_items(updates)
        self._cache.update(clean_items)
        self._check_has_cached()

    def _check_has_cached(self):
        if self._spec is None:
            return
        self._cache_spec = [int(self._cache[col["name"]] is not UNCACHED) for col in self._spec["cols"]]
        self._has_uncached = any(val is UNCACHED for val in self._cache.values())

    def _clear_cache(self):
        # clearing the cache also clears the spec - this forces a call to the server to update a spec
        self._spec = None
        self._cache.clear()
        self._cache_spec = []
        self._has_uncached = True

    def _fill_cache(self, force=False):
        if force:
            uncached_keys = None if force is True else force
        elif self._spec is None:
            uncached_keys = None
        elif self._has_uncached:
            uncached_keys = [key for key, val in self._cache.items() if val is UNCACHED]
        else:
            return  # no uncached values

        table_data = anvil.server.call(PREFIX + "fetch", self._cap, uncached_keys)
        self._unpack(table_data, table_data[self._view_key]["rows"][self._id])

    def _walk_local_items(self, items, missing=NOT_FOUND):
        # We are about to put local items in the cache
        # so check linked rows have valid view keys datetimes have tz.offset applied
        items = items.copy()
        rv = {}
        cols = self._spec["cols"]
        for col in cols:
            name, type = col["name"], col["type"]
            val = items.pop(name, missing)
            if val is NOT_FOUND:
                continue
            else:
                rv[name] = val
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
            if any(row._view_key != expected_view_key for row in rows):
                rv[name] = UNCACHED
        if len(items):
            # more items than we should have - our col spec is no good anymore
            self._dirty_spec = True
            rv.update(items)
        return rv

    def _check_exists(self):
        # only call this if we're not doing a server call
        if not self._exists:
            raise RowDeleted("This row has been deleted")

    # DUNDER METHODS
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
            raise TypeError("Row columns are always strings, not {}".format(type(key).__name__))
        if self._spec is None:
            self._fill_cache()
        hit = self._cache.get(key, NOT_FOUND)
        if hit is UNCACHED:
            # we have a spec now so we'll fetch the remaining columns
            self._fill_cache()
        elif hit is NOT_FOUND:
            global _auto_create_is_enabled
            if _auto_create_is_enabled is None:
                _auto_create_is_enabled = anvil.server.call(PREFIX + "can_auto_create")
            if _auto_create_is_enabled:
                # try to force fetch this key - incase we have a bad spec - i.e auto-columns
                self._fill_cache([key])
        else:
            return hit
        try:
            return self._cache[key]
        except KeyError:
            raise NoSuchColumnError("No such column '" + key + "'")

    def __setitem__(self, key, value):
        return self.update(**{key: value})

    def __eq__(self, other):
        if not isinstance(other, Row):
            return NotImplemented
        return other._id == self._id and other._table_id == self._table_id

    def __hash__(self):
        self._check_exists()
        return hash((self._table_id, self._id))

    def __repr__(self):
        if self._spec is None:
            return "<anvil.tables.Row object>"

        # custom reprs depending on type
        trunc_str = lambda s: repr(s) if len(s) < 20 else repr(s[:17] + "...")
        dt_repr = lambda d: "datetime(" + str(d) + ")"
        d_repr = lambda d: "date(" + str(d) + ")"
        printable_types = {"string": trunc_str, "bool": repr, "date": d_repr, "datetime": dt_repr, "number": repr}

        # Find cols that are both cached and easily printed
        cache, cols = self._cache, self._spec["cols"]
        cached_printable_cols = [
            (c["name"], printable_types[c["type"]], cache[c["name"]])
            for c in cols
            if c["type"] in printable_types and cache[c["name"]] is not UNCACHED
        ]
        # Only keep the first 5
        cached_printable_cols = cached_printable_cols[:5]
        # Find all the remaining columns
        num_remaning = len(cols) - len(cached_printable_cols)

        vals = ", ".join("{}={}".format(name, None if val is None else meth(val)) for name, meth, val in cached_printable_cols)

        if not num_remaning:
            and_more = ""
        elif cached_printable_cols:
            and_more = ", plus {} more column{}".format(num_remaning, "s" if num_remaning != 1 else "")
        else:
            and_more = "{} column{}".format(num_remaning, "s" if num_remaning != 1 else "")

        return "<anvil.tables.Row: {}{}>".format(vals, and_more)

    # PUBLIC API
    # deprecated
    def get_id(self):
        # For compatibility with LiveObjects
        self._check_exists()
        return "[{},{}]".format(self._table_id, self._id)

    # TODO reinclude this api
    # @property
    # def id(self):
    #     return self._id

    # TODO reinclude this api
    # @property
    # def table_id(self):
    #     return self._table_id

    def keys(self):
        if self._spec is None:
            # if we don't have a _spec we don't have any keys
            # but we don't need to blindly call _fill_uncached: UNCACHED values are fine
            self._fill_cache()
        return self._cache.keys()

    def items(self):
        self._fill_cache()
        return self._cache.items()

    def values(self):
        self._fill_cache()
        return self._cache.values()

    def update(self, other=(), **new_items):
        if other != ():
            new_items = dict(other, **new_items)
        if not new_items:
            # backwards compatability hack
            self._clear_cache()
            return

        # circular reference
        if _batcher.batch_update.active:
            return _batcher.batch_update.push(self._cap, new_items)

        global _make_refs
        if _make_refs is None:
            from ._refs import make_refs  # circular import

            _make_refs = make_refs

        anvil.server.call(PREFIX + "update", self._cap, _make_refs(new_items))
        self._cap.send_update(new_items)

    def delete(self):
        if _batcher.batch_delete.active:
            return _batcher.batch_delete.push(self._cap)

        anvil.server.call(PREFIX + "delete", self._cap)
        self._cap.send_update(False)


class RowIterator:
    def __init__(self, row):
        self._row = row
        self._fill_required = row._spec is None
        self._iter = iter(row._cache.items())

    def __iter__(self):
        return self

    def __next__(self):
        if self._fill_required:
            self._row._fill_cache()
            self.__init__(self._row)
        item = next(self._iter)
        if item[1] is not UNCACHED:
            return item
        self._row._fill_cache()
        # fill the rest of the cache
        # since we probably want all the items!
        key = item[0]
        # we rely here on the _cache keys not changing during iteration
        # which works since we've filled it with UNCACHED values that match our expected keys
        return (key, self._row._cache[key])

    next = __next__
