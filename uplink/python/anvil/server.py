from __future__ import unicode_literals
import threading, time, json, random, string, logging

from ws4py.client.threadedclient import WebSocketClient

import anvil
from . import _server, _serialise, _threaded_server
from ._threaded_server import live_object_backend, LazyMedia, _switch_session, call_context as context

from ._server import (register, 
                      callable, 
                      background_task, 
                      callable_as, 
                      Serializable,
                      serializable_type,
                      _register_exception_type, 
                      AnvilWrappedError, 
                      SerializationError, 
                      InternalError, 
                      InvalidResponseError, 
                      RuntimeUnavailableError, 
                      QuotaExceededError, 
                      UplinkDisconnectedError, 
                      ExecutionTerminatedError, 
                      TimeoutError, 
                      NoServerFunctionError, 
                      CookieError, 
                      _FailError, 
                      BackgroundTaskError,
                      BackgroundTaskNotFound,
                      BackgroundTaskKilled,
                      http_endpoint, 
                      api_request as request, 
                      HttpResponse, 
                      Capability,
                      cookies,
                      CallContext)

_threaded_server.send_reqresp = lambda r, collect_capabilities=None: _get_connection().send_reqresp(r, collect_capabilities=collect_capabilities)

__author__ = 'Meredydd Luff <meredydd@anvil.works>'

_url = 'wss://anvil.works/uplink'

logging.getLogger("ws4py").setLevel(logging.CRITICAL)

_connection = None
_connection_lock = threading.Lock()

class ConnectionContext(threading.local):
    def __init__(self):
        self.is_initalising_session = False

_connection_ctx = ConnectionContext()

_backends = {}

_fatal_error = None
_quiet = False

_init_session = None

_get_extra_headers = lambda: {}

# Override _threaded_server; we have a constant global AppInfo object
anvil.app = anvil._AppInfo(None,None)
# and we are executing on an uplink
CallContext._DEFAULT_TYPE = "uplink"
context.type = "uplink"

def reconnect(closed_connection):
    global _connection
    with _connection_lock:
        if _connection != closed_connection:
            return
        _connection = None

    def retry():
        # We may want to move this retry-forever loop into _get_connection, depending on whether we want
        # uplink scripts to fail immediately or not.
        while True:
            time.sleep(1)
            print("Reconnecting Anvil Uplink...")
            try:
                _get_connection()
                break
            except:
                print("Reconnection failed. Waiting 10 seconds, then retrying.")
                time.sleep(10)

    try:
        _threaded_server.kill_outstanding_requests('Connection to Anvil Uplink server lost')

    finally:
        threading.Thread(target=retry).start()


class _Connection(WebSocketClient):
    def __init__(self, headers={}):
        if not _quiet:
            print("Connecting to " + _url)
        WebSocketClient.__init__(self, _url, headers=headers)

        self._ready_notify = threading.Condition()
        self._ready = False
        self._sending_lock = threading.RLock()

    def is_ready(self):
        return self._ready

    def wait_until_ready(self):
        with self._ready_notify:
            while not self._ready:
                self._ready_notify.wait()

    def _signal_ready(self):
        self._ready = True
        with self._ready_notify:
            self._ready_notify.notifyAll()

    def _register_server_functions(self):
        for r in _threaded_server.registrations.keys():
            self.send(json.dumps({'type': 'REGISTER', 'name': r}))
        for b in _threaded_server.backends.keys():
            self.send(json.dumps({'type': 'REGISTER_LIVE_OBJECT_BACKEND', 'backend': b}))

    def opened(self):
        if not _quiet:
            print("Anvil websocket open")
        self.send(json.dumps({'key': _key, 'v': 7}))
        if _init_session is None:
            # Optimisation: Don't wait for an extra roundtrip if we don't need to
            self._register_server_functions()

        threading.Thread(target=self.heartbeat_until_reopened).start()

    def heartbeat_until_reopened(self):
        # Do this until we've managed to reconnect
        time.sleep(10)
        while _connection is self:
            call("anvil.private.echo", "keep-alive")
            time.sleep(10)

    def closed(self, code, reason=None):
        print("Anvil websocket closed (code %s, reason=%s)" % (code, reason))
        self._signal_ready()
        reconnect(self)

    def received_message(self, message):
        global _fatal_error

        if message.is_binary:
            _serialise.process_blob(message.data)

        else:
            data = json.loads(message.data.decode())

            type = data["type"] if 'type' in data else None

            if 'auth' in data:
                anvil.app._setup(**data.get('app-info', {}))

                if not _quiet:
                    print("Authenticated OK")
                if _init_session is None:
                    self._signal_ready()
                else:
                    # Run _init_session(). Has to be in a separate thread,
                    # so we can handle the server calls it (presumably)
                    # wants to do. But until it finishes, only that one
                    # thread is allowed to use this connection. We enforce
                    # this via the _connection_ctx thread-local variable.
                    def do_init():
                        global _fatal_error
                        try:
                            _connection_ctx.is_initalising_session = True
                            _init_session()
                            self._register_server_functions()
                        except Exception as e:
                            print("Error during session initialisation")
                            _fatal_error = repr(e)
                            raise
                        finally:
                            _connection_ctx.is_initalising_session = False
                            self._signal_ready()
                    threading.Thread(target=do_init).start()

            elif 'output' in data:
                print("Anvil server output: " + data['output'].rstrip("\n"))
            elif type == "CALL":
                _threaded_server.IncomingRequest(data)
            elif type == "CHUNK_HEADER":
                _serialise.process_blob_header(data)
            elif type is None and "id" in data and ("response" in data or "error" in data):
                _threaded_server.IncomingResponse(data)
            elif type is None and "error" in data:
                _fatal_error = data["error"]
                print("Fatal error from Anvil server: " + str(_fatal_error))
            else:
                print("Anvil websocket got unrecognised message: "+repr(data))

    def send(self, payload, binary=False):
        with self._sending_lock:
            return WebSocketClient.send(self, payload, binary)

    def send_with_header(self, json_data, blob=None):
        try:
            with self._sending_lock:
                WebSocketClient.send(self, json.dumps(json_data), False)
                if blob is not None:
                    WebSocketClient.send(self, blob, True)
        except TypeError:
            raise _server.AnvilSerializationError("Value must be JSON serializable")

    def send_reqresp(self, reqresp, collect_capabilities=None):
        if not self._ready and not _connection_ctx.is_initalising_session:
            raise RuntimeError("Websocket connection not ready to send request")

        _serialise.serialise(reqresp, self.send_with_header, collect_capabilities=collect_capabilities)


_key = None

def _get_connection():
    global _connection

    if _key is None:
        raise Exception("You must use anvil.server.connect(key) before anvil.server.call()")

    # During init_session, only init_session's thread is allowed to use
    # the connection; everyone else blocks
    if _connection_ctx.is_initalising_session:
        return _connection

    with _connection_lock:
        if _connection is None:
            try:
                _connection = _Connection(headers=_get_extra_headers().items())
                _connection.connect()
            except Exception as e:
                _connection = None
                raise e
            _connection.wait_until_ready()
    return _connection


def connect(key, url='wss://anvil.works/uplink', quiet=False, init_session=None, extra_headers={}):
    global _key, _url, _fatal_error, _quiet, _init_session, _get_extra_headers
    _key = key
    _url = url
    _fatal_error = None # Reset because of reconnection attempt
    _quiet = quiet
    _init_session = init_session
    _get_extra_headers = (lambda: extra_headers) if type(extra_headers) is dict else extra_headers
    _get_connection()


def run_forever():
    while True:
        time.sleep(1)


def _on_register(name, is_live_object):
    if _connection is not None and _connection.is_ready():
        if is_live_object:
            _connection.send_reqresp({'type': 'REGISTER_LIVE_OBJECT_BACKEND', 'backend': name})
        else:
            _connection.send_reqresp({'type': 'REGISTER', 'name': name})


_server.on_register = _on_register


def _do_call(args, kwargs, fn_name=None, live_object=None): # Yes, I do mean args and kwargs without *s
    if _fatal_error is not None:
        raise Exception("Anvil fatal error: " + str(_fatal_error))

    return _threaded_server.do_call(args, kwargs, fn_name=fn_name, live_object=live_object)


_server._do_call = _do_call


def call(fn_name, *args, **kwargs):
    try:
        return _do_call(args, kwargs, fn_name=fn_name)
    except _server.AnvilWrappedError as e:
        # We need to re-raise here so that the right amount of traceback gets cut off by _report_exception
        raise _server._deserialise_exception(e.error_obj)


def get_app_origin():
    return call("anvil.private.get_app_origin")


def get_api_origin():
    return call("anvil.private.get_api_origin")


def launch_background_task(fn_name, *args, **kwargs):
    return call("anvil.private.background_tasks.launch", fn_name, *args, **kwargs)


def get_background_task(id):
    return call("anvil.private.background_tasks.get_by_id", id)


def list_background_tasks(all_environments=False):
    return call("anvil.private.background_tasks.list", all_environments=all_environments)


def wait_forever():
    _get_connection()
    while True:
        time.sleep(1)
