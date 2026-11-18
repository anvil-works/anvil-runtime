"""Helpers for testing code that uses anvil.server."""

from __future__ import absolute_import

import time

import anvil.server


#!defModule(anvil.testing.server)!1: "This module contains helpers for testing server code that uses `anvil.server`."


#!defFunction(anvil.testing.server,%,[timeout=5])!2:
# {
#   $doc: "If the app's code has launched background tasks in this test run, wait for them to finish.\n\nRaises `anvil.server.TimeoutError` if any are still running after `timeout` seconds.\n\n```python\nwith capture_emails() as emails:\n    place_order(user, items)  # Sends a receipt from a background task\n    wait_for_background_tasks_to_finish()\n\n[receipt] = emails\n```",
#   anvil$args: {
#     timeout: "How many seconds to wait before timing out.",
#   },
# }["wait_for_background_tasks_to_finish"]
def wait_for_background_tasks_to_finish(timeout=5):
    """If the app's code has launched background tasks in this test run, wait for them to finish.

    Raises `anvil.server.TimeoutError` if any are still running after `timeout` seconds.

    ```python
    with capture_emails() as emails:
        place_order(user, items)  # Sends a receipt from a background task
        wait_for_background_tasks_to_finish()

    [receipt] = emails
    ```
    """
    deadline = time.time() + timeout
    delay = 0.1
    while True:
        running = [task for task in anvil.server.list_background_tasks()
                   if task.get_termination_status() is None]

        if not running:
            return
        if time.time() >= deadline:
            raise anvil.server.TimeoutError("Background tasks still running after %s seconds: %s"
                                            % (timeout, ", ".join(task.get_task_name() for task in running)))
        time.sleep(delay)
        delay = min(delay * 1.5, 1.0)
