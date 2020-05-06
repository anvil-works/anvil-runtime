
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class AngularAxis(WrappedObject):
    _name = "AngularAxis"
    _module = "plotly.graph_objs.layout.polar"

@serializable_type
class Domain(WrappedObject):
    _name = "Domain"
    _module = "plotly.graph_objs.layout.polar"

@serializable_type
class RadialAxis(WrappedObject):
    _name = "RadialAxis"
    _module = "plotly.graph_objs.layout.polar"


__all__ = [
    'AngularAxis',
    'Domain',
    'RadialAxis',
    'angularaxis',
    'radialaxis',
]

from plotly.graph_objs.layout.polar import angularaxis
from plotly.graph_objs.layout.polar import radialaxis
