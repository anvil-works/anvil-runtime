
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Axis(WrappedObject):
    _name = "Axis"
    _module = "plotly.graph_objs.indicator.gauge"

@serializable_type
class Bar(WrappedObject):
    _name = "Bar"
    _module = "plotly.graph_objs.indicator.gauge"

@serializable_type
class Step(WrappedObject):
    _name = "Step"
    _module = "plotly.graph_objs.indicator.gauge"

@serializable_type
class Threshold(WrappedObject):
    _name = "Threshold"
    _module = "plotly.graph_objs.indicator.gauge"


__all__ = [
    'Axis',
    'Bar',
    'Step',
    'Threshold',
    'axis',
    'bar',
    'step',
    'threshold',
]

from plotly.graph_objs.indicator.gauge import axis
from plotly.graph_objs.indicator.gauge import bar
from plotly.graph_objs.indicator.gauge import step
from plotly.graph_objs.indicator.gauge import threshold
