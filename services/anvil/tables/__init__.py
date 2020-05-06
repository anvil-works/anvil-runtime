import anvil.server
import time, random

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


app_tables = AppTables()


#!defClass(anvil.tables,TableError)!:
class TableError(anvil.server.AnvilWrappedError):
	pass


#!defClass(anvil.tables,TransactionConflict,anvil.tables.TableError)!:
class TransactionConflict(TableError):
	pass


#X NOT AUTOCOMPLETED defClass(anvil.tables,QuotaExceededError,anvil.tables.TableError)!:
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
#!defClass(anvil.tables,Transaction)!:


def in_transaction(f):
	def new_f(*args, **kwargs):
		n = 0
		while True:
			try:
				with Transaction():
					return f(*args, **kwargs)
			except TransactionConflict:
				n += 1
				if n == 8:
					raise
				# Max total sleep time is a little under 12.8 seconds (avg 6.4)
				sleep_amt = random.random() * (2**n) * 0.05
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
@anvil.server.serializable_type
class order_by(object):
	def __init__(self, column_name, ascending=True):
		self.column_name = column_name
		self.ascending = ascending

@anvil.server.serializable_type
class _page_size(object):
	def __init__(self, rows):
		self.rows = rows
