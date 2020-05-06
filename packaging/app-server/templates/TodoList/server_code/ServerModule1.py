import anvil.server
import anvil.tables as tables
import anvil.tables.query as q
from anvil.tables import app_tables

# This is a server module. It runs on the server, rather than in the user's browser.
#
# To allow anvil.server.call() to call functions here, we mark
# them with @anvil.server.callable.


@anvil.server.callable
def add_tasks():
  app_tables.tasks.add_row(name="Buy the shopping", complete=False)
  app_tables.tasks.add_row(name="Walk the dog", complete=False)


@anvil.server.callable
def get_tasks():
  return app_tables.tasks.search()


@anvil.server.callable
def add_task(name):
  app_tables.tasks.add_row(name=name, complete=False)


@anvil.server.callable
def update_task(task, complete):
  if app_tables.tasks.has_row(task):
	  task.update(complete=complete)


@anvil.server.callable
def delete_task(task):
  if app_tables.tasks.has_row(task):
	  task.delete()