import anvil.server


#!defMethod()!2: "Superclass of all table exceptions" ["__init__"]
#!defClass(anvil.tables,TableError,__builtins__..Exception)!:
class TableError(anvil.server.AnvilWrappedError):
    pass


#!defMethod()!2: "Raised when attempting to accessing a table row that has been deleted - for example, accessing a row after calling its delete() method, or following a link to a deleted row." ["__init__"]
#!defClass(anvil.tables,RowDeleted,anvil.tables.TableError)!:
class RowDeleted(TableError):
    pass


#!defMethod()!2: "Raised when attempting to access a column that does not exist in this table." ["__init__"]
#!defClass(anvil.tables,NoSuchColumnError,anvil.tables.TableError)!:
class NoSuchColumnError(TableError):
    pass


#!defMethod()!2: "Raised when a transaction conflicts and has been aborted." ["__init__"]
#!defClass(anvil.tables,TransactionConflict,anvil.tables.TableError)!:
class TransactionConflict(TableError):
    pass


#!defMethod()!2: "Raised when an app has exceeded its quota." ["__init__"]
#!defClass(anvil.tables,QuotaExceededError,anvil.tables.TableError)!:
class QuotaExceededError(TableError):
    pass


anvil.server._register_exception_type("anvil.tables.TransactionConflict", TransactionConflict)
anvil.server._register_exception_type("anvil.tables.TableError", TableError)
anvil.server._register_exception_type("anvil.tables.RowDeleted", RowDeleted)
anvil.server._register_exception_type("anvil.tables.NoSuchColumnError", NoSuchColumnError)
anvil.server._register_exception_type("anvil.tables.QuotaExceededError", QuotaExceededError)
