# Helpers for implementing anvil.server on an (optionally threaded) Real Python process.
# Used in uplink and downlink, and now even in the PyPy sandbox.

import random, string, json, re, sys, time, importlib, anvil


# For single-threaded implementations, re-entrant calls occupy the same thread,
# so we fake "switching a thread" by pushing all the thread-locals onto a stack
# while we're handling an inner call
class StackableLocal(object):
    def _push_stack(self):
        _nested = dict(self.__dict__)
        self.__dict__.clear()
        self._nested = _nested
        self.__init__()

    def _pop_stack(self):
        nested = self._nested
        self.__dict__.clear()
        self.__dict__.update(nested)

    def __new__(cls, *args, **kwargs):
        v = object.__new__(cls)
        cls.__init__(v, *args, **kwargs)
        _stackables.append(v)
        return v


_stackables = []

try:
    import threading
    ThreadLocal = threading.local
    MULTITHREADED = True
except:
    MULTITHREADED = False
    ThreadLocal = StackableLocal


from . import  _serialise, _server
from ._server import LazyMedia, registrations

string_type = str if sys.version_info >= (3,) else basestring

console_output = sys.stdout

class HttpRequest(ThreadLocal):

    def __init__(self):
        self._prevent_access = True

    def __getattribute__(self, name):
        if name not in ['_push_stack', '_pop_stack', '_nested', '__dict__', '__init__'] and \
                ThreadLocal.__getattribute__(self, "_prevent_access"):
            raise Exception("anvil.server.request is only available in http_endpoint calls.")

        return ThreadLocal.__getattribute__(self, name)

_server.api_request = HttpRequest()


def gen_id():
    sr = random.SystemRandom()
    chars = string.ascii_letters + string.digits
    return ''.join(sr.choice(chars) for _ in range(10))


# Overwrite with functions from context
send_reqresp = None


class LocalCallInfo(ThreadLocal):
    def __init__(self):
        self.call_id = None
        self.stack_id = None
        self.session = None
        self.cache_filter = {}
        self.cache_update = {}
        self.dump_task_state = False
        self.enable_profiling = False

    def __getitem__(self, item):
        return self.session.__getitem__(item)

    def __setitem__(self, key, value):
        return self.session.__setitem__(key, value)

    def __delitem__(self, key):
        del self.session[key]

    def get(self, key, default=None):
        return self.session.get(key, default)

    def __iter__(self):
        return self.session.__iter__()

    def __repr__(self):
        return "<Session:%s>" % repr(self.session)


class LocalCallContext(_server.CallContext, ThreadLocal):
    def __init__(self):
        self._setup(None, [])


call_info = LocalCallInfo()
call_context = LocalCallContext()
call_responses = {}
waiting_for_calls = threading.Condition() if MULTITHREADED else None


# If MULTITHREADED is False, better overwrite this
def poll_for_call_responses(*args):
    raise AssertionError("We're in single-threaded mode, but poll_for_call_responses() is not set")


backends = {}


def _switch_session():
    import anvil.server
    sjson = anvil.server.call('anvil.private.switch_session!') or {"session": {}, "objects": []}
    call_info.session = _server._reconstruct_objects(sjson, None)["session"]


default_app = anvil.app


class LocalAppInfo(ThreadLocal):
    def __init__(self):
        self.__dict__['id'] = default_app.id
        self.__dict__['branch'] = default_app.branch
        self.__dict__['environment'] = default_app.environment

    def _setup(self, environment={}, **kwargs):
        self.__dict__.update(kwargs, environment=anvil._AppInfo._Environment(**environment))


anvil.app = LocalAppInfo()


class SendNoResponse(Exception):
    pass


class IncomingRequest(_serialise.IncomingReqResp):
    def __init__(self, json, import_modules=None, run_fn=None, dump_task_state=False):
        self.import_modules = import_modules
        self.run_fn = run_fn
        self.dump_task_state = dump_task_state
        _serialise.IncomingReqResp.__init__(self, json)

    def execute(self):
        def make_call():
            call_info.call_id = self.json.get('id')
            call_info.stack_id = self.json.get('call-stack-id', None)
            sjson = self.json.get('sessionData', {'session': None, 'objects': []})
            call_info.session = None
            call_info.enable_profiling = self.json.get('enable-profiling', False)
            if call_info.enable_profiling:
                call_info.profile = {
                    "origin": "Server (Python)",
                    "description": "Python _threaded_server execution",
                    "start-time": time.time()*1000,
                }
            call_info.cache_filter = _server.get_liveobject_cache_filter_spec([self.json['args'], self.json['kwargs']])
            call_info.cache_update = {}
            call_info.dump_task_state = self.dump_task_state
            call_context._setup(self.json.get('client', {}), self.json.get('call-stack'))
            anvil.app._setup(**self.json.get('app-info', {}))
            try:
                if self.import_modules:
                    self.import_modules()

                # Now we've imported enough to deserialise custom types
                self.reconstruct_remaining_data()
                call_info.session = _server._reconstruct_objects(sjson, None).get("session", {})

                if self.run_fn is not None:
                    response = self.run_fn()
                elif 'liveObjectCall' in self.json:
                    loc = self.json['liveObjectCall']
                    spec = dict(loc)

                    if call_context.remote_caller is None:
                        spec["source"] = "UNKNOWN"
                    elif call_context.remote_caller.is_trusted:
                        spec["source"] = "server"
                    else:
                        spec["source"] = "client"

                    del spec["method"]
                    backend = loc['backend']
                    if backend not in backends:
                        raise Exception("No such LiveObject backend: " + repr(backend))
                    inst = backends[backend](spec)
                    method = getattr(inst, loc['method'])

                    call_info.cache_filter.setdefault(backend, set()).add(spec['id'])

                    response = method(*self.json['args'], **self.json['kwargs'])
                else:
                    command = self.json['command']
                    for reg in registrations:
                        m = re.match(reg, command)
                        if m and len(m.group(0)) == len(command):
                            response = registrations[reg](*self.json["args"], **self.json["kwargs"])
                            break
                    else:
                        if self.json.get('stale-uplink?'):
                            raise _server.UplinkDisconnectedError({'type': 'anvil.server.UplinkDisconnectedError',
                                                                   'message':'The uplink server for "%s" has been disconnected' % command})

                        else:
                            raise _server.NoServerFunctionError({'type': 'anvil.server.NoServerFunctionError',
                                                                 'message': 'No server function matching "%s" has been registered' % command})

                def err(*args):
                    raise Exception("Cannot save DataMedia objects in anvil.server.session")

                try:
                    sjson = _server.fill_out_media({'session': call_info.session}, err)
                    json.dumps(sjson)
                except TypeError as e:
                    raise _server.SerializationError("Tried to store illegal value in a anvil.server.session. " + e.args[0])
                except _server.SerializationError as e:
                    raise _server.SerializationError("Tried to store illegal value in a anvil.server.session. " + e.args[0])

                resp = {"id": self.json["id"], "response": response, "sessionData": sjson, "cacheUpdates": call_info.cache_update}

                if call_info.enable_profiling:
                    call_info.profile["end-time"] = time.time()*1000
                    resp["profile"] = call_info.profile

                _server.fill_out_cap_updates(resp, self.capabilities)

                if self.dump_task_state:
                    try:
                        tjson = _server.fill_out_media({'taskState': anvil.server.task_state}, err)
                        json.dumps(tjson)
                        resp['taskState'] = anvil.server.task_state
                    except (TypeError, _server.SerializationError):
                        pass

                try:
                    send_reqresp(resp)
                except _server.SerializationError as e:
                    raise _server.SerializationError("Cannot serialize return value from function. " + str(e))
            except SendNoResponse:
                pass
            except:

                e = _server._report_exception(self.json["id"])

                if self.dump_task_state:
                    def err(*args):
                        raise Exception("Cannot save DataMedia objects in anvil.server.session")

                    try:
                        tjson = _server.fill_out_media({'taskState': anvil.server.task_state}, err)
                        json.dumps(tjson)
                    except (TypeError, _server.SerializationError):
                        pass
                    else:
                        e['taskState'] = anvil.server.task_state

                try:
                    send_reqresp(e)
                except:
                    trace = "\ncalled from ".join(["%s:%s" % (t[0], t[1]) for t in e["error"]["trace"]])
                    console_output.write(("Failed to report exception: %s: %s\nat %s\n" % (e["error"]["type"], e["error"]["message"], trace)).encode("utf-8"))
                    console_output.flush()
            finally:
                self.complete()

        if MULTITHREADED:
            threading.Thread(target=make_call).start()
        else:
            make_call()

    def complete(self):
        pass


class IncomingResponse(_serialise.IncomingReqResp):
    def execute(self):
        id = self.json['id']
        if id in call_responses:
            call_responses[id] = (self, self.json)
            if MULTITHREADED:
                with waiting_for_calls:
                    waiting_for_calls.notifyAll()
        else:
            print("Got a response for an unknown ID: " + repr(self.json))


def kill_outstanding_requests(msg):
    for k in call_responses.keys():
        if call_responses[k] is None:
            call_responses[k] = (None, {'error': {'message': msg}})

    if not MULTITHREADED:
        raise Exception("_threaded_server.kill_outstanding_requests() does not work in single-threaded mode")

    with waiting_for_calls:
        waiting_for_calls.notifyAll()


def register_live_object_backend(cls):

    name = "uplink." + cls.__name__
    backends[name] = cls

    if _server.on_register is not None:
        _server.on_register(name, True)

    return cls


live_object_backend = register_live_object_backend


def do_call(args, kwargs, fn_name=None, live_object=None): # Yes, I do mean args and kwargs without *s
    id = gen_id()

    call_responses[id] = None

    capabilities_for_update = []

    if call_info.enable_profiling:
        profile = {
            "origin": "Server (Python)",
            "description": "Outgoing call from Python _threaded_server",
            "start-time": time.time()*1000
        }

    def send_call():
        # print("Call stack ID = " + repr(_call_info.stack_id))
        if call_info.stack_id is None:
            call_info.stack_id = "outbound-" + gen_id()
        req = {'type': 'CALL', 'id': id, 'args': args, 'kwargs': kwargs,
               'call-stack-id': call_info.stack_id, 'originating-call': call_info.call_id}

        if live_object:
            req["liveObjectCall"] = { k: live_object._spec[k] for k in ["id", "backend", "mac", "permissions"] }
            req["liveObjectCall"]["method"] = fn_name
        elif fn_name:
            req["command"] = fn_name
        else:
            raise Exception("Expected one of fn_name or live_object")
        try:
            send_reqresp(req, collect_capabilities=capabilities_for_update)
        except _server.SerializationError as e:
            raise _server.SerializationError("Cannot serialize arguments to function. " + str(e))

    if MULTITHREADED:
        with waiting_for_calls:
            send_call()
            while call_responses[id] is None:
                waiting_for_calls.wait()
    else:
        send_call()
        dump_task_state = call_info.dump_task_state
        # Fake a thread switch
        for s in _stackables:
            s._push_stack()
        while call_responses[id] is None:
            poll_for_call_responses(dump_task_state)
            dump_task_state = False # only do it first time
        for s in _stackables:
            s._pop_stack()

    if call_info.enable_profiling:
        profile["end-time"] = time.time()*1000

    reqresp, r = call_responses.pop(id)

    # Now we're in the right thread, we can do any custom deserialisation
    if reqresp:
        reqresp.reconstruct_remaining_data()

    if "cacheUpdates" in r:
        # Apply updates to any of our own objects that were passed in
        _server.apply_cache_updates(r['cacheUpdates'], [args, kwargs, live_object])
        # Queue up whichever updates *we* should be returning
        _server.combine_cache_updates(call_info.cache_update, r['cacheUpdates'], call_info.cache_filter)

    _server.apply_cap_updates(r, capabilities_for_update)

    if call_info.enable_profiling:
        if "profile" in r:
            profile["children"] = [r["profile"]]

        if hasattr(call_info, "profile"):
            if "children" not in call_info.profile:
                call_info.profile["children"] = []

            call_info.profile["children"].append(profile)

    if 'response' in r:
        return r['response']
    if 'error' in r:
        error_from_server = _server._deserialise_exception(r["error"])
        raise error_from_server
    else:
        raise Exception("Bogus response from server: " + repr(r))
