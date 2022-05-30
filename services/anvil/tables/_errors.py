import anvil.server


#!defClass(anvil.tables,TableError,__builtins__..Exception)!:
class TableError(anvil.server.AnvilWrappedError):
    pass


#!defClass(anvil.tables,RowDeleted,anvil.tables.TableError)!:
class RowDeleted(TableError):
    pass


#!defClass(anvil.tables,NoSuchColumnError,anvil.tables.TableError)!:
class NoSuchColumnError(TableError):
    pass


#!defClass(anvil.tables,TransactionConflict,anvil.tables.TableError)!:
class TransactionConflict(TableError):
    pass


#!defClass(anvil.tables,#QuotaExceededError,anvil.tables.TableError)!:
class QuotaExceededError(TableError):
    pass


anvil.server._register_exception_type("anvil.tables.TransactionConflict", TransactionConflict)
anvil.server._register_exception_type("anvil.tables.TableError", TableError)
anvil.server._register_exception_type("anvil.tables.RowDeleted", RowDeleted)
anvil.server._register_exception_type("anvil.tables.NoSuchColumnError", NoSuchColumnError)
anvil.server._register_exception_type("anvil.tables.QuotaExceededError", QuotaExceededError)
