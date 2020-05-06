
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Tickfont(WrappedObject):
    _name = "Tickfont"
    _module = "plotly.graph_objs.indicator.gauge.axis"

@serializable_type
class Tickformatstop(WrappedObject):
    _name = "Tickformatstop"
    _module = "plotly.graph_objs.indicator.gauge.axis"


__all__ = [
    'Tickfont',
    'Tickformatstop',
]