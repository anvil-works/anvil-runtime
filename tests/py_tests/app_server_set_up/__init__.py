import requests
import subprocess
import time
import anvil.server
import yaml
from anvil.tables import app_tables


class AppServer:
    def __init__(self, server_process, origin):
        self.server_process = server_process
        self.origin = origin


def set_up_app_server(config):
    server_process = subprocess.Popen(
        ["lein", "run", "--config-file", f"./configs/{config}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )

    with open(f"./configs/{config}", "r") as file:
        config_file = yaml.safe_load(file)

    while not server_process.poll():
        try:
            requests.get(
                f"http://localhost:{config_file['port']}",
                timeout=0.5,  # seting timeout lower results in requests.exceptions.ReadTimeout
            ).status_code == 200
            break
        except requests.exceptions.ConnectionError:
            time.sleep(0.5)

    assert not server_process.poll(), server_process.stdout.read().decode("utf-8")

    anvil.server.connect(
        config_file["uplink-key"],
        url=f"ws://localhost:{config_file['port']}/_/uplink",
    )
    return AppServer(server_process, f"http://localhost:{config_file['port']}")


def clear_db_and_stop_app_server(app_server):
    for table in list(app_tables):
        getattr(app_tables, table).delete_all_rows()
    app_server.server_process.terminate()
