
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Currentvalue(WrappedObject):
    _name = "Currentvalue"
    _module = "plotly.graph_objs.layout.slider"

@serializable_type
class Font(WrappedObject):
    _name = "Font"
    _module = "plotly.graph_objs.layout.slider"

@serializable_type
class Pad(WrappedObject):
    _name = "Pad"
    _module = "plotly.graph_objs.layout.slider"

@serializable_type
class Step(WrappedObject):
    _name = "Step"
    _module = "plotly.graph_objs.layout.slider"

@serializable_type
class Transition(WrappedObject):
    _name = "Transition"
    _module = "plotly.graph_objs.layout.slider"


__all__ = [
    'Currentvalue',
    'Font',
    'Pad',
    'Step',
    'Transition',
    'currentvalue',
]

from plotly.graph_objs.layout.slider import currentvalue
