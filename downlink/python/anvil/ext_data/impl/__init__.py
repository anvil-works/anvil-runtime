# This package implements the server side of ext_data. Use it to implement schemas.
import json
import threading
from pprint import pprint

from dataclasses import dataclass

import dataclasses
from typing import Any, Callable, List, Tuple, Union, Dict, Iterable, Optional, Set
import anvil.server
from anvil.server import Capability, unwrap_capability

from .. import Record, CallImpl, CollectionInfo, CollectionInfoDict, tightjson, RecordList, CollectionKey, \
    SendingLocalData, DehydratedTrustedData, CompactData, GlobalSharedData, _model_classes

try:
    # For Python 3.7
    from typing import Literal
except ImportError:
    pass

RecordId = Any # Record types can be anything, but this helps with annotation at least

@dataclass
class FieldDef:
    name: str
    type: 'Literal["string", "number", "datetime", "date", "link_single", "link_multiple", "object"]'
    link_target: Optional[str] = None # name of a collection
    from_id: Union['Literal[True, False]', int] = False # "true" means the whole thing is the ID, int is the index in a tuple
    client_visible: bool = True
    follow_links_single: Optional[Callable[[List[Any], "FetchContext"], List[Union[Tuple[RecordId,"RecordDataValue"],Record]]]] = None
    follow_links_multiple: Optional[Callable[[List[Any], "FetchContext"], List[Iterable[Union[Tuple[RecordId,"RecordDataValue"],Record]]]]] = None
    follow_link_single: Optional[Callable[[Any, "FetchContext"], Union[Tuple[RecordId,"RecordDataValue"],Record]]] = None
    follow_link_multiple: Optional[Callable[[Any, "FetchContext"], Iterable[Union[Tuple[RecordId,"RecordDataValue"],Record]]]] = None
    # TODO client_writable?


@dataclass
class CollectionDef:
    name: str
    fields: List[FieldDef]
    load_records: Optional[Callable[[List[RecordId], "FetchContext"], List[dict]]] = None
    update_records: Optional[Callable[[List[Tuple[RecordId,dict]]], List[dict]]] = None
    delete_records: Optional[Callable[[List[RecordId]], None]] = None
    load_record: Optional[Callable[[RecordId, "FetchContext"], dict]] = None
    update_record: Optional[Callable[[RecordId,dict], dict]] = None
    delete_record: Optional[Callable[[RecordId], None]] = None
    client_fields: Optional[List[str]] = None # which fields to expose to the client?
    summary_fields: Optional[List[str]] = None # which fields to show by default in the object's repr?
    _fields_by_name: Dict[str,FieldDef] = None

    @property
    def fields_by_name(self):
        if self._fields_by_name is None:
            self._fields_by_name = {f.name: f for f in self.fields}
        return self._fields_by_name


@dataclass
class _CollectionSpec:
    s: str # schema name
    c: str # collection name
    f: Optional["FieldSpec"] = None # field restriction
    cf: Optional["FieldSpec"] = None # client-side field restriction
    _key: str = None

    @staticmethod
    def from_key(collection_key: str):
        info = json.loads(collection_key)
        return _CollectionSpec(_key=collection_key, **info)

    def to_key(self):
        if self._key is None:
            d = {"s": self.s, "c": self.c}
            if self.f is not None:
                d["f"] = self.f
            if self.cf is not None:
                d["cf"] = self.cf
            self._key = tightjson(d)
        return self._key


FieldSpec = Tuple[bool, Dict[str, "FieldSpecEntry"]]
FieldSpecEntry = Union[bool,FieldSpec]


@dataclass
class _FetchConfig:
    schema: "SchemaImpl"
    for_client: bool
    default_client_cols_only: bool
    collection_info: Dict[str,CollectionInfo] = dataclasses.field(default_factory=dict)


class _RecordCatcher(threading.local):
    def __init__(self):
        self.records: List[Record] = []
        self.enabled = False

    def __enter__(self):
        self.enabled = True
        self.records = []
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.enabled = False

    def ingest(self, record: Record):
        if self.enabled:
            self.records.append(record)


_catch_records = _RecordCatcher()


class FetchContext:
    def __init__(self, config: _FetchConfig, restriction: Optional[FieldSpec] = None, request: Optional[FieldSpec] = None,
                 valid=True, client_visible: FieldSpecEntry = True, client_visible_explicit = False,
                 collection: Optional[CollectionDef] = None,
                 parent: Optional[Tuple["FetchContext",str]] = None):
        self._config = config
        self._restriction = restriction
        self._request = request
        self._valid = valid
        self._client_visible = valid and client_visible
        self._client_visible_explicit = client_visible_explicit or \
                                        (client_visible is not True and client_visible is not False)
        self._parent = parent
        self._current_collection = collection
        self._valid_steps: Optional[Dict[str,FetchContext]] = None
        self._valid_by_default: Optional[bool] = None
        self._client_visible_by_default: Optional[bool] = None

    def __repr__(self):
        path = self._current_collection.name if self._current_collection else "??"
        p = self._parent
        while p is not None:
            ctx, f = p
            path = (ctx._current_collection.name if ctx._current_collection else "??") + "[" + f + "] -> " + path
            p = ctx._parent
        invalid = " INVALID" if not self._valid else ""
        return f"<FetchContext for {self._config.schema.name}.{path}{invalid} RS={self._restriction} RQ={self._request} CV={self.client_visible}>"

    def __bool__(self):
        return self._valid

    @property
    def client_visible(self):
        return self._client_visible

    # Manual indications from the fetch functions (used when following something that isn't a schema-described link)
    def set_current_collection(self, collection_name: str):
        self._current_collection = self._config.schema.collections[collection_name]

    # Manual indications from the fetch functions (used when following something that isn't a schema-described field)
    def set_default_client_visible(self, client_visible: bool):
        if not self._client_visible_explicit:
            self._client_visible = self._client_visible and client_visible

    @dataclass
    class _NextStepState:
        permit_by_default: bool = True
        only_consider_fields: Optional[Set] = None
        excluded_fields: Optional[Set] = dataclasses.field(default_factory=set)
        restriction: Dict[str,FieldSpec] = dataclasses.field(default_factory=dict)
        request: Dict[str, FieldSpec] = dataclasses.field(default_factory=dict)
        client_visible: Dict[str,FieldSpecEntry] = dataclasses.field(default_factory=dict)
        client_visible_by_default: bool = True
        client_visible_explicit: bool = False

        def exclude_field(self, field_name: str):
            if self.permit_by_default:
                self.excluded_fields.add(field_name)
            else:
                self.only_consider_fields.discard(field_name)

        def exclude_all_fields_except(self, possibly_allowed_field_names: Iterable[str]):
            if self.permit_by_default:
                self.permit_by_default = False
                ocf = set(possibly_allowed_field_names)
                ocf.difference_update(self.excluded_fields)
                self.only_consider_fields = ocf
                self.excluded_fields = None
            else:
                self.only_consider_fields.intersection_update(possibly_allowed_field_names)

        def apply_restriction(self, restriction: FieldSpec):
            pbd, rdict = restriction
            if not pbd:
                self.exclude_all_fields_except(rdict.keys())
            for field_name, field_restriction in rdict.items():
                if field_restriction is False:
                    self.exclude_field(field_name)
                elif field_restriction is True:
                    pass
                elif field_name in self.restriction:
                    self.restriction[field_name] = FetchContext.combine_restrictions(self.restriction[field_name],
                                                                                     restriction)
                else:
                    self.restriction[field_name] = restriction

        def apply_request(self, request: FieldSpec):
            pbd, rdict = request
            if not pbd:
                self.exclude_all_fields_except(rdict.keys())
            for field_name, field_request in rdict.items():
                if field_request is False:
                    self.exclude_field(field_name)
                elif field_request is True:
                    self.request[field_name] = (True, {})
                else:
                    self.request[field_name] = field_request

        def exclude_client_invisible_keys(self, collection: Optional[CollectionDef]):
            if collection:
                for f in collection.fields:
                    if not f.client_visible:
                        self.exclude_field(f.name)

            if self.client_visible_by_default:
                for field_name, cv in self.client_visible.items():
                    if cv is False:
                        self.exclude_field(field_name)
            else:
                self.exclude_all_fields_except(fn for fn, cv in self.client_visible.items() if cv is not False)

        def apply_default_client_visibility(self, collection: Optional[CollectionDef]):
            self.client_visible_explicit = False
            self.client_visible = {f.name: f.client_visible for f in collection.fields} if collection else {}
            # If there's no collection metadata (or no collection metadata for a particular field), we default to
            # "send everything"
            self.client_visible_by_default = True

        def apply_explicit_client_visibility(self, cv: FieldSpecEntry, collection: Optional[CollectionDef]):
            """Apply an explicit client-visibility request from *our* FetchContext, and work out what it
            means for our child FCs"""
            if cv is False:
                self.client_visible = {}
                self.client_visible_by_default = False
                self.client_visible_explicit = True
            elif cv is True:
                self.apply_default_client_visibility(collection)
            else:
                self.client_visible_explicit = True
                self.client_visible_by_default, self.client_visible = cv

        def get_valid_steps(self, fc: "FetchContext"):
            if self.permit_by_default:
                known_keys = set(self.restriction.keys())
                known_keys.update(self.request.keys())
                known_keys.update(self.excluded_fields)
                known_keys.update(key for key, visibility in self.client_visible.items()
                                  if visibility != self.client_visible_by_default)
            else:
                known_keys = self.only_consider_fields

            valid_steps = {field_name: FetchContext(
                config=fc._config,
                restriction=self.restriction.get(field_name),
                request=self.request.get(field_name, None),
                valid=(field_name not in self.excluded_fields) if self.permit_by_default else True,
                client_visible=self.client_visible.get(field_name, self.client_visible_by_default),
                client_visible_explicit=self.client_visible_explicit and field_name in self.client_visible,
                collection=fc._config.schema.follow_link(fc._current_collection, field_name),
                parent=(fc, field_name)
            ) for field_name in known_keys}

            return self.permit_by_default, self.client_visible_by_default, valid_steps

    def _compute_steps(self):
        state = FetchContext._NextStepState()
        # Compile all restrictions
        if self._restriction is not None:
            state.apply_restriction(self._restriction)

        if self._request is not None:
            state.apply_request(self._request)

        if self._client_visible_explicit:
            state.apply_explicit_client_visibility(self._client_visible, self._current_collection)
        elif self._client_visible:
            state.apply_default_client_visibility(self._current_collection)
        else:
            state.apply_explicit_client_visibility(False, self._current_collection)

        if self._config.for_client:
            state.exclude_client_invisible_keys(self._current_collection)

        self._valid_by_default, self._client_visible_by_default, self._valid_steps = state.get_valid_steps(self)

    @staticmethod
    def combine_restrictions(restriction_1: FieldSpec, restriction_2: FieldSpec):
        pbd1, rdict1 = restriction_1
        pbd2, rdict2 = restriction_2
        rdict = dict(rdict1)
        permit_by_default = pbd1 and pbd2

        if not pbd2:
            for k in list(rdict.keys()):
                if k not in rdict2:
                    del rdict[k]
        if not pbd1:
            rdict2 = dict(rdict2)
            for k in list(rdict2.keys()):
                if k not in rdict:
                    del rdict2[k]

        for field_name, r1 in rdict.items():
            r2 = rdict2.get(field_name, permit_by_default)
            if r1 is False or r2 is False:
                rdict[field_name] = False
            elif r1 is True:
                rdict[field_name] = r2
            elif r2 is True:
                rdict[field_name] = r1
            else:
                # They're both dict types, gotta descend!
                rdict[field_name] = FetchContext.combine_restrictions(r1, r2)

        return permit_by_default, rdict

    def _get_collection_info(self) -> CollectionInfo:
        if not self._current_collection:
            raise ValueError("This FetchContext does not represent a collection")
        cf = self._client_visible if self._client_visible_explicit else None
        collection_spec = _CollectionSpec(s=self._config.schema.name, c=self._current_collection.name,
                                          f=self._restriction, cf=cf)
        key = collection_spec.to_key()
        collection_info = self._config.collection_info.get(key)
        if collection_info is None:
            # Make a CollectionInfo out of ground-truth objects, and prefill its serialisation data while we're at it

            # We have to add the object before we fill out the fields, to deal with circular situations
            data =  {
                "name": self._current_collection.name,
                "fields": []
            }
            if self._current_collection.summary_fields:
                data["summary_fields"] = self._current_collection.summary_fields
            collection_info = self._config.collection_info[key] = CollectionInfo(key, data, {}, self._config.schema)

            # Now it's in the dict, we can fill out the fields with recursive calls to follow links
            for field in self._current_collection.fields:
                walk_ctx = self[field.name]
                if not walk_ctx:
                    continue
                link_info = None
                if field.type in ["link_single", "link_multiple"]:
                    link_info = walk_ctx._get_collection_info()

                collection_info.fields[field.name] = collection_info.FieldInfo(
                    name=field.name,
                    client_visible=walk_ctx.client_visible,
                    from_id=field.from_id,
                    is_link=link_info is not None,
                    link_to=link_info,
                    link_multi=field.type=="link_multiple"
                )
                data["fields"].append({
                    "name": field.name,
                    "client_visible": walk_ctx.client_visible,
                    "from_id": field.from_id,
                    "link": {
                        "to": link_info.key,
                        "multi": field.type == "link_multiple",
                    } if link_info else None
                })

        return collection_info


    def walk(self, field_name: str, walk_by_default: bool):
        new_ctx = None
        if self._valid:
            if self._valid_steps is None:
                self._compute_steps()

            if self._request is not None and self._request[1].get(field_name) or walk_by_default:
                new_ctx = self._valid_steps.get(field_name)

        # TODO memoise the constructed FetchContexts here
        return FetchContext(config=self._config, parent=(self, field_name),
                            valid=self._valid and self._valid_by_default and walk_by_default,
                            client_visible=bool(self._client_visible_by_default),
                            client_visible_explicit=False,
                            collection=self._config.schema.follow_link(self._current_collection, field_name)
                            ) if new_ctx is None else new_ctx

    def __getitem__(self, field_name: str):
        if not isinstance(field_name, str):
            raise TypeError("FetchContexts can only be indexed with strings")
        return self.walk(field_name, True)

    def _field_in_id(self, field_name: str):
        field = self._current_collection.fields_by_name.get(field_name)
        return field and field.from_id != False

    def trim_data(self, data: dict):
        if any(not self[key] for key in data.keys()):
            return {key: value for key, value in data.items() if self[key] and not self._field_in_id(key)}
        else:
            return data

    def make_record(self, record_id: RecordId, data: dict) -> Record:
        if not self._current_collection:
            raise ValueError("This FetchContext isn't pointing at a collection. Perhaps you've followed a field that "
                             "isn't a direct link, or not called set_current_collection() inside a complex field")

        data = self.trim_data(data)

        collection_info = self._get_collection_info()
        str_id = collection_info.key + "." + tightjson(record_id)

        cls = _model_classes.get((self._config.schema.name, collection_info.name), Record)
        record = cls(
            str_id,
            collection_info,
            Capability(["anvil.ext_data", collection_info.key, record_id]),
            data
        )
        _catch_records.ingest(record)
        return record

    class RecordListBuilder:
        def __init__(self, fetch_context: "FetchContext"):
            self.fetch_context = fetch_context
            self.collection_key = fetch_context._get_collection_info().key
            self._records: List[Tuple[CollectionKey,RecordId]] = []
            self._gsdata = {"spec": {}}
            self._cdata = {}

        def __enter__(self):
            # TODO catch reentrantly, be able to suck and dedup all data to toplevel(?)
            _catch_records.__enter__()
            self._records = []
            self._gsdata = {"spec": {}}
            self._cdata = {}
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            _catch_records.__exit__(exc_type, exc_val, exc_tb)

        def add_records(self, ids_and_data: Iterable[Tuple[RecordId, "RecordDataValue"]]):
            ids_and_data = list(ids_and_data)
            self.fetch_context._config.schema.walk_and_fill_out(self._cdata, self._gsdata, ids_and_data, self.fetch_context)
            self._records.extend((self.collection_key, record_id) for record_id, _ in ids_and_data)

        def get_record_list(self):
            sldata: SendingLocalData = {"sent": {}}
            for record in _catch_records.records:
                record._add_to_cdata(self._cdata, self._gsdata, sldata, True, not self.fetch_context._config.for_client)
                record._data = {}
                record._cap = None

            return RecordList(self._cdata, self._gsdata, self._records, self.fetch_context._config.schema)

    def record_builder(self):
        return FetchContext.RecordListBuilder(self)

    def to_json(self):
        cf = None
        if self._client_visible_explicit and type(self._client_visible) is not bool:
            cf = (self._client_visible_by_default, self._client_visible)
        collection_spec = _CollectionSpec(s=self._config.schema.name, c=self._current_collection.name,
                                          f=self._restriction, cf=cf)
        return collection_spec.to_key()

    @property
    def for_client(self):
        return self._config.for_client



@dataclass
class UnfollowedLink:
    data: Any
    def __hash__(self):
        return hash(self.data)


FieldValue = Union[UnfollowedLink,Record,Any]
RecordDataValue = Dict[str,FieldValue]
FetchResult = List[RecordDataValue]

def _caller_is_trusted():
    remote_caller = anvil.server.context.remote_caller
    return remote_caller is None or remote_caller.is_trusted

class SchemaImpl(CallImpl):
    def __init__(self, name: str, collections: List[CollectionDef]):
        super().__init__(name)
        self.name = name
        self.collections = {c.name: c for c in collections}
        self.default_specs = {c.name: _CollectionSpec(s=name, c=c.name) for c in collections}

        def mk_default_fetch_contexts(for_client: bool):
            cfg = _FetchConfig(schema=self, for_client=for_client, default_client_cols_only=for_client)
            return {
                c.name: FetchContext(cfg, collection=self.collections[c.name])
                for c in collections
            }
        self.default_server_fetch_ctx = mk_default_fetch_contexts(False)
        self.default_client_fetch_ctx = mk_default_fetch_contexts(True)

        # Register this schema's server endpoints
        anvil.server.callable(self.prefix+"/load")(lambda *args, **kwargs: self.load_record_data(*args, **kwargs))
        anvil.server.callable(self.prefix+"/update")(lambda *args, **kwargs: self.update_records(*args, **kwargs))
        anvil.server.callable(self.prefix+"/delete")(lambda *args, **kwargs: self.delete_records(*args, **kwargs))

    def follow_link(self, collection: Optional[CollectionDef], field_name: str):
        field = collection.fields_by_name.get(field_name) if collection else None
        return self.collections[field.link_target] if field and field.link_target is not None else None

    def _collection_and_context_for_call(self, collection_key: str, request: Optional[FieldSpec] = None) -> Tuple[CollectionDef, FetchContext]:
        collection_spec = _CollectionSpec.from_key(collection_key)
        if collection_spec.s != self.name:
            raise ValueError(f"load_record_data() for schema {self.name!r} called with a spec from schema {collection_spec.s!r}: {collection_key!r}")

        collection = self.collections[collection_spec.c]
        for_client = not _caller_is_trusted()

        if collection_spec.f or collection_spec.cf or request:
            # Nonstandard context
            cf_explicit = collection_spec.cf is not None
            fetch_context = FetchContext(
                config=_FetchConfig(self, for_client, for_client and not cf_explicit),
                restriction=collection_spec.f,
                client_visible=collection_spec.cf if cf_explicit else True,
                client_visible_explicit=cf_explicit,
                request=request,
                collection=collection
            )
        else:
            default_contexts = self.default_client_fetch_ctx if for_client else self.default_server_fetch_ctx
            fetch_context = default_contexts[collection.name]

        return collection, fetch_context

    def load_record_data(self, collection_key: str, record_caps: List[Capability], request: Optional[FieldSpec] = None):
        """Return the compact data (cdata, gsdata) for a set of records"""

        cdata = {}
        gsdata = {"spec": {}}
        sldata = {"sent": {}}
        if record_caps:
            # If we don't have a valid cap from a collection, we don't even reveal its (non)existence.

            record_ids = []
            for cap in record_caps:
                if cap.scope[1] != collection_key:
                    raise ValueError(f"load_record_data() called with mismatched collection keys: argument says {collection_key}, cap says {cap.scope[1]}")
                _, _, record_id = unwrap_capability(cap, ["anvil.ext_data", collection_key, Capability.ANY])
                record_ids.append(record_id)

            collection, fetch_context = self._collection_and_context_for_call(collection_key, request)

            with _catch_records as cr:
                self.load_and_fill_out(cdata, gsdata, collection, record_ids, fetch_context)
                for record in cr.records:
                    record._add_to_cdata(cdata, gsdata, sldata, True, not fetch_context.for_client)

        return DehydratedTrustedData(cdata, gsdata, self)

    @dataclass
    class LinkToFollow:
        field_name: str
        record_ids: List[RecordId] = dataclasses.field(default_factory=list)
        unfollowed: List[Tuple[RecordId,Any]] = dataclasses.field(default_factory=list)

    def load_and_fill_out(self, cdata: CompactData, gsdata: GlobalSharedData, collection: CollectionDef, record_ids: List[RecordId], ctx: FetchContext):
        fetch_results = collection.load_records(record_ids, ctx) if collection.load_records \
            else [collection.load_record(rid, ctx) for rid in record_ids]
        if len(fetch_results) != len(record_ids):
            raise ValueError(f"load_records() returned {len(fetch_results)} item(s) instead of {len(record_ids)} at {ctx}")
        self.walk_and_fill_out(cdata, gsdata, zip(record_ids, fetch_results), ctx)

    def walk_and_fill_out(self, cdata: CompactData, gsdata: GlobalSharedData, loaded_data: Iterable[Tuple[RecordId,RecordDataValue]], ctx: FetchContext):
        # We've got a list of dictionary data. Ingest data into the tx_data in a format that can be decoded by the
        # Record deserialiser

        collection_info = ctx._get_collection_info()
        gsdata["spec"].setdefault(collection_info.key, collection_info.data)

        # We now want to follow links. Links values can be specified by any of:
        #  - Returning a record ID in a link_single column
        #  - Returning a record in a link_single column, or an iterable (of records) in a link_multi column.
        #    This indicates that the fetcher has already followed those links and we don't need to do anything
        #    automatically. (Also, the
        #  - Returning an UnfollowedLink object in any type of link column. This indicates that we could follow
        #    the link, but it will require a call to the follow_link callback (which we can omit if unnecessary)
        #
        # The only ones we care about (because they require us to do work) are record IDs and UnfollowedLinks.


        links_to_follow: Dict[str,SchemaImpl.LinkToFollow] = {}

        def get_ltf(field_name: str):
            _ltf = links_to_follow.get(field_name)
            if _ltf is None:
                _ltf = links_to_follow[field_name] = self.LinkToFollow(field_name)
            return _ltf

        def minimise_link(field: FieldDef, value: Any):
            if field.type == "link_single":
                if isinstance(value, Record):
                    # It will be ingested by the record catcher, so just put the ID in
                    value = value.id
                else:
                    # Assume it's a record ID
                    get_ltf(field.name).record_ids.append(value)
            elif field.type == "link_multiple" and type(value) is list:
                new_value = []
                ltf = get_ltf(field.name)
                for v in value:
                    if isinstance(v, Record):
                        new_value.append(v.id) # already ingested
                    else:
                        # Assume it's a record ID
                        ltf.record_ids.append(v)
            return value

        collection = ctx._current_collection
        link_fields = []
        if collection:
            link_fields = [f for f in collection.fields if f.link_target]

        # Now we actually ingest the results
        id_prefix = collection_info.key+"."

        loaded_data = list(loaded_data) # TODO test remove
        for record_id, orig_data in loaded_data:
            data = ctx.trim_data(orig_data)
            if data is orig_data:
                data = dict(data)
            for field in link_fields:
                if field.name in data:
                    value = data[field.name]
                    if isinstance(value, UnfollowedLink):
                        get_ltf(field.name).unfollowed.append((record_id, value.data))
                        del data[field.name] # We'll fill this in later
                    elif field.type in ["link_single", "link_multiple"]:
                        v = minimise_link(field, value)
                        if v is not value:
                            data[field.name] = v

            data[""] = anvil.server.Capability(["anvil.ext_data", collection_info.key, record_id])

            str_id = id_prefix + tightjson(record_id)
            existing_record = cdata.get(str_id)
            if existing_record is None:
                cdata[str_id] = data
            else:
                existing_record.update(data)

        for field in link_fields:
            ltf = links_to_follow.get(field.name)
            if ltf:
                followed_ctx = ctx[field.name]

                if ltf.record_ids:
                    followed_collection = followed_ctx._current_collection
                    assert followed_collection
                    self.load_and_fill_out(cdata, gsdata, followed_collection, ltf.record_ids, followed_ctx)

                if ltf.unfollowed:
                    if field.type == "link_single":
                        if field.follow_links_single:
                            follow_data_single = field.follow_links_single([u for _, u in ltf.unfollowed], followed_ctx)
                        elif field.follow_link_single:
                            follow_data_single = [field.follow_link_single(u, followed_ctx) for _, u in ltf.unfollowed]
                        else:
                            raise TypeError(f"Field {collection.name}[{field.name!r}] returned UnfollowedLink objects but does not implement follow_link[s]_single")

                        if len(follow_data_single) != len(ltf.unfollowed):
                            raise ValueError(f"follow_links_single() for {collection.name}[{field.name!r}] returned {len(follow_data_single)} item(s) instead of {len(ltf.unfollowed)} at {followed_ctx}")

                        # For single-link follows, the only valid answer is a list of Records or (id, record_data) tuples
                        # TODO perhaps we shouldn't even allow the Records; I'm only keeping them for symmetry with multi links
                        to_walk: List[Tuple[RecordId,RecordDataValue]] = []
                        for followed_value, (record_id, _) in zip(follow_data_single, ltf.unfollowed):
                            if isinstance(followed_value, Record):
                                v = followed_value.id
                            elif type(followed_value) is tuple and len(followed_value) == 2:
                                v = followed_value[0]
                                to_walk.append(followed_value)
                            else:
                                raise ValueError(f"follow_links_single() for {collection.name}[{field.name!r}] returned invalid item {followed_value!r}")
                            cdata[id_prefix+tightjson(record_id)][field.name] = v
                        self.walk_and_fill_out(cdata, gsdata, to_walk, followed_ctx)

                    else:
                        if field.follow_links_multiple:
                            follow_data_multiple = field.follow_links_multiple([u for _, u in ltf.unfollowed], followed_ctx)
                        elif field.follow_link_multiple:
                            follow_data_multiple = [field.follow_link_multiple(u, followed_ctx) for _, u in ltf.unfollowed]
                        else:
                            raise TypeError(f"Field {collection.name}[{field.name!r}] returned UnfollowedLink objects but does not implement follow_links_multiple")

                        if len(follow_data_multiple) != len(ltf.unfollowed):
                            raise ValueError(f"follow_links_multiple() for {collection.name}[{field.name!r}] returned {len(follow_data_multiple)} item(s) instead of {len(ltf.unfollowed)} at {followed_ctx}")

                        # For link-multi follows, elements of the follow data may either be lists of record data
                        # (to be walked), or anything other iterable object such as lazy iterables (to be returned
                        # as-is)
                        to_walk: List[Tuple[RecordId,RecordDataValue]] = []
                        for followed_value, (record_id, _) in zip(follow_data_multiple, ltf.unfollowed):
                            if type(followed_value) == list:
                                v = []
                                for elt in followed_value:
                                    if isinstance(elt, Record):
                                        v.append(elt.id) # assume already ingested
                                    elif type(elt) is tuple and len(elt) == 2:
                                        to_walk.append(elt)
                                        v.append(elt[0])
                                    else:
                                        raise ValueError("follow_links() for {collection.name}[{field.name!r}] returned invalid item {followed_value!r}")
                            else:
                                v = followed_value
                            cdata[id_prefix + tightjson(record_id)][field.name] = v
                        self.walk_and_fill_out(cdata, gsdata, to_walk, followed_ctx)

    def update_records(self, collection_key: str, updates: List[Tuple[Capability, dict]]):
        if not _caller_is_trusted():
            raise Exception("Cannot update records directly from the client")

        if not updates:
            # If they didn't specify a valid cap, we don't even reveal whether the collection key was valid
            return []

        updates_with_id: List[Tuple[RecordId,dict]] = []
        for cap, update in updates:
            if cap.scope[1] != collection_key:
                raise ValueError(f"update_records() called with mismatched collection keys: argument says {collection_key}, cap says {cap.scope[1]}")
            if type(update) is not dict:
                raise TypeError(f"Expected dict, got {type(update)}")
            _, _, record_id = unwrap_capability(cap, ["anvil.ext_data", collection_key, Capability.ANY])
            updates_with_id.append((record_id, update))

        collection, fetch_context = self._collection_and_context_for_call(collection_key)

        # Permission checking run
        if not collection.update_records and not collection.update_record:
            raise Exception(f"{collection.name!r} is not available for update")

        for record_id, update in updates_with_id:
            for k in update.keys():
                if not fetch_context[k]:
                    raise Exception(f"Field {k!r} is not available for update")

        # Now we can do the update
        if collection.update_records:
            updated_values = collection.update_records(updates_with_id)
        elif collection.update_record:
            updated_values = [collection.update_record(rid, update) for rid, update in updates_with_id]
        else:
            raise TypeError(f"Collection {collection.name!r} does not implement update_record[s]()")

        if len(updated_values) != len(updates_with_id):
            raise ValueError(f"update_records() for {collection.name} returned {len(updated_values)} item(s) instead of {len(updates_with_id)}")

        for (cap, _), update in zip(updates, updated_values):
            cap.send_update(update)

    def delete_records(self, collection_key: str, to_delete: List[Capability]):
        if not _caller_is_trusted():
            raise Exception("Cannot delete records directly from the client")

        if not to_delete:
            return

        ids_to_delete: List[RecordId] = []
        for cap in to_delete:
            if cap.scope[1] != collection_key:
                raise ValueError(f"update_records() called with mismatched collection keys: argument says {collection_key}, cap says {cap.scope[1]}")
            _, _, record_id = unwrap_capability(cap, ["anvil.ext_data", collection_key, Capability.ANY])
            ids_to_delete.append(record_id)

        collection, fetch_context = self._collection_and_context_for_call(collection_key, None)
        # Permission checking run
        if not collection.delete_records and not collection.delete_record:
            raise Exception(f"{collection.name!r} is not available for deletion")

        if collection.delete_records:
            collection.delete_records(ids_to_delete)
        elif collection.delete_record:
            for rid in ids_to_delete:
                collection.delete_record(rid)
        else:
            raise TypeError(f"Collection {collection.name!r} does not implement delete_record[s]()")

        for cap in to_delete:
            cap.send_update(False)

    def make_record(self, collection_name: str, id: RecordId, data: dict) -> Record:
        ctxs = self.default_server_fetch_ctx if _caller_is_trusted() else self.default_client_fetch_ctx
        return ctxs[collection_name].make_record(id, data)

    def get_fetch_context(self, collection_name: str,
                          request: Optional[FieldSpec] = None,
                          client_visible: Optional[FieldSpecEntry] = None,
                          restriction: Optional[FieldSpec] = None,
                          for_client: Optional[bool] = None):
        if for_client is None:
            for_client = not _caller_is_trusted()

        client_visible_explicit = client_visible is not None
        if request is not None or client_visible_explicit:
            # Nonstandard context
            collection = self.collections[collection_name]
            return FetchContext(
                config=_FetchConfig(self, for_client, for_client and not client_visible_explicit),
                client_visible=client_visible if client_visible_explicit else True,
                client_visible_explicit=client_visible_explicit,
                request=request,
                restriction=restriction,
                collection=collection
            )
        else:
            default_contexts = self.default_client_fetch_ctx if for_client else self.default_server_fetch_ctx
            return default_contexts[collection_name]

    def get_fetch_context_from_json(self, collection_key: str, request: Optional[FieldSpec] = None):
        _, fetch_context = self._collection_and_context_for_call(collection_key, request)
        return fetch_context

    def load_records(self, fetch_context: FetchContext, ids: Iterable[RecordId]):
        collection_key = fetch_context._get_collection_info().key
        cdata, gsdata = self.load_record_data(
            collection_key,
            [Capability(["anvil.ext_data", collection_key, i]) for i in ids],
            request=fetch_context._request
        ).data
        return RecordList(cdata, gsdata, [(collection_key, i) for i in ids], self)

    def record_belongs_to_collection(self, record: Record, collection_name: str):
        if not isinstance(record, Record):
            return false
        s, c = record._schema_and_collection
        return s == self.name and c == collection_name
