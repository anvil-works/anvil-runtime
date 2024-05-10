import anvil.tz
from anvil.server import Capability, unwrap_capability

from ._constants import CAP_KEY, NOT_FOUND, UNCACHED


def validate_cap(cap, table_id, row_id=NOT_FOUND):
    # this function ensures that the cap is the right shape and references the right table/row
    # full validation happens in clojure
    _, _, view_dict, narrowed, _ = unwrap_capability(cap, ["_", "t", Capability.ANY, Capability.ANY, Capability.ANY])
    assert str(view_dict["id"]) == table_id
    if row_id is not NOT_FOUND:
        assert row_id == str(narrowed["r"])


def clean_local_datetime(d):
    if d.tzinfo is not None:
        offset = d.utcoffset().total_seconds()
    else:
        offset = anvil.tz.tzlocal().utcoffset(d).total_seconds()
    return d.replace(tzinfo=anvil.tz.tzoffset(seconds=offset))


# Serialization helpers
def check_serialized(self, local_data):
    self_id = id(self)
    serialized = local_data.get(self_id, False)
    local_data[self_id] = True
    return serialized


def init_view_data(view_key, g_table_data):
    return g_table_data.setdefault(view_key, {})


def init_spec_rows(g_view_data, table_spec, cache_spec=None):
    g_table_spec = g_view_data.get("spec")
    if g_table_spec is not None:
        pass
    elif table_spec is None or cache_spec is None:
        g_table_spec = g_view_data["spec"] = table_spec
    else:
        g_table_spec = g_view_data["spec"] = {"cols": table_spec["cols"], "cache": cache_spec}
    g_table_rows = g_view_data.setdefault("rows", {})
    return g_table_spec, g_table_rows


def merge_row_data(row_id, row_data, g_table_rows, g_table_spec, row_cache_spec):
    # we've already cleaned the row_data
    #  - it will only be a compact list if the caches match
    #  - and g_row_data is either None or also a compact list
    # otherwise row_data will be a dict
    g_row_data = g_table_rows.get(row_id)

    # FAST - common case - nothing in row_data
    if g_row_data is None:
        g_table_rows[row_id] = row_data
        return

    g_row_type = type(g_row_data)
    row_type = type(row_data)

    # handle all UNCACHED - i.e. the partially cached writer wins
    if g_row_type is list and len(g_row_data) == 1:
        # the row serialized before us has an all 0 cache_spec and is compact
        # we are either a dict or a list of the same length
        g_table_rows[row_id] = row_data
        return
    if not any(row_cache_spec):
        # the row to merge has an all 0 cache_spec
        return

    # SLOW PATH - uncommon cases
    # Another reference to this row (not the exact same row) was already serialized before us
    if row_type is list:
        # g_row_data must also be a compact list if row_data is a list
        # they must have the same length at this stage since we know the cache specs match
        if g_row_type is list:
            # fail safe sanity check
            merge_compact(row_data, g_row_data)
        
    elif g_row_type is dict:
        # then the previously serialized reference to this row
        # didn't match the g_cache_spec
        # so just take the itersect of the dictionaries
        g_table_rows[row_id] = merge_dicts(row_data, g_row_data)
        return
    else:
        # finally the g_row_type is a compact list and we are a dict - make it a dict
        g_cache_spec = g_table_spec["cache"]
        merge_dict_with_compact(row_data, g_row_data, row_cache_spec, g_cache_spec)
        g_table_rows[row_id] = row_data


def merge_compact(row_data, g_row_data):
    # any conflicts just replace with UNCACHED sentinel
    # use len - 1 so we skip the Capability
    for i in range(len(row_data) - 1):
        gbl, loc = g_row_data[i], row_data[i]
        if gbl != loc:
            g_row_data[i] = UNCACHED


def merge_dicts(row_data, g_row_data):
    # walk the smallest
    merged = {}
    a, b = (row_data, g_row_data) if len(row_data) < len(g_row_data) else (g_row_data, row_data)
    cap = a.pop(CAP_KEY)
    for key, a_val in a.items():
        b_val = b.get(key, NOT_FOUND)
        if a_val == b_val:
            merged[key] = a_val
    merged[CAP_KEY] = a[CAP_KEY] = cap
    return a


def merge_dict_with_compact(row_data, g_row_data, row_cache_spec, g_cache_spec):
    iter_g_row_data = iter(g_row_data)
    for i, (is_cached, g_is_cached) in enumerate(zip(row_cache_spec, g_cache_spec)):
        i = str(i)
        if not g_is_cached:
            # we could use the incoming caller wins here
            if is_cached:
                row_data.pop(i, None)
            continue

        g_val = next(iter_g_row_data)
        if not is_cached:
            continue

        if i in row_data and row_data[i] != g_val:
            row_data.pop(i)

    return row_data
