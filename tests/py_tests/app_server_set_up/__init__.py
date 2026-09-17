import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time

import anvil.server
from anvil.tables import app_tables
import requests
import yaml


class AppServer:
    def __init__(self, server_process, origin, output):
        self.server_process = server_process
        self.origin = origin
        self.output = output


def set_up_app_server(config):
    config_path = Path("configs") / config
    config_file = yaml.safe_load(config_path.read_text())
    origin = f"http://localhost:{config_file['port']}"
    output = tempfile.TemporaryFile(mode="w+")
    server_process = subprocess.Popen(
        ["lein", "run", "--config-file", str(config_path)],
        # Leiningen launches a child JVM; stop the whole group between test apps.
        start_new_session=True,
        stdout=output,
        stderr=subprocess.STDOUT,
    )
    app_server = AppServer(server_process, origin, output)
    try:
        deadline = time.monotonic() + 120
        while server_process.poll() is None and time.monotonic() < deadline:
            try:
                if requests.get(origin, timeout=0.5).status_code == 200:
                    break
            except requests.exceptions.RequestException:
                pass
            time.sleep(0.5)
        else:
            output.seek(0)
            raise RuntimeError(f"App Server failed to start:\n{output.read()}")

        anvil.server.connect(
            config_file["uplink-key"],
            url=f"ws://localhost:{config_file['port']}/_/uplink",
        )
        return app_server
    except BaseException:
        stop_app_server(app_server)
        raise


def stop_app_server(app_server):
    anvil.server.disconnect()
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(app_server.server_process.pid, sig)
        except ProcessLookupError:
            pass
        try:
            app_server.server_process.wait(timeout=30)
            break
        except subprocess.TimeoutExpired:
            continue
    app_server.output.close()


def clear_db_and_stop_app_server(app_server):
    try:
        for table in list(app_tables):
            getattr(app_tables, table).delete_all_rows()
    finally:
        stop_app_server(app_server)
