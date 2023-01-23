from _template import Form1Template
from anvil import *
import anvil.server


class Form1(Form1Template):

  def __init__(self, **properties):
    # Set Form properties and Data Bindings.
    self.init_components(**properties)

    # Any code you write here will run before the form opens.

    # Get tasks from the database and set the `items` property of the RepeatingPanel
    self.get_tasks()

    self.add_task_button.set_event_handler('click', self.add_task_button_click)
    self.new_task_box.set_event_handler('pressed_enter', self.add_task_button_click)

  
  def get_tasks(self):
    tasks = anvil.server.call('get_tasks')
    self.tasks_panel.items = tasks


  def add_task_button_click(self, **event_args):
    if self.new_task_box.text:
      anvil.server.call('add_task', self.new_task_box.text)
      self.new_task_box.text = ""
      self.get_tasks()

  def delete_task(self, task, **event_args):
    if alert(f"Are you sure you want to delete task: {task['name']}?", buttons=[('No', False),('Yes', True)]):
      anvil.server.call('delete_task', task)
      self.get_tasks()






