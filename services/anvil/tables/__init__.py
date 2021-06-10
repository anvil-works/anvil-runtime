import anvil.server
import time

# Hack: Force ourselves into the top-level package, even
# if we were loaded into a runtime-v1 per-app Anvil package
__package__ = "anvil.tables"
__name__ = "anvil.tables"

class AppTables:
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


#!defModuleAttr(anvil.tables)!1: 
# {
# 	name: "app_tables",
#	type: "any",
# 	anvil$helpLink: "/docs/data-tables/data-tables-in-code",
# 	$doc: "Access Table objects from the datatables services. You can access a Table object with dot notation e.g. `app_tables.my_table`. To access a table with strings use `getattr(app_tables, 'my_table')`. If no table is present an AttributeError will be thrown."
# }
#
app_tables = AppTables()


#!defClass(anvil.tables,TableError,__builtins__..Exception)!:
class TableError(anvil.server.AnvilWrappedError):
	pass


#!defClass(anvil.tables,TransactionConflict,anvil.tables.TableError)!:
class TransactionConflict(TableError):
	pass


#!defClass(anvil.tables,#QuotaExceededError,anvil.tables.TableError)!:
class QuotaExceededError(TableError):
	pass


anvil.server._register_exception_type("anvil.tables.TransactionConflict", TransactionConflict)
anvil.server._register_exception_type("anvil.tables.TableError", TableError)
anvil.server._register_exception_type("anvil.tables.QuotaExceededError", QuotaExceededError)


class Transaction:
	def __init__(self):
		self._aborting = False

	#!defMethod(anvil.tables.Transaction instance)!2: "Begin the transaction" ["__enter__"]
	def __enter__(self):
		anvil.server.call("anvil.private.tables.open_transaction")
		return self

	#!defMethod(_)!2: "End the transaction" ["__exit__"]
	def __exit__(self, e_type, e_val, tb):
		anvil.server.call("anvil.private.tables.close_transaction", self._aborting or e_val is not None)

	#!defMethod(_)!2: "Abort this transaction. When it ends, all write operations performed during it will be cancelled" ["abort"]
	def abort(self):
		self._aborting = True
#!defClass(anvil.tables,%Transaction)!:


#!defFunction(anvil.tables,%,function,server_function)!2: 
# {
#	$doc: "When applied to a function (as a decorator), the whole function will run in a data tables transaction. If it conflicts with another transaction, it will retry up to five times.",
# anvil$helpLink: "/docs/data-tables/transactions"
#  } ["in_transaction"]
def in_transaction(f):
	def new_f(*args, **kwargs):
		n = 0
		while True:
			try:
				with Transaction():
					return f(*args, **kwargs)
			except TransactionConflict:
                # lazy load random incase we make random.js a slow path on the client
				import random
				n += 1
				if n == 18:
					raise
				#print(f"RETRYING TXN {n}")
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

	new_f.__name__ = f.__name__

	return new_f


#!defFunction(anvil.tables,_,column_name,ascending=)!2: "Sort the results of this table search by a particular column. Default to ascending order." ["order_by"]
@anvil.server.portable_class
class order_by(object):
	def __init__(self, column_name, ascending=True):
		self.column_name = column_name
		self.ascending = ascending

@anvil.server.portable_class
class _page_size(object):
	def __init__(self, rows):
		self.rows = rows


#!defFunction(anvil.tables,%,[via_host=],[via_port=])!2: "Get a Postgres connection string for accessing this app's Data Tables via SQL.\n\nThe returned string includes temporary login credentials and sets the search path to a schema representing this app's Data Table environment.\n\nYou can override the host and port for the database connection to connect via a secure tunnel.\n\n(Available on the Dedicated Plan only.)" ["get_connection_string"]
def get_connection_string(via_host=None, via_port=None):
	return anvil.server.call("anvil.private.get_direct_postgres_connection_string", via_host=via_host, via_port=via_port)




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
#!defMethod(Media object)!2: "Get the table in CSV format. Returns a downloadable Media object; use its url property." ["to_csv"]
#!defClassNoConstructor(anvil.tables,#Table)!1: "A table returned from app_tables"

#!defMethod(Media object)!2: "Get the results of the SearchIterator in CSV format. Returns a downloadable Media object; use its url property." ["to_csv"]
#!defClassNoConstructor(anvil.tables,#SearchIterator)!1: "An iterator of table rows returned from a search()";


#!defMethod(_)!2: "Delete the row from its data table" ["delete"]
#!defMethod(id)!2: "Get the unique ID of the table row" ["get_id"]
#!defMethod(_,**column_values)!2: "update the data for multiple columns" ["update"]
#!defClassNoConstructor(anvil.tables,#Row)!1: "A table row";
