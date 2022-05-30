"""A module for creating an Anvil app (and if necessary an Anvil account) from
the command line or via API, returning an app object with an Uplink key."""

from http import client
import json, re, sys, time
import anvil.server

input_fn = raw_input if sys.version_info[0] < 3 else input

CREATOR_APP_KEY="client_SHAMM7JH74E3HZQ4Y2WFK2FV-EZY7I4WKHGYU2BSK"


class App(object):
    def __init__(self, id, uplink_key, origin, email, name, **kwargs):
        self.id = id
        self.uplink_key = uplink_key
        self.client_uplink_key = kwargs.get("client_uplink_key")
        self.origin = origin
        self.email = email
        self.name = name
        self.__dict__.update(kwargs)

    def connect(self, **kw):
        anvil.server.connect(self.uplink_key, **kw)
        return self


def create_app(example_name, email=None):
    filename = "./anvil-app-{}.json".format(example_name)

    # Have we already cloned this app?
    existing_app = None
    try:
        with open(filename, "r") as f:
            existing_app = App(**json.load(f))
    except:
        pass
    if existing_app:
        print("Anvil app already created. Click here to edit it:\n")
        print("   https://anvil.works/build#app:{}\n".format(existing_app.id))
        print("Or click here to visit the app directly:\n")
        print("   {}\n".format(existing_app.origin))
        print("Your  uplink key is: {}\n".format(existing_app.uplink_key))
        print("(To create a fresh example app, run 'rm {}', then run this script again.)\n".format(filename))
        return existing_app

    print("Connecting to Anvil to set this app up...")
    anvil.server.connect(CREATOR_APP_KEY, quiet=True)
    print("Connected.")

    while email is None or not re.match(r"^[\w\+_\-\.]+@[\w\+\-\.]+\.\w+", email):
        if email is not None:
            print("I don't think '{}' is a valid email address.".format(email))
        email = input_fn("Enter your email address to create an Anvil account (or create this app in your existing account): ")

    poll_token = anvil.server.call("clone_example", email, example_name)

    print("\nWe've sent an email to {}. Open your email and click the link.".format(email))
    print("Waiting...")

    cloned_apps = None

    while cloned_apps is None:
        time.sleep(2)
        cloned_apps = anvil.server.call("poll_example", email, poll_token, v=2)

    anvil.server.disconnect()

    app = App(email=email, **cloned_apps[0])

    print("Anvil app created! Click here to edit it:\n")
    print("   https://anvil.works/build#app:{}\n".format(app.id))
    print("Or click here to visit the app directly:\n")
    print("   {}\n".format(app.origin))
    print("Your  uplink key is: {}\n".format(app.uplink_key))

    try:
        with open(filename, "w") as f:
            json.dump(app.__dict__, f)
    except Exception as e:
        print("WARNING: Could not save your app details to {}. Running this script again will result in a new app being created.".format(filename))
        print(e)

    return app

if __name__ == "__main__":

    create_app(sys.argv[1], sys.argv[2])