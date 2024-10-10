from anvil.server import portable_class

from ._helpers import _hash_wrapper

# Don't load v2 code unless v2 is imported. v2._load_hacks will inject this for us.
# from .v2._refs import make_refs as _make_refs
_make_refs = lambda x: x




class _pattern_query(object):
    def __init__(self, pattern):
        self.pattern = pattern

    __hash__, __eq__ = _hash_wrapper("pattern")


class _value_query(object):
    def __init__(self, value):
        self.value = value

    __hash__, __eq__ = _hash_wrapper("value")


class _of_query(object):
    def __init__(self, *args, **kwargs):
        self.args = _make_refs(args)
        self.kwargs = _make_refs(kwargs)

    def __hash__(self):
        return hash(self.args + tuple(sorted(self.kwargs.items())))

    def __eq__(self, other):
        if type(other) is not type(self):
            return NotImplemented
        return self.args == other.args and self.kwargs == other.kwargs


#!defFunction(anvil.tables.query,_,pattern)!2: "Match values using a case-sensitive LIKE query, using the % wildcard character." ["like"]
@portable_class
class like(_pattern_query):
    pass


#!defFunction(anvil.tables.query,_,pattern)!2: "Match values using a case-insensitive ILIKE query, using the % wildcard character." ["ilike"]
@portable_class
class ilike(_pattern_query):
    pass


#!defFunction(anvil.tables.query,_,value)!2: "Match values greater than the provided value." ["greater_than"]
@portable_class
class greater_than(_value_query):
    pass


#!defFunction(anvil.tables.query,_,value)!2: "Match values less than the provided value." ["less_than"]
@portable_class
class less_than(_value_query):
    pass


#!defFunction(anvil.tables.query,_,value)!2: "Match values greater than or equal to the provided value." ["greater_than_or_equal_to"]
@portable_class
class greater_than_or_equal_to(_value_query):
    pass


#!defFunction(anvil.tables.query,_,value)!2: "Match values less than or equal to the provided value." ["less_than_or_equal_to"]
@portable_class
class less_than_or_equal_to(_value_query):
    pass


#!defFunction(anvil.tables.query,_,min,max,[min_inclusive=True],[max_inclusive=False])!2: "Match values between the provided min and max, optionally inclusive." ["between"]
def between(min, max, min_inclusive=True, max_inclusive=False):
    return all_of(
        greater_than_or_equal_to(min) if min_inclusive else greater_than(min),
        less_than_or_equal_to(max) if max_inclusive else less_than(max),
    )


#!defFunction(anvil.tables.query,_,query,[raw=False])!2: "Match values that match the provided full-text search query." ["full_text_match"]
@portable_class
class full_text_match(object):
    def __init__(self, query, raw=False):
        self.query = query
        self.raw = raw

    __hash__, __eq__ = _hash_wrapper("query", "raw")


#!defFunction(anvil.tables.query,_,*query_expressions)!2: "Match all query parameters given as arguments and keyword arguments" ["all_of"]
@portable_class
class all_of(_of_query):
    pass


#!defFunction(anvil.tables.query,_,*query_expressions)!2: "Match any query parameters given as arguments and keyword arguments" ["any_of"]
@portable_class
class any_of(_of_query):
    pass


#!defFunction(anvil.tables.query,_,*query_expressions)!2: "Match none of the query parameters given as arguments and keyword arguments" ["none_of"]
@portable_class
class none_of(_of_query):
    pass


#!defFunction(anvil.tables.query,_,*query_expressions)!2: "Match none of the query parameters given as arguments and keyword arguments" ["not_"]
not_ = none_of

#!defFunction(anvil.tables.query,_,rows)!2: "Define the number of rows that are fetched per round trip to the server." ["page_size"]
@portable_class
class page_size(object):
    def __init__(self, rows):
        self.rows = rows

    __hash__, __eq__ = _hash_wrapper("rows")


@portable_class("anvil.tables.fetch_only")
class fetch_only(object):
    def __init__(self, *only_cols, **linked_cols):
        spec = {}
        for col in only_cols:
            if not isinstance(col, str):
                raise TypeError("columns must be strings")
            spec[col] = True
        for col, only in linked_cols.items():
            if not isinstance(only, fetch_only):
                raise TypeError("keyword arguments must use q.fetch_only()")
            spec[col] = only.spec
        self.spec = spec

    def _hashable(self, val):
        if val is True:
            return val
        return self._as_tuple(val)

    def _as_tuple(self, spec):
        return tuple((col_name, self._hashable(val)) for col_name, val in sorted(spec.items()))

    def __hash__(self):
        return hash(self._as_tuple(self.spec))

    def __eq__(self, other):
        if type(other) is not type(self):
            return NotImplemented
        return other.spec == self.spec


@portable_class
class only_cols(object):
    def __init__(self, *cols):
        self.cols = tuple(sorted(cols))

    __hash__, __eq__ = _hash_wrapper("cols")
