import anvil.tables as tables
import anvil.tables.query as q
from anvil.tables import app_tables
import anvil.tables.query as q
import anvil.server


@anvil.server.callable
def add_line_to_db(string):
    return app_tables.table_1.add_row(Column1=string)["Column1"]


@anvil.server.callable
def count_rows():
    return len(app_tables.table_1.search(q.all_of()))
