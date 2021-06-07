
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Rangebreak(WrappedObject):
    _name = "Rangebreak"
    _module = "plotly.graph_objs.layout.xaxis"

@serializable_type
class Rangeselector(WrappedObject):
    _name = "Rangeselector"
    _module = "plotly.graph_objs.layout.xaxis"

@serializable_type
class Rangeslider(WrappedObject):
    _name = "Rangeslider"
    _module = "plotly.graph_objs.layout.xaxis"

@serializable_type
class Tickfont(WrappedObject):
    _name = "Tickfont"
    _module = "plotly.graph_objs.layout.xaxis"

@serializable_type
class Tickformatstop(WrappedObject):
    _name = "Tickformatstop"
    _module = "plotly.graph_objs.layout.xaxis"

@serializable_type
class Title(WrappedObject):
    _name = "Title"
    _module = "plotly.graph_objs.layout.xaxis"


__all__ = [
    'Rangebreak',
    'Rangeselector',
    'Rangeslider',
    'Tickfont',
    'Tickformatstop',
    'Title',
    'rangeselector',
    'rangeslider',
    'title',
]

from plotly.graph_objs.layout.xaxis import rangeselector
from plotly.graph_objs.layout.xaxis import rangeslider
from plotly.graph_objs.layout.xaxis import title
