
from anvil.util import WrappedObject, WrappedList
from anvil.server import serializable_type


@serializable_type
class Impliededits(WrappedObject):
    _name = "Impliededits"
    _module = "plotly.graph_objs.layout.scene.aspectratio"


__all__ = [
    'Impliededits',
]