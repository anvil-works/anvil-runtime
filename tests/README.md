I just want to run the tests

1. ./run_tests

Adding a new tests/test apps

1. For each test file you must choose a test app to run against.
2. To add an new test app, add a new app to the apps directory
3. Create a conf file in the app's directory
4. In your test fixture create your server with app_server_set_up.set_up_app_server("test app folder name")
