from pathlib import Path
import shutil

import anvil.server
import app_server_set_up
import psycopg2
import pytest
import requests
import yaml


@pytest.fixture(scope="module", params=["legacy", "accelerated", "split"])
def smoke_test_app_server(request, tmp_path_factory):
    work_dir = tmp_path_factory.mktemp(request.param)
    app_dir = work_dir / "app"
    shutil.copytree("apps/SmokeTest", app_dir)
    app_file = app_dir / "anvil.yaml"
    app = yaml.safe_load(app_file.read_text())
    app["services"][0]["client_config"] = {
        "enable_v2": request.param != "legacy",
        "enable_split": request.param == "split",
    }
    app_file.write_text(yaml.safe_dump(app))

    config = yaml.safe_load(Path("configs/SmokeTestAppOn3030.yaml").read_text())
    data_dir = work_dir / "data"
    data_dir.mkdir()
    port = 3030 + ["legacy", "accelerated", "split"].index(request.param)
    config.update({
        "app": str(app_dir),
        "data-dir": str(data_dir),
        "port": port,
        "origin": f"http://localhost:{port}",
    })
    config_file = work_dir / "config.yaml"
    config_file.write_text(yaml.safe_dump(config))
    app_server = app_server_set_up.set_up_app_server(config_file)
    app_server.data_dir = data_dir
    app_server.split = request.param == "split"
    try:
        yield app_server
    finally:
        app_server_set_up.clear_db_and_stop_app_server(app_server)


def test_app_runs(smoke_test_app_server):
    response = requests.get(smoke_test_app_server.origin)
    assert response.status_code == 200


def test_table_storage_mode(smoke_test_app_server):
    # Check the database itself: CRUD also passes if enable_split is ignored.
    data_dir = smoke_test_app_server.data_dir
    port = (data_dir / "db/postmaster.pid").read_text().splitlines()[3]
    with psycopg2.connect(
        host="localhost", port=port, user="postgres", dbname="postgres",
        password=(data_dir / "postgres.password").read_text(),
    ) as db:
        with db.cursor() as cursor:
            cursor.execute("""
                SELECT COALESCE((storage->>'split')::boolean, false), c.relkind
                FROM app_storage_tables t
                JOIN app_storage_access a ON a.table_id = t.id
                JOIN pg_class c ON c.oid = ('data_tables.table_' || t.id)::regclass
                WHERE a.python_name = 'table_1'
            """)
            assert cursor.fetchall() == [
                (smoke_test_app_server.split, "r" if smoke_test_app_server.split else "v")
            ]


def test_add_line_to_db(smoke_test_app_server):
    test_string = "foo"
    response = anvil.server.call("add_line_to_db", test_string)
    assert response == test_string
    assert anvil.server.call("count_rows") == 1
