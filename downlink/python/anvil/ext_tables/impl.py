from sqlalchemy import MetaData, Engine, select, insert, update, delete
from . import DatabaseImpl, Table, TableInfo, Row
import anvil.server
from anvil.server import unwrap_capability, Capability
from datetime import date, datetime


class Database(DatabaseImpl):
    def __init__(self, db_name: str, engine: Engine):
        self.db_name = db_name
        self.engine = engine
        self.md = MetaData()
        self.md.reflect(bind=engine)
        self.table_info = {table.name: ConcreteTableInfo(self, table)
                           for table in self.md.tables.values()}
        # In future, we will do clever things like detecting foreign key relationships

    def search(self, table: TableInfo):
        with self.engine.connect() as conn:
            real_table = self.md.tables[table.name]
            result = conn.execute(select(real_table))
            colnames = [col.key for col in real_table.columns]
            return [Row(table=table, data={name: row[name] for name in colnames}) for row in result.mappings()]

    def add_row(self, table: TableInfo, data: dict):
        with self.engine.connect() as conn:
            real_table = self.md.tables[table.name]
            result = conn.execute(insert(real_table).values(**data))

            # Fill in primary key
            for col, value in zip(table.primary_key, result.inserted_primary_key):
                data[col] = value

            conn.commit()

            return Row(data=data, table=table)

    def update_row(self, table: TableInfo, primary_key: tuple, updates: dict):
        if not primary_key:
            raise TypeError(f"The \"{table.name}\" table has no PRIMARY KEY and therefore cannot be updated")
        if any(col in updates for col in table.primary_key):
            raise ValueError("Cannot change the primary key of a row")
        with self.engine.connect() as conn:
            real_table = self.md.tables[table.name]
            conn.execute(update(real_table).where(*(col == val for col,val in zip(real_table.primary_key.columns, primary_key))).values(updates))
            conn.commit()

    def delete_row(self, table: TableInfo, primary_key: tuple):
        if not primary_key:
            raise TypeError(f"The \"{table.name}\" table has no PRIMARY KEY and therefore cannot be updated")
        with self.engine.connect() as conn:
            real_table = self.md.tables[table.name]
            conn.execute(delete(real_table).where(*(col == val for col,val in zip(real_table.primary_key.columns, primary_key))))
            conn.commit()


class ConcreteTableInfo(TableInfo):
    def __init__(self, db: Database, real_table):
        pk = tuple(col.name for col in real_table.primary_key.columns)
        columns = {col.name: {} for col in real_table.columns}
        super().__init__(db_name=db.db_name, name=real_table.name, primary_key=pk, columns=columns, db=db)

    @property
    def safe_version(self):
        return TableInfo(self.db.db_name, self.name, self.primary_key, self.columns, None)


class ExternalTablesImpl:
    def __init__(self, db_name, engine):
        self.db = Database(db_name, engine)
        setup_callables(self.db)

    def get_table(self, name):
        if name in self.db.table_info:
            return Table(info=self.db.table_info[name])


class ExternalTables:
    # The entry point to this API. Initialise with an SQLAlchemy Engine object, then it behaves
    # like anvil.tables.app_tables.
    def __init__(self, name, engine):
        et_impl = ExternalTablesImpl(name, engine)
        object.__setattr__(self, "impl", et_impl)

    def __getattribute__(self, name):
        tbl = object.__getattribute__(self, "impl").get_table(name)
        if tbl is None:
            raise AttributeError(name)
        return tbl

    def __setattr__(self, key, value):
        raise TypeError("This object is read-only")


KNOWN_COLUMN_TYPES = {
    str: "string",
    bool: "bool",
    date: "date",
    datetime: "datetime",
    int: "number",
    float: "number",
}

def setup_callables(db: Database):
    @anvil.server.callable("anvil.ext_tables.search/"+db.db_name)
    def search(cap):
        _, table_name = anvil.server.unwrap_capability(cap, ["ext_tables/"+db.db_name, Capability.ANY])
        return db.search(db.table_info[table_name])

    @anvil.server.callable("anvil.ext_tables.add_row/"+db.db_name)
    def add_row(cap, data):
        _, table_name = anvil.server.unwrap_capability(cap, ["ext_tables/"+db.db_name, Capability.ANY])
        return db.add_row(db.table_info[table_name], data)

    @anvil.server.callable("anvil.ext_tables.update_row/"+db.db_name)
    def update_row(cap, updates):
        _, table_name, primary_key = anvil.server.unwrap_capability(cap, ["ext_tables/"+db.db_name, Capability.ANY, Capability.ANY])
        db.update_row(db.table_info[table_name], primary_key, updates)

    @anvil.server.callable("anvil.ext_tables.delete_row/"+db.db_name)
    def delete_row(cap):
        _, table_name, primary_key = anvil.server.unwrap_capability(cap, ["ext_tables/"+db.db_name, Capability.ANY, Capability.ANY])
        db.delete_row(db.table_info[table_name], primary_key)

    @anvil.server.callable("anvil.record_schema.get/anvil.ext_tables."+db.db_name)
    def get_schema():
        return {
            "name": "An SQL database",
            "record_types": [
                {"id": name, "name": name, "fields": [
                    {"key": col.key, "type": KNOWN_COLUMN_TYPES[col.type.python_type]}
                    for col in table.columns
                    if col.type.python_type in KNOWN_COLUMN_TYPES
                ]}
                for name, table in db.md.tables.items()
            ]
        }