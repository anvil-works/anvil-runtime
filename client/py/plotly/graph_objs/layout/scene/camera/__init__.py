
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Center(WrappedObject):
    _name = "Center"
    _module = "plotly.graph_objs.layout.scene.camera"

@serializable_type
class Eye(WrappedObject):
    _name = "Eye"
    _module = "plotly.graph_objs.layout.scene.camera"

@serializable_type
class Projection(WrappedObject):
    _name = "Projection"
    _module = "plotly.graph_objs.layout.scene.camera"

@serializable_type
class Up(WrappedObject):
    _name = "Up"
    _module = "plotly.graph_objs.layout.scene.camera"


__all__ = [
    'Center',
    'Eye',
    'Projection',
    'Up',
]