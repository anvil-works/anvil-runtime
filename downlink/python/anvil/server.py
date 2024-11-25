# Implementation of anvil.server for the downlink worker

from ._threaded_server import live_object_backend, LazyMedia, call_info as session, _switch_session, call_context as context

from ._server import (register, 
                      callable, 
                      background_task, 
                      callable_as, 
                      Serializable,
                      portable_class,
                      serializable_type,
                      Capability,
                      unwrap_capability,
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
                      PermissionDenied,
                      ServiceNotAdded,
                      CookieError, 
                      _FailError,
                      BackgroundTaskError,
                      BackgroundTaskNotFound,
                      BackgroundTaskKilled,
                      http_endpoint,
                      wellknown_endpoint,
                      route,
                      api_request as request, 
                      HttpResponse,
                      FormResponse,
                      _LoadAppResponse,
                      AppResponder,
                      cookies,
                      raise_event,
                      list_client_sessions,
                      get_client_session,
                      get_session_id,
                      subscribe,
                      unsubscribe,
                      get_subscriptions,
                      invalidate_client_objects,
                      _on_invalidate_client_objects,
                      server_side_method)

from . import _threaded_server, _server

#~!defModuleAttr(anvil.server)!1: {name: 'startup_data', type: 'any', description: 'data loaded when returning a LoadAppResponse from a route'}
def __getattr__(name):
    if name == "startup_data":
        raise RuntimeError("anvil.server.startup_data is only available on the client")
    raise AttributeError(name)

#!defFunction(anvil.server,%, function_name, **kwargs)!2: "Allows you to call server-side functions from the client. It requires the name of the function that you want to call, passed as a string. Any extra arguments are passed through to the server function." ["call"]
def call(*args, **kwargs):
    if not args:
        raise TypeError("anvil.server.call() expects atleast 1 argument")
    fn_name, args = args[0], args[1:]
    if not isinstance(fn_name, str):
        raise TypeError("first argument to anvil.server.call() must be as str, got '" + type(fn_name).__name__ + "'")
    try:
        return _threaded_server.do_call(args, kwargs, fn_name=fn_name)
    except _server.AnvilWrappedError as e:
        error_from_server = _server._deserialise_exception(e.error_obj)
        raise error_from_server


# Once downlinks rebuilt and updated for all of legacy, dynamic and sandbox, update these to include [prefer_ephemeral_debug=] and update docs
#!defFunction(anvil.server,string,[environment_type])!2: {anvil$args: {environment_type: "Pass 'published' to get the published URL"}, anvil$helpLink: "/docs/http-apis/creating-http-endpoints#getting-the-url-for-your-api", $doc: "Returns the root URL for the current app.\n\nBy default, this function returns the URL for the current environment, which might be private or temporary (for example, if you are running your app in the Anvil Editor). If you want the URL for the published branch, pass 'published' as an argument."} ["get_app_origin"]
def get_app_origin(environment_type=None, **kwargs):
    return call("anvil.private.get_app_origin", environment_type, **kwargs)


#!defFunction(anvil.server,string,[environment_type])!2: {anvil$args: {environment_type: "Pass 'published' to get the published URL"}, anvil$helpLink: "/docs/http-apis/creating-http-endpoints#getting-the-url-for-your-api", $doc: "Returns the root URL of the API for the current app.\n\nBy default, this function returns the URL for the current environment, which might be private or temporary (for example, if you are running your app in the Anvil Editor). If you want the URL for the published branch, pass 'published' as an argument."} ["get_api_origin"]
def get_api_origin(environment_type=None, **kwargs):
    return call("anvil.private.get_api_origin", environment_type, **kwargs)

#!defFunction(anvil.server,Task object,fn_name, [args])!2: {anvil$args: {fn_name: "The name of the background function to launch", args: "Arguments to pass into the background function"}, anvil$helpLink: "/docs/background-tasks/defining-and-running", $doc: "Launches a function to run in the background. The function must be decorated with @anvil.server.background_task. Returns a Task object."} ["launch_background_task"]
def launch_background_task(fn_name, *args, **kwargs):
    return call("anvil.private.background_tasks.launch", fn_name, *args, **kwargs)

#!defFunction(anvil.server,Task object,id)!2: {anvil$args: {id: "The id of a background task"}, anvil$helpLink: "/docs/background-tasks/communicating-back", $doc: "Returns the Task object of a background task from its id. You can get the task id from task.get_id()."} ["get_background_task"]
def get_background_task(id):
    return call("anvil.private.background_tasks.get_by_id", id)

#!defFunction(anvil.server,list of Task objects,[all_environments])!2: {anvil$args: {all_environments: "Defaults to False. If False, the function will only return background tasks running in the environment in which this function was called. If True, the return value will include all background tasks regardless of environment."}, anvil$helpLink: "/docs/background-tasks#list-background-tasks-from-code", $doc: "Returns a list of all Tasks running in the current environment. If all_environments is True, this function will return all of the app's running Tasks regardless of environemnt."} ["list_background_tasks"]
def list_background_tasks(all_environments=False):
    return call("anvil.private.background_tasks.list", all_environments=all_environments)


task_state = _server.NotABackgroundTaskState()

#!defAttr()!1: {name: "headers", type: "dict", description: "HTTP headers sent with the current request"}
#!defAttr()!1: {name: "method", type: "string", description: "The HTTP method of the current request, e.g. GET, POST, etc."}
#!defAttr()!1: {name: "path", type: "string", description: "The path of the current request, e.g. /foo/bar"}
#!defAttr()!1: {name: "origin", type: "string", description: "The origin of the current API request, e.g. https://my-app.anvil.app/_/api"}
#!defAttr()!1: {name: "remote_address", type: "string", description: "The IP address the current request is coming from."}
#!defAttr()!1: {name: "body", pyType: "anvil.Media instance", description: "The body of the HTTP request"}
#!defAttr()!1: {name: "body_json", type: "dict", description: "The decoded JSON body of the HTTP request, if applicable. Only available when Content-Type header is 'application/json'."}
#!defAttr()!1: {name: "username", type: "string", description: "The username received through HTTP Basic Authentication"}
#!defAttr()!1: {name: "password", type: "string", description: "The password received through HTTP Basic Authentication"}
#!defAttr()!1: {name: "user", type: "User", description: "When require_auth is True, returns the row from the Users table corresponding to the authenticated user."}
#!defAttr()!1: {name: "query_params", type: "dict", description: "A dict of query-string parameters passed with this request."}
#!defAttr()!1: {name: "form_params", type: "dict", description: "A dict of form parameters passed with this request."}

#!defClass(anvil.server,%HttpRequest)!0:

#!defModuleAttr(anvil.server)!1: {name: "%request", pyType: "anvil.server.HttpRequest instance", description: "Contains information about the current HTTP API request. It's an instance of `anvil.server.HttpRequest`."}

#!defAttr()!1: {name: "status", type: "number", description: "The status code for this HTTP response. Default is 200."}
#!defAttr()!1: {name: "body", type: "any", description: "The body of this HTTP response. Can be a string, a Media object, or any JSON-able value."}
#!defAttr()!1: {name: "headers", type: "dict", description: "The headers to return with this HTTP response. Content-Type will be set automatically if not specified."}
#!defMethod(_, status=200, body="", headers=None)!2: ("Create an HttpResponse object") ["__init__"];
#!defClass(anvil.server,%HttpResponse)!0:


#!defAttr()!1: {name: "client", pyType: "anvil.server.CallContext.ClientInfo instance", description: "An object that describes the client that initiated the current session. This can be a browser, an HTTP endpoint request, an uplink script, a background task, or an incoming email."}
#!defAttr()!1: {name: "type", type: "string", description: "The execution environment this code is running in. May be 'browser', 'server_module' or 'uplink'"}
#!defAttr()!1: {name: "remote_caller", pyType: "anvil.server.CallContext.StackFrame instance", description: "An object describing the code that called this @anvil.server.callable function, where it was running, and whether it is trusted (server-side) or un-trusted (input from a browser, HTTP or other remote code)"}
#!defAttr()!1: {name: "background_task_id", type: "string", description: "The ID of the currently running background task, if there is one."}
#!defClass(anvil.server,#CallContext)!0:

#!defAttr()!1: {name: "ip", type: "string", description: "The IP address of the client that initiated this session."}
#!defAttr()!1: {name: "location", pyType: "anvil.server.CallContext.Location instance", description: "The location of this client, as determined by its IP address, or None if it cannot be determined."}
#!defAttr()!1: {name: "type", type: "string", description: "How this session was initiated. Valid values are: 'browser', 'uplink', 'http', 'background_task' and 'email'."}
#!defClass(anvil.server,#CallContext.ClientInfo)!0:


#!defAttr()!1: {name: "type", type: "string", description: "The location of the calling code. Valid values are: 'browser', 'server_module', 'uplink' and 'client_uplink' for your app's code, or 'http', 'background_task' or 'email' if this code was extrernally triggered."}
#!defAttr()!1: {name: "is_trusted", type: "boolean", description: "Was this code running in a trusted location (ie on the server side)?"}
#!defClass(anvil.server,#CallContext.StackFrame)!0:


#!defAttr()!1: {name: "latitude", type: "float"}
#!defAttr()!1: {name: "longitude", type: "float"}
#!defAttr()!1: {name: "city", type: "string"}
#!defAttr()!1: {name: "subdivision", type: "string"}
#!defAttr()!1: {name: "country", type: "string"}
#!defClass(anvil.server,#CallContext.Location)!0:

#!defModuleAttr(anvil.server)!1: {name: "context", pyType: "anvil.server.CallContext instance", description: "Contains information about what triggered the currently running code. It's an instance of `anvil.server.CallContext`."}

#!defModuleAttr(anvil.server)!1: {name: "session", pyType: "dict instance", description: "A dictionary that contains information about a specific session. It can store anything that a server function can return, except for Media objects."}

#!defFunction(anvil.server [uplink],#,key,[init_session=None],[quiet=False])!2: {$doc: "Connect your uplink script to your anvil app.", anvil$args: {keys: "The key is a unique string and should be kept private. You can generate a new key from inside your anvil app.", init_session: "If you pass a function to the init_session keyword parameter, it will be called after the uplink connection is established, but before any other interaction", quiet: "Set quiet to True to surpress connection output. Errors will still be displayed."}, anvil$helpLink: "/docs/uplink"} ["connect"]

#!defFunction(anvil.server [uplink],#,)!2: {$doc: "Disconnect your uplink script from your anvil app. Your script is then free to call `anvil.server.connect()` with the same uplink key or a new uplink key."} ["disconnect"]

#!defFunction(anvil.server [uplink],#,)!2: {$doc: "A useful shortcut to keep your Python script running. This allows your app to `anvil.server.call` functions inside your Python script. You can use any other way to keep the process alive in place of this function.", anvil$helpLink: "/docs/uplink/setting_up#connecting"} ["wait_forever"]

