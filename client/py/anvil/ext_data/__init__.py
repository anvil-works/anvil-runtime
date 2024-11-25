# This package implements a common interface for providing
#
import json

import anvil.server

try:
    from typing import (
        TypedDict,
        Dict,
        Optional,
        NewType,
        Tuple,
        List,
        Set,
    )

    CollectionKey = NewType("CollectionKey", str)
    LinkDestination = Tuple[CollectionKey]
    CollectionInfoLink = TypedDict(
        "CollectionInfoLink",
        {
            "to": CollectionKey,
            "multi": bool,
        },
    )
    CollectionInfoFields = TypedDict(
        "CollectionInfoFields",
        {"name": str, "client_visible": bool, "link": Optional[CollectionInfoLink]},
    )
    CollectionInfoDict = TypedDict(
        "CollectionInfoDict",
        {
            "name": str,
            "fields": List[CollectionInfoFields],
            "summary_fields": Optional[List[str]],
        },
    )
    RecordIdJson = NewType("RecordIdJson", str)

    GlobalSharedData = TypedDict(
        "GlobalSharedData", {"spec": Dict[CollectionKey, CollectionInfoDict]}
    )

    SendingLocalData = TypedDict("SendingLocalData", {"sent": Dict[RecordIdJson, set]})

    ReceivingLocalData = TypedDict(
        "ReceivingLocalData",
        {
            "instances": Dict[RecordIdJson, "Record"],
            "collections": Dict[CollectionKey, "CollectionInfo"],
            "seen_this_time": Set[RecordIdJson],
            "call_impl": Optional["CallImpl"],
        },
    )

    CompactData = Dict[RecordIdJson, dict]
    # Field values for single columns are IDs, for multi-link columns arrays of IDs
    # The empty string "" key contains a Capability.

except (ImportError, AttributeError):
    CollectionKey = str
    LinkDestination = tuple
    CollectionInfoDict = dict
    RecordIdJson = str
    GlobalSharedData = dict
    SendingLocalData = dict
    ReceivingLocalData = dict
    CompactData = dict


def tightjson(data):
    return json.dumps(data, separators=(',',':'))


def receiving_shared_data(si):
    # NB we deliberately don't set seen_this_time, becayse every caller *needs* to reset it
    return si.shared_data("anvil.ext_tables", local_data_factory=lambda: {"instances": {}, "collections": {}})


def sending_shared_data(si):
    return si.shared_data("anvil.ext_tables", local_data_factory=lambda: {"sent": {}},
                          transmitted_data_factory=lambda: {"spec": {}})


class CallImpl:
    def __init__(self, schema_name):
        self.prefix = "anvil.ext/" + schema_name

    def load_record_data(self, collection_key, record_caps, request=None):
        return anvil.server.call(self.prefix+"/load", collection_key, record_caps, request=request)

    def update_records(self, collection_key, updates):
        return anvil.server.call(self.prefix+"/update", collection_key, updates)

    def delete_records(self, collection_key, to_delete):
        return anvil.server.call(self.prefix+"/delete", collection_key, to_delete)


_model_classes = {}


class CollectionInfo:
    """Information about a collection"""
    class FieldInfo:
        def __init__(self, name, client_visible=True, from_id=False, is_link=False, link_to=None, link_multi=False):
            self.name = name
            self.client_visible = client_visible
            self.is_link = is_link
            self.link_to = link_to
            self.link_multi = link_multi
            self.from_id = from_id

        @staticmethod
        def load(data, gsdata, collection_cache):
            link_info = data.get("link")
            link_to = CollectionInfo.load(link_info["to"], gsdata, collection_cache) if link_info else None
            link_multi = link_info and link_info["multi"]
            return CollectionInfo.FieldInfo(data["name"], data.get("client_visible", True), data.get("from_id", False),
                                            link_info is not None, link_to, link_multi)

    def __init__(self, key, data, fields, call_impl=None):
        """Don't try and make one of these yourself, use the impl package"""
        self.schema_name = json.loads(key)["s"]
        self.key = key
        self.name = data["name"]
        self.data = data
        self.fields = fields
        self.summary_fields = data.get("summary_fields")
        self.calls = call_impl or CallImpl(self.schema_name)

    @staticmethod
    def load(key, gsdata, collection_cache, call_impl=None):
        c = collection_cache.get(key)
        if not c:
            spec = gsdata['spec'].get(key)
            if spec is None:
                return None
            c = collection_cache[key] = CollectionInfo(key, spec, {}, call_impl)
            # Do this after the collection is in local_data, so circular references work
            c.fields = {data["name"]: c.FieldInfo.load(data, gsdata, collection_cache) for data in spec['fields']}
        return c

    def update(self, gsdata):
        """Ingest any fields in this txdata that we didn't get before"""
        collection_cache = {}
        spec = gsdata['spec'].get(self.key)
        if spec:
            for fdata in spec['fields']:
                field = self.fields.get(fdata['name'])
                if not field or fdata.get("link") and not field.link_to:
                    self.fields[fdata['name']] = self.FieldInfo.load(fdata, gsdata, collection_cache)

    def save(self, key, gsdata, remote_is_trusted):
        if key not in gsdata['spec']:
            if remote_is_trusted:
                gsdata['spec'][key] = self.data
            else:
                gsdata['spec'][key] = {**self.data, "fields": [field for field in self.data["fields"]
                                                               if field["client_visible"]]}


@anvil.server.portable_class
class Record:
    def __init__(self, str_id, collection_info=None, cap=None, data=None):
        """Don't make one of these yourself; use schema stuff in the impl package"""
        # raise TypeError("Cannot instantiate a Record")
        self._str_id = str_id
        self._collection_info = collection_info
        self._cap = cap
        if cap:
            cap.set_update_handler(self._cap_update_handler)
        self._data = data or {}

    def _cap_update_handler(self, updates):
        if updates is False:
            # We've been deleted - clear cache so that
            # server calls are required for data access (which will then fail)
            self._data = {}
        else:
            # Updates are fleshed-out (ie contain Record objects), so we can just apply them like this
            self._data.update(updates)

    # USER API

    @property
    def id(self):
        return self._cap.scope[2]

    def __eq__(self, other):
        return isinstance(other, Record) and other._cap.scope == self._cap.scope

    def __hash__(self):
        return hash(self._cap.scope[1]) ^ hash(tuple(self.id) if type(self.id) is list else self.id)

    def __getitem__(self, field_name):
        if field_name == "":
            raise KeyError("") # that's where my cap lives

        f = self._collection_info and self._collection_info.fields.get(field_name)
        if f and f.from_id is not False:
            if f.from_id is True:
                return self.id
            else:
                return self.id[f.from_id]

        if field_name not in self._data:
            # Policy decision: Fetch just this field.
            self._fetch((False, {field_name: True}))

        return self._data[field_name]

    def __iter__(self):
        # Used to implement dict(record) efficiently
        all_keys = set(self._data.keys())
        all_keys.discard("")
        to_fetch = None
        if self._collection_info:
            known_fields = self._collection_info.fields.keys()
            to_fetch = {field_name: True for field_name in known_fields if field_name not in all_keys}
            all_keys.update(known_fields)

        def get_key(k):
            if k not in self._data:
                self._fetch((False, to_fetch))
            return self._data[k]

        return iter((k, get_key(k)) for k in all_keys)

    def __setitem__(self, field, value):
        self.update({field: value})

    def update(self, updates=None, **values):
        updates = values if updates is None else {**updates, **values}
        self._calls.update_records(self._cap.scope[1], [(self._cap, updates)])

    def delete(self):
        self._calls.delete_records(self._cap.scope[1], [self._cap])

    def __repr__(self):
        info = json.loads(self._cap.scope[1]) if self._cap else {"s":"NO", "c":"CAP"}
        if self._collection_info and self._collection_info.summary_fields:
            keys = [k for k in self._collection_info.summary_fields if k in self._data]
            values = ", ".join(k+"="+repr(self._data[k]) for k in keys)
            if any(k not in self._collection_info.summary_fields for k in self._data.keys()):
                values += " ..." if keys else "..."
        else:
            values = ", ".join(k+"="+repr(v) for k,v in self._data.items() if k != "")
        return "<{} {}.{} {} {{{}}}>".format(
            type(self).__name__, info["s"], info["c"], (repr(self.id) if self._cap else self._str_id), values
        )

    # MODELS

    def __init_subclass__(cls, schema=None, collection=None, **kwargs):
        if type(schema) is not str or type(collection) is not str:
            raise TypeError("If subclassing Record, you must specify schema= and collection= as strings.")
        if cls.__init__ is not Record.__init__:
            raise TypeError("If subclassing Record, you may not override __init__")
        _model_classes[(schema,collection)] = cls

    # SENDING

    def _compact_ref(self, cdata, gsdata, sldata, collection_info, local_is_trusted, remote_is_trusted):
        if collection_info.key == self._cap.scope[1]:
            self._add_to_cdata(cdata, gsdata, sldata, local_is_trusted, remote_is_trusted)
            return self.id
        else:
            return self

    def _add_to_cdata(self, cdata, gsdata, sldata, local_is_trusted, remote_is_trusted):
        my_data = cdata.get(self._str_id, {})
        sent_keys = sldata["sent"].setdefault(self.id, set())
        if "" not in sent_keys:
            my_data[""] = self._cap
            sent_keys.add("")

        # Only send data if we're on the server side - data from the client will be ignored:
        if local_is_trusted and (remote_is_trusted or self._collection_info):
            # If we know about our collection info we can send links compact style
            fields = {}
            if self._collection_info and gsdata:
                self._collection_info.save(self._collection_info.key, gsdata, remote_is_trusted)
                fields = self._collection_info.fields
            for key, value in self._data.items():
                field = fields.get(key)
                if not remote_is_trusted and field and not field.client_visible:
                    continue # skip this field
                if field and field.is_link:
                    if field.link_multi and type(value) is list:
                        my_data[key] = [r._compact_ref(cdata, gsdata, sldata, field.link_to, local_is_trusted,
                                                       remote_is_trusted)
                                        if isinstance(r, Record) else r for r in value]
                    elif not field.link_multi and isinstance(value, Record):
                        my_data[key] = value._compact_ref(cdata, gsdata, sldata, field.link_to, local_is_trusted,
                                                          remote_is_trusted)
                my_data[key] = value
                sent_keys.add(key)

        if my_data:
            # Only write into cdata if there's any data to add that hasn't been added elsewhere
            cdata[self._str_id] = my_data

    def __serialize__(self, si):
        gsdata, sldata = sending_shared_data(si)
        cdata = {}
        if self._cap is not None:
            # NB self._cap is only None if we're dehydrated in a RecordList. If so, we will be rehydreated
            # before we are reachable, so all the user API assumes _cap is present
            self._add_to_cdata(cdata, gsdata, sldata, si.local_is_trusted, si.remote_is_trusted)
        return [self._str_id, cdata]

    # RECEIVING

    @staticmethod
    def __new_deserialized__(wire_data, si):
        gsdata, rldata = receiving_shared_data(si)
        rldata["seen_this_time"] = set()
        str_id, cdata = wire_data
        return Record._get_from_data(str_id, cdata, gsdata, rldata, si.remote_is_trusted)

    @staticmethod
    def _get_from_data(str_id, cdata, gsdata, rldata, remote_is_trusted):
        instance = rldata["instances"].get(str_id)
        if not instance:
            # Icky workaround for Skulpt missing raw_decode
            try:
                ck, _ = json.JSONDecoder().raw_decode(str_id)
            except NotImplementedError:
                idx = -1
                while True:
                    idx = str_id.find(".", idx+1)
                    if idx == -1:
                        raise ValueError("JSON parse failed for str_id: " + repr(str_id))
                    try:
                        ck = json.loads(str_id[:idx])
                        break
                    except json.JSONDecodeError:
                        pass
            cls = _model_classes.get((ck["s"], ck["c"]), Record)
            instance = cls(str_id)
            rldata["instances"][str_id] = instance
        # Prevent looping:
        if str_id not in rldata["seen_this_time"]:
            rldata["seen_this_time"].add(str_id)
            instance._update_from_txdata(cdata, gsdata, rldata, remote_is_trusted)
        return instance

    def _fill_out_links(self, data, cdata, gsdata, rldata):
        """We've got collection info, fill out links. Only makes sense if data is trusted."""
        assert self._collection_info
        for field in self._collection_info.fields.values():
            if field.is_link and field.name in data:
                v = data.get(field.name)
                if field.link_multi:
                    if type(v) is list:
                        v = [Record._get_from_data(field.link_to.key+"."+tightjson(rid), cdata, gsdata, rldata, True)
                             if not isinstance(rid, Record) else rid
                             for rid in v]
                else:
                    if not isinstance(v, Record):
                        v = Record._get_from_data(field.link_to.key+"."+tightjson(v), cdata, gsdata, rldata, True)

                data[field.name] = v

    def _update_from_txdata(self, cdata, gsdata, rldata, remote_is_trusted):
        my_data = cdata.get(self._str_id, None)
        if my_data is None:
            return

        if self._cap is None and "" in my_data:
            self._cap = my_data[""]
            self._cap.set_update_handler(self._cap_update_handler)

        if remote_is_trusted:
            if gsdata and self._cap:
                if not self._collection_info:
                    self._collection_info = CollectionInfo.load(self._cap.scope[1], gsdata, rldata["collections"],
                                                                rldata.get("call_impl"))
                    if self._collection_info:
                        self._fill_out_links(self._data, cdata, gsdata, rldata)
            if self._collection_info:
                self._fill_out_links(my_data, cdata, gsdata, rldata)
            self._data.update(my_data)

    @property
    def _calls(self):
        if self._collection_info:
            return self._collection_info.calls
        else:
            coll_dict = json.loads(self._cap.scope[1])
            return CallImpl(coll_dict["s"])

    @property
    def _schema_and_collection(self):
        if self._collection_info:
            return self._collection_info.schema_name, self._collection_info.name
        else:
            ck = json.loads(self._cap.scope[1])
            return ck["s"], ck["c"]


    def _fetch(self, request_spec):
        dhtd = self._calls.load_record_data(self._cap.scope[1], [self._cap], request=request_spec)
        cdata, gsdata = dhtd.data
        rldata = {"instances": {}, "collections": {}, "seen_this_time": set()}
        if self._collection_info:
            rldata["collections"][self._collection_info.key] = self._collection_info
            self._collection_info.update(gsdata)
        else:
            self._collection_info = CollectionInfo.load(self._cap.scope[1], gsdata, rldata["collections"])
        self._update_from_txdata(cdata, gsdata, rldata, True)


def _strip_for_client(s_cdata, s_gsdata, ck_and_ids):
    if all(all(field["client_visible"] for field in cinfo["fields"])
           for cinfo in s_gsdata["spec"].values()):
        # No stripping required
        return s_cdata, s_gsdata

    c_cdata = {}
    c_gsdata = {"spec": {}}
    to_transfer = list(ck_and_ids)

    while to_transfer:
        ck, rid = to_transfer.pop()
        coll = s_gsdata["spec"].get(ck)
        if ck not in c_gsdata:
            c_gsdata["spec"][ck] = {**coll, "fields": [field for field in coll["fields"] if field["client_visible"]]}
        str_id = ck+"."+tightjson(rid)
        if str_id not in c_cdata:
            c_data = dict(s_cdata[str_id])
            for field in coll["fields"]:
                if field["name"] in c_data:
                    if not field["client_visible"]:
                        del c_data[field["name"]]
                    elif field.get("link"):
                        v = c_data[field["name"]]
                        link = field["link"]
                        if not link["multi"]:
                            to_transfer.append((link["to"], v.id if isinstance(v, Record) else v))
                        elif type(v) is list:
                            for record in v:
                                to_transfer.append((link["to"], record.id if isinstance(record, Record) else record))

            c_cdata[str_id] = c_data

    return c_cdata, c_gsdata



@anvil.server.portable_class
class DehydratedTrustedData:
    def __init__(self, cdata, gsdata, call_impl):
        self._cdata = cdata
        self._gsdata = gsdata
        self._rldata = {"instances": {}, "collections": {}, "seen_this_time": set(), "call_impl": call_impl}
        self._trusted = True
        self._records_to_rehydrate = None

    def _rehydrate(self):
        if self._trusted and self._records_to_rehydrate:
            for r in self._records_to_rehydrate:
                r._update_from_txdata(self._cdata, self._gsdata, self._rldata, True)
            self._records_to_rehydrate = None

    @property
    def data(self):
        self._rehydrate()
        return self._cdata, self._gsdata

    def __serialize__(self, si):
        return self._cdata, self._gsdata

    def __deserialize__(self, data, si):
        _, self._rldata = receiving_shared_data(si)
        self._rldata["seen_this_time"] = set()
        self._cdata, self._gsdata = data
        self._trusted = si.remote_is_trusted
        self._records_to_rehydrate = [r for r in self._rldata["instances"].values() if r._str_id in self._cdata]


@anvil.server.portable_class
class RecordList(DehydratedTrustedData):
    def __init__(self, cdata, gsdata, ck_and_ids, call_impl):
        DehydratedTrustedData.__init__(self, cdata, gsdata, call_impl)
        self._records = ck_and_ids
        self._trusted = True
        self._call_impl = call_impl

    def __serialize__(self, si):
        cdata, gsdata = self._cdata, self._gsdata
        if not si.remote_is_trusted:
            cdata, gsdata = _strip_for_client(cdata, gsdata, self._records)
        return cdata, gsdata, self._records

    def __deserialize__(self, data, si):
        DehydratedTrustedData.__deserialize__(self, data[:2], si)
        self._records = data[2]
        self._call_impl = None

    def _mk_record(self, record):
        collection_key, record_id = record
        str_id = collection_key+"."+tightjson(record_id)
        # If we have an instance in cache, it's complete - there is only one cdata - so we can shortcut
        instance = self._rldata["instances"].get(str_id)
        return instance or Record._get_from_data(str_id, self._cdata, self._gsdata, self._rldata, self._trusted)

    def __iter__(self):
        self._rehydrate()
        return iter(self._mk_record(record) for record in self._records)

    def __getitem__(self, index):
        if type(index) is not int:
            raise TypeError("RecordList index must be integers")
        self._rehydrate()
        return self._mk_record(self._records[index])

    def __len__(self):
        return len(self._records)

    def __bool__(self):
        return bool(self._records)

    def __repr__(self):
        return "<RecordList ({} records)>".format(len(self._records))


@anvil.server.portable_class
class LazyIterable:
    def __init__(self, cap_first_page, first_page=None, cap_second_page=None, get_next_page=None):
        # Don't create one of these manually; use impl.lazy_iter.LazyIterable
        self._cap_first_page = cap_first_page
        self._first_page = first_page
        self._cap_second_page = cap_second_page
        self._get_next_page = get_next_page

    def __serialize__(self, si):
        if si.local_is_trusted:
            return self.cap_this_page, self._first_page, self._cap_second_page
        else:
            return self.cap_this_page, None, None

    def __deserialize__(self, data, si):
        self._get_next_page = None
        if si.remote_is_trusted:
            self._cap_first_page, self._first_page, self._cap_second_page = data
        else:
            self._cap_first_page = data[0]
            self._first_page = self._cap_second_page = None

    def __iter__(self):
        if self._first_page is not None:
            return self.Iterator(self._first_page, self._cap_second_page, self._get_next_page)
        else:
            return self.Iterator([], self._cap_first_page, self._get_next_page)

    def __repr__(self):
        return f"<LazyIterable({self._cap_first_page.scope[1]}): at {self._cap_first_page.scope[2:]} with {len(self._first_page)} items cached, next page = {self._cap_second_page}>"

    class Iterator:
        def __init__(self, first_page, next_page_cap, get_next_page):
            self._page_iter = iter(first_page)
            self._next_page_cap = next_page_cap
            self._get_next_page = get_next_page

        def __next__(self):
            while True:
                try:
                    return self._page_iter.__next__()
                except StopIteration:
                    if not self._next_page_cap:
                        raise
                    if self._get_next_page:
                        next_data, self._next_page_cap = self._get_next_page(self._next_page_cap)
                    else:
                        next_data, self._next_page_cap = anvil.server.call("ext.iter:" + self._next_page_cap.scope[1],
                                                                           self._next_page_cap)
                    self._page_iter = iter(next_data)

