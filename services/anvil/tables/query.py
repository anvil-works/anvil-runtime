from anvil.server import portable_class

# Hack: Force ourselves into the top-level package, even
# if we were loaded into a runtime-v1 per-app Anvil package
__package__ = "anvil.tables"
__name__ = "anvil.tables.query"

#!defFunction(anvil.tables.query,_,pattern)!2: "Match values using a case-sensitive LIKE query, using the % wildcard character." ["like"]
@portable_class
class like(object):
    def __init__(self, pattern):
        self.pattern = pattern

#!defFunction(anvil.tables.query,_,pattern)!2: "Match values using a case-insensitive ILIKE query, using the % wildcard character." ["ilike"]
@portable_class
class ilike(object):
    def __init__(self, pattern):
        self.pattern = pattern

#!defFunction(anvil.tables.query,_,value)!2: "Match values greater than the provided value." ["greater_than"]
@portable_class
class greater_than(object):
    def __init__(self, value):
        self.value = value

#!defFunction(anvil.tables.query,_,value)!2: "Match values less than the provided value." ["less_than"]
@portable_class
class less_than(object):
    def __init__(self, value):
        self.value = value

#!defFunction(anvil.tables.query,_,value)!2: "Match values greater than or equal to the provided value." ["greater_than_or_equal_to"]
@portable_class
class greater_than_or_equal_to(object):
    def __init__(self, value):
        self.value = value

#!defFunction(anvil.tables.query,_,value)!2: "Match values less than or equal to the provided value." ["less_than_or_equal_to"]
@portable_class
class less_than_or_equal_to(object):
    def __init__(self, value):
        self.value = value

#!defFunction(anvil.tables.query,_,min,max,[min_inclusive=True],[max_inclusive=False])!2: "Match values between the provided min and max, optionally inclusive." ["between"]
def between(min, max, min_inclusive=True, max_inclusive=False):
    return all_of(
        greater_than_or_equal_to(min) if min_inclusive else greater_than(min),
        less_than_or_equal_to(max) if max_inclusive else less_than(max)
    )

#!defFunction(anvil.tables.query,_,query,[raw=False])!2: "Match values that match the provided full-text search query." ["full_text_match"]
@portable_class
class full_text_match(object):
    def __init__(self, query, raw=False):
        self.query = query
        self.raw = raw

#!defFunction(anvil.tables.query,_,*query_expressions)!2: "Match all query parameters given as arguments and keyword arguments" ["all_of"]
@portable_class
class all_of(object):
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

#!defFunction(anvil.tables.query,_,*query_expressions)!2: "Match any query parameters given as arguments and keyword arguments" ["any_of"]
@portable_class
class any_of(object):
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

#!defFunction(anvil.tables.query,_,*query_expressions)!2: "Match none of the query parameters given as arguments and keyword arguments" ["none_of"]
@portable_class
class none_of(object):
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

#!defFunction(anvil.tables.query,_,*query_expressions)!2: "Match none of the query parameters given as arguments and keyword arguments" ["not_"]
not_ = none_of

