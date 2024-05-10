import anvil.server
from anvil.server import Capability

from .._base_classes import SearchIterator as BaseSearchIterator
from ._constants import CAP_KEY, SERVER_PREFIX, SHARED_DATA_KEY
from ._row import Row
from ._utils import check_serialized, init_spec_rows, init_view_data, merge_row_data, validate_cap

PREFIX = SERVER_PREFIX + "search."


class PartialSearchIter(object):
    def __init__(self, s, slice_):
        self._view_key = s._view_key
        self._table_id = s._table_id
        self._cap = s._cap
        self._idx = slice_.start or 0
        self._step = slice_.step or 1
        self._stop = slice_.stop
        row_ids, cap_next = s._row_ids, s._cap_next
        if row_ids is None:
            # this can happen in deserialization from untrusted/None transmited data
            row_ids, cap_next = [], s._cap
        assert cap_next is None or type(cap_next) is Capability
        self._reset(row_ids, cap_next, s._table_data)

    def _reset(self, row_ids, cap_next, table_data):
        if self._stop is not None and len(row_ids) > self._stop:
            row_ids, cap_next = row_ids[: self._stop], None
        self._row_ids = row_ids
        self._cap_next = cap_next
        self._table_data = table_data

    def _iter_next_page(self):
        if self._cap_next is None:
            raise StopIteration

        num_row_ids = len(self._row_ids)
        self._idx -= num_row_ids
        if self._stop is not None:
            self._stop -= num_row_ids

        row_ids, cap_next, table_data = anvil.server.call(PREFIX + "next_page", self._cap_next)

        self._reset(row_ids, cap_next, table_data)
        return self.__next__()

    def __iter__(self):
        return self

    def __next__(self):
        try:
            row_id = self._row_ids[self._idx]
        except IndexError:
            return self._iter_next_page()
        self._idx += self._step
        return Row._create_from_trusted(self._view_key, self._table_id, row_id, self._table_data)

    next = __next__


@anvil.server.portable_class
class SearchIterator(BaseSearchIterator):
    @classmethod
    def _create(cls, view_key, table_id, row_ids, cap, cap_next, table_data):
        self = object.__new__(cls)
        assert cap_next is None or type(cap_next) is Capability
        self._view_key = view_key
        self._table_id = table_id
        self._row_ids = row_ids
        self._cap = cap
        self._cap_next = cap_next
        self._table_data = table_data
        self._from_serialize = False
        return self

    @classmethod
    def __new_deserialized__(cls, data, info):
        view_key, table_id, row_ids, cap, cap_next = data
        table_data, _ = info.shared_data(SHARED_DATA_KEY)
        if not info.remote_is_trusted:
            validate_cap(cap, table_id)
            table_data = None
        if not table_data:
            row_ids = cap_next = None
        # when we deserialize ourselves we may have more data than we need
        self = cls._create(view_key, table_id, row_ids, cap, cap_next, table_data)
        self._from_serialize = True
        return self

    def _fill_data(self):
        self._row_ids, self._cap_next, self._table_data = anvil.server.call(PREFIX + "next_page", self._cap)

    def _clear_cache(self):
        self._row_ids = self._table_data = self._cap_next = None

    # SERIALIZATION
    def _make_row_data(self, row_data, table_spec, compact=True):
        if type(row_data) is dict or compact:
            # this row didn't match our cache_spec so just send it
            # or we are list and we're compact because our cache_specs already match
            return row_data

        cache_spec = table_spec["cache"]
        # we are currently compact and we need to be a dict
        new_data = {CAP_KEY: row_data[-1]}
        iter_row_data = iter(row_data)

        new_data = {str(i): next(iter_row_data) for i, is_cached in enumerate(cache_spec) if is_cached}
        cap = next(iter_row_data)
        assert type(cap is Capability)
        new_data[CAP_KEY] = cap
        return new_data

    def _get_table_view_iter(self):
        if not self._from_serialize:
            # Fast Path - we were created from my_table.search() so the table_data is already minimal
            # i.e. we don't need to clean it based on table_specs
            return self._table_data.keys()

        # Slow Path - we're reserializing ourselves from a previous serialization
        # so we may have too much data if we were serialized with merged table_data
        table_view_keys = set()
        # walk the table_specs and insert the view_keys and table_ids we need
        _populate_table_views_ids(self._view_key, self._table_data, table_view_keys)
        return table_view_keys

    def _merge(self, g_table_data, local_data):
        if check_serialized(self, local_data):
            return

        table_view_keys = self._get_table_view_iter()

        for view_key in table_view_keys:
            g_view_data = init_view_data(view_key, g_table_data)
            l_view_data = self._table_data[view_key]

            l_table_spec, l_table_rows = l_view_data["spec"], l_view_data.get("rows", {})
            g_table_spec, g_table_rows = init_spec_rows(g_view_data, l_table_spec)

            g_cache_spec = g_table_spec["cache"]
            l_cache_spec = l_table_spec["cache"]
            cache_match = g_table_spec is l_table_spec or g_cache_spec == l_cache_spec

            for row_id, row_data in l_table_rows.items():
                if isinstance(row_data, Row):
                    # Ok we've already been created
                    # this is rare - we've consumed the search iterator and now we're serializing
                    # or we created this row from shared serialization data and we're now reserializing
                    row = row_data
                    row._merge_and_reduce(g_table_data, local_data)
                    continue

                g_row_data = g_table_rows.get(row_id, [])
                g_is_compact = cache_match and type(g_row_data) is list
                row_data = self._make_row_data(row_data, l_table_spec, compact=g_is_compact)
                merge_row_data(row_id, row_data, g_table_rows, g_table_spec, l_cache_spec)

    def __serialize__(self, info):
        table_data, local_data = info.shared_data(SHARED_DATA_KEY)
        row_ids = self._row_ids
        if table_data is None:
            row_ids = self._cap_next = None
        elif info.local_is_trusted and self._table_data is not None:
            self._merge(table_data, local_data)
        return [self._view_key, self._table_id, row_ids, self._cap, self._cap_next]

    def _make_partial_iterator(self, slice_=slice(None)):
        return PartialSearchIter(self, slice_)

    def __iter__(self):
        return self._make_partial_iterator()

    def __len__(self):
        if self._cap_next is None and self._row_ids is not None:
            return len(self._row_ids)
        return anvil.server.call(PREFIX + "get_length", self._cap)

    def __hash__(self):
        return hash((self._table_id, self._cap))

    def __eq__(self, other):
        if not isinstance(other, SearchIterator):
            return NotImplemented
        return self._cap == other._cap

    def __bool__(self):
        # because we have a __len__ and we can't suspend
        return True

    __nonzero__ = __bool__

    def refresh(self):
        self._clear_cache()

    def to_csv(self, escape_for_excel=False):
        return anvil.server.call(PREFIX + "to_csv", self._cap, escape_for_excel=escape_for_excel)

    def delete_all_rows(self):
        result = anvil.server.call(PREFIX + "delete_all", self._cap)
        self._clear_cache()
        return result

    def __getitem__(self, idx):
        if self._row_ids is None:
            self._fill_data()

        if isinstance(idx, slice):
            slice_ = slice(as_slice_idx(idx.start), as_slice_idx(idx.stop), as_slice_idx(idx.step))
            return self._make_partial_iterator(slice_)
        else:
            slice_ = slice(as_idx(idx), None)
        try:
            return next(self._make_partial_iterator(slice_))
        except StopIteration:
            raise IndexError("search index out of range")


def as_idx(i, msg="search indices must be non-negative integers", can_be_none=False):
    if i is None and can_be_none:
        return None
    elif type(i) is int:
        pass
    elif hasattr(i, "__index__"):
        i = i.__index__()
    else:
        raise TypeError(msg)
    if i < 0:
        raise ValueError(msg)
    return i


def as_slice_idx(i):
    msg = "search slice indices must non-negative itegers (or None)"
    return as_idx(i, msg, True)


def _populate_table_views_ids(view_key, table_data, seen):
    # We might hold too much data if our table_data was from another serialization
    # If we're reserializing ourselves then this method prevents sending unnecessary data across the wire
    if view_key in seen:
        # prevent circular references
        return

    try:
        table_spec = table_data[view_key]["spec"]
    except KeyError:
        # Then these linked rows were not included in the data - probably uncached from the cache spec
        # don't try include this view_key when serializing the data
        return

    seen.add(view_key)
    cols = table_spec["cols"]

    for col in cols:
        view_key = col.get("view_key")
        if view_key is None:
            continue
        _populate_table_views_ids(view_key, table_data, seen)
