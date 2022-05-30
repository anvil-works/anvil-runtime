# For the sake of a soft roll-out, we don't want to load v2 code implicitly
# from anvil.tables.query, but that module needs access to `make_refs` if we're
# using v2. So we inject it (only) when v2 loads.

from .. import query
from . import _refs

query._make_refs = _refs.make_refs
