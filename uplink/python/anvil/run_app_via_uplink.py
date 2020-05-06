import os, os.path, sys
import importlib
import anvil.server

url = os.environ.get("ANVIL_UPLINK_URL", "wss://anvil.works/uplink")
key = os.environ.get("ANVIL_UPLINK_KEY")

if len(sys.argv) < 2:
    print("Usage: %s <app_package_name>" % sys.argv[0])
    sys.exit(1)

app_pkg = sys.argv[1]
if app_pkg.endswith(os.path.sep):
    app_pkg = app_pkg[:-1]

if not key:
    print("ERROR: The ANVIL_UPLINK_KEY environment is not set.\n\n"
          "To run your Server Modules on this machine, set ANVIL_UPLINK_KEY\n"
          "to the uplink key for your application.\n\n"
          "To learn more, visit https://anvil.works/docs/uplink")
    sys.exit(1)

def import_all(paths, package_name):
    for path in paths:
        for f in os.listdir(path):
            fpath = os.path.join(path, f)
            if f.endswith(".py") and f != "__init__.py":
                print("Importing "+package_name+"."+f[:-3])
                submod = importlib.import_module(package_name+"."+f[:-3])
            elif os.path.isdir(fpath) and os.path.exists(os.path.join(fpath, "__init__.py")):
                print("Importing "+package_name+"."+f)
                subpkg = importlib.import_module(package_name+"."+f)
                import_all(subpkg.__path__, mod.__package__ or mod.__name__)

print("Importing %s" % app_pkg)
mod = importlib.import_module(app_pkg)
server_path = [p for p in mod.__path__ if p.endswith("server_code")]

if len(mod.__path__) != 2 or len(server_path) != 1:
    print("ERROR:\n%s is not an Anvil app package." % app_pkg)
    print("Follow these instructions to clone your app with Git:")
    print("  https://anvil.works/docs/version-control/git")
    sys.exit(1)

import_all(server_path, mod.__name__)

anvil.server.connect(key, url=url)

print("\n\n                      **** You're all set! ****\n\n"
      "You can use your app as normal, but your Server Modules will execute on this machine.\n"
      "To open your app, visit:")
print(anvil.server.get_app_origin())

anvil.server.wait_forever()
