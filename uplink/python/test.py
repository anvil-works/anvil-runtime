#!/usr/bin/env python

__author__ = 'meredydd'
import sys
import anvil.server

#import uplink_connect
anvil.server.connect("P6PUPCUEX3FFRN7C-FAVQJA", url="ws://localhost:3000/uplink")
#anvil.server.connect("GOW3BOKS5V2T4UW4-NTQAEQ")
#anvil.server.connect("44O3TZYJVAQ3THE5-TDPUPN XX", url="wss://anvil.works:444/uplink")


@anvil.server.callable
def my_server_fn(v):
    v["Name"] = "Alice"
    return v



@anvil.server.live_object_backend
class MyLiveThing(anvil.LiveObject):

    @staticmethod
    def create_by_id(id):
        return MyLiveThing({
            "backend": "uplink.MyLiveThing",
            "id": id,
            "permissions": [],
            "methods": ["do_something"]
        })

    def do_something(self):
        return 42


@anvil.server.callable
def get_live_thing():
    return MyLiveThing.create_by_id("123")

print("Echoing:")
#anvil.DataMedia("text/plain", "Meredydd"*10000)
print(anvil.server.call("say_hello", "Meredydd"))

#anvil.server.wait_forever()
sys.exit(0)
