
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Choroplethmapbox(WrappedObject):
    _name = "Choroplethmapbox"
    _module = "plotly.graph_objs._choroplethmapbox"

    def __init__(self, d=None, **kwargs):
        WrappedObject.__init__(self, d, type='choroplethmapbox', **kwargs)
