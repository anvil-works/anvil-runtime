#!/usr/bin/env python

__author__ = 'ian'
import sys
import anvil.server
from time import sleep

anvil.server.connect("PK7W4SKE3NGEYUU76RK6EGZO-R5S3NRQMZHY3A7WV", url="ws://127.0.0.1:3000/uplink")

@anvil.server.callable
def get_the_answer():
    return 42

@anvil.server.background_task
def long_thing(n):
    anvil.server.task_state = "Sleeping"
    sleep(n)
    anvil.server.task_state = "Done"
    return 42

anvil.server.wait_forever()
sys.exit(0)
