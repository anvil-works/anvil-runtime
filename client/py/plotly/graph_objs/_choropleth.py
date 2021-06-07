
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Choropleth(WrappedObject):
    _name = "Choropleth"
    _module = "plotly.graph_objs._choropleth"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='choropleth', **kwargs)
