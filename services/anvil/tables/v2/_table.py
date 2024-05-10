import anvil.server
from anvil.server import Capability

from .._base_classes import Table as BaseTable
from ._constants import CASCADE, KNOWN_PERMS, READ, SERVER_PREFIX, WRITE
from ._refs import make_refs
from ._row import Row
from ._search import SearchIterator
from ._utils import validate_cap

PREFIX = SERVER_PREFIX + "table."


@anvil.server.portable_class
class Table(BaseTable):
    @classmethod
    def _create(cls, cap, view_key, table_id):
        assert cap is None or type(cap) is Capability, "expected a table capability"
        self = object.__new__(cls)
        self._cap = cap
        self._view_key = view_key
        self._id = str(table_id)
        return self

    @classmethod
    def __new_deserialized__(cls, data, info):
        cap, view_key, table_id = data
        if not info.remote_is_trusted:
            validate_cap(cap, table_id)
        return cls._create(cap, view_key, table_id)

    def __serialize__(self, _info):
        return [self._cap, self._view_key, self._id]

    def __iter__(self):
        raise TypeError("You can't iterate on a table. Call search() on this table to get an iterator of rows instead.")

    def __eq__(self, other):
        if not isinstance(other, Table):
            return NotImplemented
        return other._id == self._id

    def __hash__(self):
        return hash(self._id)

    def __contains__(self, row):
        return self.has_row(row)

    def _get_view(self, perm, args, kws):
        assert perm in KNOWN_PERMS, "bad permission"
        new_cap, view_key = anvil.server.call(
            PREFIX + "get_view", self._cap, perm, None, make_refs(args), make_refs(kws)
        )
        return Table._create(new_cap, view_key, self._id)

    # PUBLIC API
    def restrict_columns(self, col_spec):
        new_cap, view_key = anvil.server.call("get_restricted_columns", self._cap, col_spec)
        return Table._create(new_cap, view_key, self._id)

    def client_readable(self, *args, **kws):
        return self._get_view(READ, args, kws)

    def client_writable(self, *args, **kws):
        return self._get_view(WRITE, args, kws)

    def client_writable_cascade(self, *args, **kws):
        return self._get_view(CASCADE, args, kws)

    def delete_all_rows(self):
        return anvil.server.call(PREFIX + "delete_all_rows", self._cap)

    def add_rows(self, rows):
        # rows can be an iterable of dicts
        row_dicts = []
        refs = []
        for row in rows:
            row = dict(row)
            refs.append(make_refs(row))
            row_dicts.append(row)
        row_id_caps, spec = anvil.server.call(PREFIX + "add_rows", self._cap, refs)
        return [
            Row._create_from_local_values(self._view_key, self._id, row_id, spec, cap, row_items)
            for (row_id, cap), row_items in zip(row_id_caps, row_dicts)
        ]

    def add_row(self, **data):
        row_id, cap, spec = anvil.server.call(PREFIX + "add_row", self._cap, make_refs(data))
        return Row._create_from_local_values(self._view_key, self._id, row_id, spec, cap, data)

    def get(self, *args, **kws):
        row_id_table_data = anvil.server.call(PREFIX + "get_row", self._cap, make_refs(args), make_refs(kws))
        return row_id_table_data and Row._create_from_trusted(self._view_key, self._id, *row_id_table_data)

    def get_by_id(self, row_id, fetch=None):
        row_id_table_data = anvil.server.call(PREFIX + "get_row_by_id", self._cap, row_id, fetch=fetch)
        return row_id_table_data and Row._create_from_trusted(self._view_key, self._id, *row_id_table_data)

    def has_row(self, row):
        if not isinstance(row, Row):
            # backwards compatability return False
            return False
        elif row._table_id != self._id:
            return False
        return anvil.server.call(PREFIX + "has_row", self._cap, row._id)

    def list_columns(self):
        return anvil.server.call(PREFIX + "list_columns", self._cap)

    def search(self, *args, **kws):
        kws = make_refs(kws)
        row_ids, cap, cap_next, table_data = anvil.server.call(PREFIX + "search", self._cap, args, kws)
        return SearchIterator._create(self._view_key, self._id, row_ids, cap, cap_next, table_data)

    def to_csv(self, escape_for_excel=False):
        return anvil.server.call(PREFIX + "to_csv", self._cap, escape_for_excel=escape_for_excel)

    # TODO reinclude this API
    # @property
    # def id(self):
    #     return self._id
