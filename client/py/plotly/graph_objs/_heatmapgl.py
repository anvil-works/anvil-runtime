
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Heatmapgl(WrappedObject):
    _name = "Heatmapgl"
    _module = "plotly.graph_objs._heatmapgl"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='heatmapgl', **kwargs)
