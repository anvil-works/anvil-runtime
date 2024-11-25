import pytest
import app_server_set_up
import requests
import anvil.server


@pytest.fixture(scope="module")
def smoke_test_app_server():
    app_server = app_server_set_up.set_up_app_server("SmokeTestAppOn3030.yaml")
    yield app_server
    app_server_set_up.clear_db_and_stop_app_server(app_server)


def test_app_runs(smoke_test_app_server):
    response = requests.get(smoke_test_app_server.origin)
    assert response.status_code == 200


def test_add_line_to_db(smoke_test_app_server):
    test_string = "foo"
    response = anvil.server.call("add_line_to_db", test_string)
    assert response == test_string
    assert anvil.server.call("count_rows") == 1
