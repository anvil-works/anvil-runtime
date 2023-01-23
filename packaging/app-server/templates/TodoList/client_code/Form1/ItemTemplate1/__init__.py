from _template import ItemTemplate1Template
from anvil import *
import anvil.server

class ItemTemplate1(ItemTemplate1Template):

  def __init__(self, **properties):
    # Set Form properties and Data Bindings.
    self.init_components(**properties)

    # Any code you write here will run before the form opens.

    # Create a CheckBox and add it to column "B" of the DataGrid on Form1
    self.completed_box = CheckBox(checked=self.item['complete'], align="center")
    self.add_component(self.completed_box, column="B")
    self.completed_box.set_event_handler('change', self.update_task)

    # Create a Button and add it to column "C" of the DataGrid on Form1
    self.delete_button = Button(icon='fa:trash', background='red', role='primary-color', align="center")
    self.add_component(self.delete_button, column="C")

    # Set an event handler on delete_button that will call delete_task
    self.delete_button.set_event_handler('click', self.delete_task)

  def update_task(self, **event_args):
    anvil.server.call('update_task', task=self.item, complete=self.completed_box.checked)
    Notification('Task Updated!').show()

  def delete_task(self, **event_args):
    # Raise an event on the parent RepeatingPanel to delete the task
    self.parent.raise_event('x-delete-task', task=self.item)
