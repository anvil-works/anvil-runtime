from _template import Form1Template
from anvil import *
import anvil.server

class Form1(Form1Template):

  def __init__(self, **properties):
    # Set Form properties and Data Bindings.
    self.init_components(**properties)

    # Any code you write here will run before the form opens.


  def button_1_click(self, **event_args):
    server_text = anvil.server.call('say_hello_name', self.text_box_1.text)
    alert(server_text)


