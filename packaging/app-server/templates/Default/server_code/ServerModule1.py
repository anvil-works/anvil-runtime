import anvil.server

# This is a server module. It runs on the server, rather than in the user's browser.
#
# To allow anvil.server.call() to call functions here, we mark
# them with @anvil.server.callable.


@anvil.server.callable
def say_hello_name(name):
  return f"Hello from the server, {name}!"
