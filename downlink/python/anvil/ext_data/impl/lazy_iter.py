import functools
from typing import Any, Callable, Tuple, List, Dict, Optional, Iterable
import anvil.server
from anvil.server import Capability
from anvil.ext_data import LazyIterable

IterSpec = Any
Cursor = Any

ANY = Capability.ANY
_local_page_funcs: Dict[str, Callable[[Capability],Tuple[List,Optional[Capability]]]] = {}


def iter_page(iter_name: str):
    def wrap(f: Callable[[IterSpec,Cursor],Tuple[List,Cursor]]):
        @anvil.server.callable("ext.iter:"+iter_name)
        @functools.wraps(f)
        def fn(cap):
            _, _, iter_spec, cursor = anvil.server.unwrap_capability(cap, ["anvil.ext_iter", iter_name, ANY, ANY])
            page, next_cursor = f(iter_spec, cursor)
            cursor_cap = Capability(["anvil.ext_iter", iter_name, iter_spec, next_cursor]) if next_cursor else None
            return page, cursor_cap

        _local_page_funcs[iter_name] = fn

        return fn

    return wrap


def make_iterable(iter_name: str, iter_spec: IterSpec, first_page: Optional[Iterable] = None):
    cap_first_page = anvil.server.Capability(["anvil.ext_iter", iter_name, iter_spec, None])
    cap_second_page = None
    get_next_page = _local_page_funcs.get(iter_name, functools.partial(anvil.server.call, "ext.iter:"+iter_name))
    if first_page is None:
        # None means "fetch it yourself"
        first_page, cap_second_page = get_next_page(cap_first_page)
    elif not first_page:
        # Empty list or falsy iterable means "don't send a first page"
        first_page = cap_second_page = None

    return LazyIterable(cap_first_page, first_page, cap_second_page, get_next_page)
