from pprint import pprint

from dataclasses import dataclass
from functools import partial

from sqlalchemy.engine import CursorResult, Row
from sqlalchemy.sql import Selectable, quoted_name
from typing import Tuple, Dict, Optional, List, Iterable, cast, Any, _SpecialForm
from sqlalchemy import MetaData, Engine, select, insert, update, delete, Table, Column, ForeignKey, \
    ForeignKeyConstraint, values, column, join, and_, bindparam
from datetime import date, datetime
import anvil.server
from .. import SchemaImpl, CollectionDef, RecordId, FetchContext, FieldDef, UnfollowedLink, RecordDataValue
from ... import Record

try:
    # For Python 3.7 - wrap Literal in ''

    from typing import Literal
except ImportError:
    pass



class SQLTables:
    # The entry point to this API. Initialise with an SQLAlchemy Engine object, then it behaves
    # a little like anvil.tables.app_tables.
    def __init__(self, schema_name: str, engine: Engine, metadata: Optional[MetaData] = None):
        impl = _DBTablesImpl(schema_name, engine, metadata)
        object.__setattr__(self, "impl", impl)

    def __getattribute__(self, name):
        tbl = object.__getattribute__(self, "impl").get_table(name)
        if tbl is None:
            raise AttributeError(name)
        return tbl

    def __setattr__(self, key, value):
        raise TypeError("This object is read-only")


class SQLTable:
    def __init__(self, impl: "_TableImpl"):
        self._impl = impl

    @property
    def meta_table(self):
        return self._impl.table

    def search(self, query: Selectable):
        """Search with a raw query"""
        ctx = self._impl.dbti.schema.get_fetch_context(self._impl.table.name)
        with ctx.record_builder() as rb:
            rb.add_records(self._impl.load_records_from_query(query, ctx))
            return rb.get_record_list()

    def add_row(self, **values):
        """Insert a row with the collection's interpretation of fields"""
        ctx = self._impl.dbti.schema.get_fetch_context(self._impl.table.name)
        return self._impl.add_rows([values], ctx)


class _DBTablesImpl:
    def __init__(self, schema_name: str, engine: Engine, metadata: Optional[MetaData]):
        self.engine = engine
        if metadata is None:
            self.md = MetaData()
            self.md.reflect(bind=engine)
        else:
            self.md = metadata
        self.table_facades: Dict[str, SQLTable] = {}
        self.tables: Dict[str, "_TableImpl"] = {}
        self.collections: Dict[str, CollectionDef] = {}
        self._setup_collections()

        self.schema = SchemaImpl(schema_name, list(self.collections.values()))

    @dataclass
    class Link:
        field_name: str
        fkc: ForeignKeyConstraint
        link_multi: bool # forward only; reverse is always multi
        backward: bool

        @property
        def field_type(self):
            field_type: 'Literal["link_multiple", "link_single"]' = "link_multiple" if self.link_multi else "link_single"
            return field_type

    def _setup_collections(self):
        links_by_collection: Dict[str, Dict[str, _DBTablesImpl.Link]] = {}

        # First, collect a list of all FKs
        # foreign_keys_by_target: Dict[str,List[ForeignKeyConstraint]] = {}
        for table in self.md.tables.values():
            for fkc in table.foreign_key_constraints:

                link_multi = set(fk.column for fk in fkc.elements) != set(fkc.referred_table.primary_key)
                link_name_base = "_".join(fkc.column_keys)
                forward_link = _DBTablesImpl.Link(link_name_base, fkc, link_multi, False)
                backward_link = _DBTablesImpl.Link(f"{fkc.table.name}.{link_name_base}", fkc, True, True)
                links_by_collection.setdefault(fkc.table.name, {})[forward_link.field_name] = forward_link
                links_by_collection.setdefault(fkc.referred_table.name, {})[backward_link.field_name] = backward_link

        # Now let's set up fields from columns and links
        for table in self.md.tables.values():
            if not table.primary_key:
                print(f"No primary key for table {table.name}")
                continue

            columns = cast(Iterable[Column], table.columns)
            fields: Dict[str,FieldDef] = {}

            cols_from_id = {col.name: idx for idx, col in enumerate(table.primary_key)}
            for column in columns:
                fields[column.name] = FieldDef(name=column.name, type="object",
                                               from_id=cols_from_id.get(column.name, False))

            links = links_by_collection.get(table.name, {})
            for link in links.values():
                field = fields.setdefault(link.field_name, FieldDef(link.field_name, "object"))
                field.type = "link_multiple" if link.link_multi else "link_single"
                field.link_target = link.fkc.table.name if link.backward else link.fkc.referred_table.name
                fields[field.name] = field

            table_impl = _TableImpl(self, table, fields, links)
            self.collections[table.name] = table_impl.collection
            self.tables[table.name] = table_impl
            self.table_facades[table.name] = SQLTable(table_impl)

    def get_table(self, name: str):
        return self.table_facades.get(name)


class _TableImpl:
    def __init__(self, dbti: _DBTablesImpl, table: Table, fields: Dict[str,FieldDef],
                 links: Dict[str, _DBTablesImpl.Link]):
        self.dbti = dbti
        self.table = table
        self.links = links

        for link in links.values():
            if link.link_multi:
                fields[link.field_name].follow_links_multiple = partial(self.follow_links_multiple, link)
            else:
                fields[link.field_name].follow_links_single = partial(self.follow_links_single, link)

        self.collection = CollectionDef(table.name, fields=list(fields.values()), load_records=self.load_records,
                                        update_records=self.update_records, delete_record=self.delete_record)

    def _get_column_names_of_interest(self, ctx: FetchContext) -> List[str]:
        pk_cols = set(self.table.primary_key)
        return [col.name for col in self.table.columns if col in pk_cols or ctx[col.name]]

    def _values_from_row(self, r: Row, col_names_of_interest: List[str], ctx: FetchContext) -> Iterable[RecordDataValue]:
        # print("CNOI =", col_names_of_interest, "ctx =", ctx)
        # print("links =", self.links)
        rm = r._mapping
        rdata = {col_name: rm[col_name]
                 for col_name in col_names_of_interest if col_name in rm}
        for link in self.links.values():
            follow_by_default = not link.link_multi
            if ctx.walk(link.field_name, follow_by_default):
                cols = [fk.column for fk in link.fkc.elements] if link.backward else link.fkc.columns
                rdata[link.field_name] = UnfollowedLink(tuple([rm[col.name] for col in cols]))
            else:
                rdata.pop(link.field_name, None)
        return rdata

    def _load_by_cols(self, lookup_cols: Iterable[Column], lookup_values: List[Tuple], ctx: FetchContext):
        with self.dbti.engine.connect() as conn:
            stmt = select(self.table) # TODO trim columns
            if len(lookup_cols) == 1:
                col = next(iter(lookup_cols))
                stmt = stmt.filter(col.in_([i[0] for i in lookup_values]))
            else:
                valcols = [column(col.name) for col in self.table.primary_key]
                stmt = stmt.select_from(
                    join(self.table, values(*valcols).data(lookup_values)),
                    and_(*[pkcol == valcol for pkcol, valcol in zip(self.table.primary_key, valcols)])
                )

            col_names_of_interest = self._get_column_names_of_interest(ctx)

            result = conn.execute(stmt)
            # result = list(result)
            # print("Result =", [r._mapping for r in result])


            data_by_lookup_value: Dict[RecordId,List[Tuple[RecordId,RecordDataValue]]] = {}

            for row in result:
                lookup_value = tuple([row._mapping[col.name] for col in lookup_cols])
                primary_key = tuple([row._mapping[col.name] for col in self.table.primary_key]) \
                    if lookup_cols is not self.table.primary_key else lookup_value
                rdata = self._values_from_row(row, col_names_of_interest, ctx)
                data_by_lookup_value.setdefault(lookup_value, []).append((primary_key, rdata))

            # print("Gathered values =", data_by_lookup_value)

            return data_by_lookup_value

    def load_records(self, ids: List[RecordId], ctx: FetchContext):
        data_by_pk = self._load_by_cols(self.table.primary_key, ids, ctx)

        output: List[RecordDataValue] = []
        for i in ids:
            i = tuple(i)
            rvalues = data_by_pk.get(i)
            if not rvalues: # empty or None
                raise ValueError(f"Record {ids!r} has been deleted")
            elif len(rvalues) > 1:
                pk_names = ",".join(col.name for col in self.table.primary_key)
                raise ValueError(f"{len(rvalues)} records returned for primary key {self.table.name}[{pk_names}]")
            output.append(rvalues[0][1])

        return output

    def load_records_from_query(self, query: Selectable, ctx: FetchContext):
        col_names_of_interest = self._get_column_names_of_interest(ctx)
        with self.dbti.engine.connect() as conn:
            result = conn.execute(query)
            # result = list(result)
            # print("Query result =", result)
            rvalues = [(tuple([row._mapping[col.name] for col in self.table.primary_key]),
                        self._values_from_row(row, col_names_of_interest, ctx))
                       for row in result]
            # rvalues = list(rvalues)
            # print("Query rvalues =", rvalues)
            return rvalues

    def follow_links_single(self, link: _DBTablesImpl.Link, link_values: List[Tuple], ctx: FetchContext):
        other_table = link.fkc.table.name if link.backward else link.fkc.referred_table.name
        return self.dbti.tables[other_table]._follow_links_single(link, link_values, ctx)

    def follow_links_multiple(self, link: _DBTablesImpl.Link, link_values: List[Tuple], ctx: FetchContext):
        other_table = link.fkc.table.name if link.backward else link.fkc.referred_table.name
        return self.dbti.tables[other_table]._follow_links_multiple(link, link_values, ctx)

    def _follow_links_multiple(self, link: _DBTablesImpl.Link, link_values: List[Tuple], ctx: FetchContext):
        lookup_cols = link.fkc.columns if link.backward else [e.column for e in link.fkc.elements]

        data_by_lookup_value = self._load_by_cols(lookup_cols, link_values, ctx)

        rv: List[List[Tuple[RecordId,RecordDataValue]]] = [data_by_lookup_value.get(lv,[]) for lv in link_values]
        return rv

    def _follow_links_single(self, link: _DBTablesImpl.Link, link_values: List[Tuple], ctx: FetchContext):
        lookup_cols = link.fkc.columns if link.backward else [e.column for e in link.fkc.elements]

        data_by_lookup_value = self._load_by_cols(lookup_cols, link_values, ctx)

        rv: List[Tuple[RecordId,RecordDataValue]] = []
        for lv in link_values:
            rvalues = data_by_lookup_value.get(lv)
            if not rvalues: # empty or none
                raise ValueError(f"Record {lv!r} has been deleted")
            elif len(rvalues) > 1:
                lc_names = ",".join(col.name for col in lookup_cols)
                raise ValueError(f"{len(rvalues)} records returned for primary key {self.table.name}[{lc_names}")

            rv.append(rvalues[0])

        return rv

    def _row_from_values(self, values: Dict[str, Any], ctx: Optional[FetchContext] = None):
        row_values = {}

        for field_name, value in values.items():
            field = self.collection.fields_by_name.get(field_name)
            if field is None or ctx is not None and not ctx[field_name]:
                # this is only relevant for add_row because we're DIYing; updates come pre-filtered
                # (and tbh we should probably implement common machinery for collection objects anyway)
                raise TypeError(f"'{field_name}' is not a writable field")

            link = self.links.get(field_name)
            if link:
                if link.link_multi:
                    raise TypeError(f"Cannot set value of link-to-multiple field '{field_name}' in table '{self.table.name}'")
                other_table = link.fkc.referred_table if not link.backward else link.fkc.table
                if not self.dbti.schema.record_belongs_to_collection(value, other_table.name):
                    raise ValueError(f"Field '{field_name}' must be set to a record from '{other_table.name}'")

                column_pairs = [(our_col, e.column) for our_col, e in zip(link.fkc.columns, link.fkc.elements)]
                # For a link-to-single, all of "their" columns must be in the primary key, so we can grab them
                # from the target record's ID
                assert all(their_col in list(other_table.primary_key) for our_col, their_col in column_pairs)
                pk_vals = {pkc.name: pkv for pkc, pkv in zip(self.table.primary_key, value.id)}

                row_values.update({our_col.name: pk_vals[their_col.name] for our_col, their_col in column_pairs})
            else:
                row_values[field_name] = value

        return row_values

    def update_records(self, updates: List[Tuple[RecordId,Dict[str, Any]]]):
        update_data = []
        for record_id, record_update in updates:
            row = self._row_from_values(record_update)

            for pkc, id_v in zip(self.table.primary_key, record_id):
                if pkc.name in row:
                    if row[pkc.name] != id_v:
                        raise ValueError(f"Cannot update primary key column {pkc.name}")
                    else:
                        del row[pkc.name]
                row["_anvil_pk_"+pkc.name] = id_v

            update_data.append(row)

        with self.dbti.engine.connect() as conn:
            r = conn.execute(
                update(self.table).where(and_(*[pkc == bindparam("_anvil_pk_"+pkc.name) for pkc in self.table.primary_key])),
                update_data
            )
            if r.rowcount != len(update_data):
                raise ValueError("Record(s) deleted and could not updated")

            conn.commit()

        return [u for _, u in updates]

    def delete_record(self, id: RecordId):
        with self.dbti.engine.connect() as conn:
            conn.execute(delete(self.table).where(
                *(pkcol == value for pkcol, value in zip(self.table.primary_key, id)))
            )
            conn.commit()

    def add_rows(self, values: List[Dict[str, Any]], ctx: FetchContext):
        with self.dbti.engine.connect() as conn:
            result = conn.execute(insert(self.table), [self._row_from_values(v) for v in values])
            conn.commit()
        return self.dbti.schema.load_records(ctx, [tuple(pk) for pk in result.inserted_primary_key_rows])
