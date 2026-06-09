import anvil
from anvil.server import AnvilWrappedError, portable_class

from .._errors import NoSuchColumnError
from ._constants import NOT_FOUND
from ._utils import maybe_handle_descriptors

row_cls_by_id = {}

global _Row


def getattr_impl(self, attr):
    try:
        return self[attr]
    except (AnvilWrappedError, NoSuchColumnError):
        raise AttributeError(attr)


def setattr_impl(self, attr, val):
    if not maybe_handle_descriptors(self, attr, val):
        self[attr] = val


def _clear_cache():
    # private method for clearing the cache
    row_cls_by_id.clear()


COMMON_SPELLING_ERRORS = {
    "client_writeable": "client_writable",
    "client_updateable": "client_updatable",
    "client_createable": "client_creatable",
    "client_deleteable": "client_deletable",
}


def is_server_class_method(method):
    if not isinstance(method, anvil.server.server_method):
        return False
    return getattr(method, "_is_class_method", False)


def override_server_class_methods(cls, most_base):
    """
    a hack
    if we have a client model and a server model that inherits from the client model
    then if the client model calls a server_method classmethod directly on the server
    then it should actually call the server model's server_method classmethod instead
    """
    my_dict = cls.__dict__
    for base in cls.__bases__:
        if base is most_base:
            return
        for attr, method in base.__dict__.items():
            my_method = my_dict.get(attr)
            if my_method is None:
                continue
            if not is_server_class_method(method):
                continue
            if not is_server_class_method(my_method):
                continue

            setattr(base, attr, my_method)


def get_base_model_cls(table_id):
    cls = row_cls_by_id.get(table_id)
    if cls is not None:
        return cls

    global _Row
    from ._app_tables import _table_cache
    from ._row import Row as _Row

    _table_cache = _table_cache or {}

    tb_name = next(
        (name for name, args in (_table_cache).items() if str(args[-1]) == table_id),
        None,
    )

    class Row(_Row):
        __slots__ = ()
        _Row_model_ = None
        _Row_permissions_ = {"update": False, "create": False, "delete": False}
        _Row_buffered_ = False

        def __new__(cls, **buffer):
            cls = get_model_cls(table_id)
            self = object.__new__(cls)
            self._anvil_setup(None, table_id, None, buffer=buffer)
            return self

        @classmethod
        def _do_create(cls, values, from_client, **kws):
            trusted_values = kws.pop("trusted_values", None)
            if kws:
                raise TypeError("Unexpected keyword arguments: {}".format(kws))

            from . import get_table_by_id

            from ._row import _make_request_overrides

            use_client_config = cls._anvil_use_client_config("create", from_client)
            table = get_table_by_id(table_id)

            return table._do_add_row(
                values,
                _make_request_overrides(use_client_config, from_client),
                trusted_values,
            )

        def __init_subclass__(
            cls,
            attrs=False,
            buffered=False,
            client_writable=False,
            client_updatable=NOT_FOUND,
            client_creatable=NOT_FOUND,
            client_deletable=NOT_FOUND,
            **kws,
        ):
            cls_dict = cls.__dict__
            for attr in (
                "__deserialize__",
                "__serialize__",
                "__init__",
                "__new__",
                "__new_deserialized__",
            ):
                if cls_dict.get(attr):
                    msg = "It is not possible to customize the method {!r} for {}.{}".format(
                        attr, cls.__module__, cls.__name__
                    )
                    raise TypeError(msg)

            cls._Row_prefix_ = "{}.{}".format(cls.__module__, cls.__name__)
            if attrs and not hasattr(cls, "__getattr__"):
                cls.__getattr__ = getattr_impl
                cls.__setattr__ = setattr_impl

            if buffered:
                cls._Row_buffered_ = True

            row_permissions = {}

            for perm_type, value in [
                ("update", client_updatable),
                ("create", client_creatable),
                ("delete", client_deletable),
            ]:
                if value is not NOT_FOUND:
                    row_permissions[perm_type] = value
                    continue

                if client_writable:
                    row_permissions[perm_type] = True
                    continue

                # use the inherited permission
                super_permission = cls._Row_permissions_[perm_type]
                row_permissions[perm_type] = super_permission

            cls._Row_permissions_ = row_permissions

            if kws:
                # check if something is misspelt
                for a, b in COMMON_SPELLING_ERRORS.items():
                    if a in kws:
                        msg = "Parameter '{}' is misspelled. Did you mean '{}'?".format(
                            a, b
                        )
                        raise TypeError(msg)
                raise TypeError("Unexpected keyword arguments: {}".format(kws))

            override_server_class_methods(cls, Row)

            # models are portable by default
            # the first subclass gets registered
            # subsequent models use the same name
            # A model can override this in advanced use cases e.g. uplink implementations
            if Row._Row_model_ is Row:
                portable_class(cls)
            else:
                name = Row._Row_model_.SERIALIZATION_INFO[0]
                portable_class(name)(cls)

            Row._Row_model_ = cls

    # This allows us to pretend that the model class is the Row class for serialization
    Row.__name__ = _Row.__name__
    Row.__module__ = _Row.__module__
    Row.__qualname__ = _Row.__qualname__

    Row._Row_model_ = Row
    if tb_name:
        Row._Row_prefix_ = "app_tables.{}.Row".format(tb_name)
    row_cls_by_id[table_id] = Row

    # we'll be overriding the base Row class in the portable classes registry
    # But that's fine since Row._anvil_create checks the correct Row subclass to __new__
    return portable_class(Row)


def get_model_cls(table_id):
    return get_base_model_cls(table_id)._Row_model_


def serialize_model(table_id, force=False):
    model = get_model_cls(table_id)
    if model is None or model is row_cls_by_id.get(table_id) and not force:
        return None
    return model
