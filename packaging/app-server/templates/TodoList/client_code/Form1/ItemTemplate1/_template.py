from anvil import *

class ItemTemplate1Template(DataRowPanel):

  def init_components(self, **properties):
  	# Initialise GridPanel
    super().__init__()

    # Initialise custom properties here
    self.item = properties.get('item', {})
