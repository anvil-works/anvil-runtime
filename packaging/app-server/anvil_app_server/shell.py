# Launch an interactive shell against an Anvil app
import code, os, sys

# All your Anvil apps and dependencies should, of course, be on the path
sys.path += os.environ["ANVIL_APP_PATH"].split(":")

# Preload a bunch of useful modules
import anvil.server, anvil.tables, anvil.users, anvil.email, anvil.media, anvil.tz, anvil.secrets, \
         anvil.google.auth, anvil.facebook.auth, anvil.microsoft.auth, anvil.stripe
from anvil.tables import app_tables

anvil.server.connect(os.environ["ANVIL_UPLINK_KEY"], url=os.environ["ANVIL_UPLINK_URL"])

code.interact(banner="""
This Python interpreter is connected to your Anvil app via the Uplink.
You can also import your app's code.

Try: anvil.server.call("some_function")
""", local=locals())
