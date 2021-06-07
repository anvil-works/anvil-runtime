
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Layout(WrappedObject):
    _name = "Layout"
    _module = "plotly.graph_objs._layout"
