# State for the currently-running Anvil script.
#
# While a script (an app's scripts/*.py, run as the background task "script:<name>") is
# executing, the downlink worker populates this module; see anvil.server.run_script() for
# launching scripts and collecting return_value. Outside a running script these are just the
# defaults below. On the client, anvil.script is a stub that raises on use.

#!defModuleAttr(anvil.script)!1: {name: 'args', type: 'tuple', description: 'The positional arguments this script was launched with (also available as sys.argv[1:], except that Media arguments appear in sys.argv as the names of temporary files containing their content).'}
args = ()

#!defModuleAttr(anvil.script)!1: {name: 'return_value', type: 'any', description: 'Set this from your script to return a value to anvil.server.run_script(). Defaults to None.'}
return_value = None
