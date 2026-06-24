import importlib
from . import _components
from . import _server

# Filled in by the downlink_worker package
packages_by_app_id = {}
LEGACY_CUSTOM_COMPONENT_SPEC_PREFIX = "form:"


def _get_form_class_for_component_yaml_type(component_yaml_type):
    # In downlink form templates, legacy form: specs use app IDs from
    # packages_by_app_id. They are not runtime logicalDepId aliases.
    if component_yaml_type.startswith(LEGACY_CUSTOM_COMPONENT_SPEC_PREFIX):
        custom_component_spec = component_yaml_type[
            len(LEGACY_CUSTOM_COMPONENT_SPEC_PREFIX) :
        ]
        spec_parts = custom_component_spec.split(":")
        if len(spec_parts) == 2:
            app_id = spec_parts[0]
            app_local_form_name = spec_parts[1]
        elif len(spec_parts) == 1:
            app_id = ""
            app_local_form_name = spec_parts[0]
        else:
            raise ValueError(
                "Can't instantiate custom component %s" % component_yaml_type
            )

        package_name = packages_by_app_id.get(app_id)
        if package_name is None:
            raise ValueError(
                "Unknown app id %s for component %s" % (app_id, component_yaml_type)
            )

        package_qualified_form_name = package_name + "." + app_local_form_name
        class_name = app_local_form_name.split(".")[-1]
    elif "." in component_yaml_type and not component_yaml_type.startswith("anvil."):
        package_qualified_form_name = component_yaml_type
        class_name = component_yaml_type.rsplit(".", 1)[1]
    else:
        return None

    form_mod = importlib.import_module(package_qualified_form_name)
    return getattr(form_mod, class_name)


def mk_component(yaml, components_by_name):
    component_yaml_type = yaml["type"]
    form_cls = _get_form_class_for_component_yaml_type(component_yaml_type)
    if form_cls is not None:
        return form_cls(**yaml.get("properties", {}))
    else:
        try:
            cls = getattr(_components, component_yaml_type)
        except AttributeError:
            # Okay, make a dummy
            obj = (
                _components.Container()
                if "components" in yaml
                else _components.Component()
            )
            obj.SERIALIZATION_INFO = "anvil." + component_yaml_type, type(obj)
        else:
            obj = cls(**yaml["properties"])

        if isinstance(obj, _components.Container):
            for c in yaml.get("components", []):
                obj.add_component(mk_component(c, components_by_name), **c.get("layout_properties", {}))  # fmt: off

        components_by_name[yaml["name"]] = obj

        return obj


def init_components_on_form(form, components):
    components_by_name = {}
    for c in components:
        form.add_component(
            mk_component(c, components_by_name), **c.get("layout_properties", {})
        )

    for n, c in components_by_name.items():
        setattr(form, n, c)


def mk_template_class(form_yaml):
    ns = {}
    container_yaml_type = form_yaml["container"]["type"]
    container_cls = _get_form_class_for_component_yaml_type(
        container_yaml_type
    ) or getattr(_components, container_yaml_type)
    default_custom_props = {}
    if form_yaml.get("custom_component"):
        for pt in form_yaml.get("properties", []):
            if "default_value" in pt:
                default_custom_props[pt["name"]] = pt["default_value"]

    def __new__(cls, **kwargs):
        container_new = container_cls.__new__

        # This is a hack using the fact that component properties don't actually have any behaviour
        # on the server
        obj = container_new(cls)
        obj.__dict__["$_components"] = []
        obj.__dict__["$container_props"] = dict(form_yaml["container"]["properties"])

        # No event binding
        # No data bindings

        container_cls.__init__(obj, __ignore_property_exceptions=True, **kwargs)

        init_components_on_form(obj, form_yaml["components"])

        return obj

    ns["__new__"] = __new__

    def __getattr__(self, name):
        if name in default_custom_props:
            return default_custom_props[name]

        cp = self.__dict__["$container_props"]
        try:
            return cp[name]
        except KeyError:
            raise AttributeError(name)

    ns["__getattr__"] = __getattr__

    def __setattr__(self, name, value):
        cp = self.__dict__["$container_props"]
        if name in cp:
            cp[name] = value
        else:
            object.__setattr__(self, name, value)

    ns["__setattr__"] = __setattr__

    def __init__(self, __ignore_property_exceptions=False, **kwargs):
        for n, v in kwargs.items():
            setattr(self, n, v)

    ns["__init__"] = ns["init_components"] = __init__

    def __serialize_once__(self, global_data):
        d = dict(self.__dict__)
        components = d.pop("$_components")
        container_props = d.pop("$container_props")

        return {"d": d, "a": container_props, "c": components}

    ns["__serialize_once__"] = __serialize_once__

    def __deserialize__(self, data, global_data):
        self.__dict__["$_components"] = data["c"]
        self.__dict__["$container_props"] = data["a"]
        self.__dict__.update(data["d"])

    ns["__deserialize__"] = __deserialize__

    ns["refresh_data_bindings"] = lambda: None

    template_name = str(form_yaml["class_name"].split(".")[-1]) + "Template"

    return type(template_name, (container_cls, _server.SerializeWithIdentity), ns)
