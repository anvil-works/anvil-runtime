# Run this file, using a marshalled version of the RPC protocol on file descriptor #3.
# Kill it when done.
from __future__ import absolute_import
import os, sys, marshal, threading, json, importlib
from anvil_downlink_worker import handle_incoming_call, load_app
from anvil import _serialise, _server, _threaded_server
import anvil.server
import anvil.pdf

PIPE_IN = os.fdopen(os.dup(0), 'rb')
PIPE_OUT = os.fdopen(os.dup(1), 'wb')
OLD_STDERR = os.fdopen(os.dup(2), 'wb')
WRITE_LOCK = threading.RLock()

_threaded_server.console_output = OLD_STDERR

# We use stdin and stdout to talk Anvil-RPC to our manager process.
# We overwrite sys.stdout and sys.stderr with shims that produce 'output' updates across
# that interface, and to make sure no direct use of FDs 0/1/2 get in its way
# To make sure no clever use Overwrite actual stdin and stdout with a thread that forwards them
new_stdout = os.open(os.devnull, os.O_RDWR)
os.dup2(new_stdout, 0)
os.dup2(new_stdout, 1)
#os.dup2(new_stdout, 2)

def write_pipe(data, bin=None):
    with WRITE_LOCK:
        try:
            s = b'X' + marshal.dumps(data)
            if bin is not None:
                s += marshal.dumps(bin)
        except ValueError:
            raise _server.SerializationError("You can only pass strings, numbers, arrays, lists, LiveObjects and Media to or from server functions")

        PIPE_OUT.write(s)
        PIPE_OUT.flush()


class DummyStdout:
    def write(self, s):
        write_pipe({'output': s, 'id': _threaded_server.call_info.call_id})
    def flush(self):
        pass


sys.stdout = DummyStdout()
#sys.stderr = sys.stdout

def dbg(s):
    sys.stderr.write(s+"\n")
    sys.stderr.flush()


def send_reqresp(r, collect_capabilities=None):
    _serialise.serialise(r, write_pipe, collect_capabilities=collect_capabilities)

_threaded_server.send_reqresp = send_reqresp


def run():
    while True:
        PIPE_IN.read(1) # signal byte to wake us up
        msg = marshal.load(PIPE_IN)
        type = msg.get("type", None)
        if type in ["CALL_WITH_APP", "LAUNCH_BACKGROUND_WITH_APP", "CALL", "LAUNCH_BACKGROUND",
                    "LAUNCH_REPL", "REPL_COMMAND", "TERMINATE_REPL"]:
            handle_incoming_call(msg, write_pipe)

        elif type == "PROVIDE_APP":
            load_app(msg["app"])

        elif type == "GET_TASK_STATE":
            def err(*args):
                raise _server.SerializationError("Cannot use BlobMedia objects in task state.")

            try:
                sjson = _server.fill_out_media({'id': msg['id'], 'response': anvil.server.task_state}, err)
                json.dumps(sjson)
            except (TypeError, _server.SerializationError) as e:
                write_pipe({'id': msg['id'], 'error': {'type': 'anvil.server.SerializationError', 'message': "Illegal value in a anvil.server.task_state. " + e.args[0]}})
            except Exception as e:
                write_pipe({'id': msg['id'], 'error': {'type': 'anvil.server.InternalError', 'message': "Could not get task state: " + e.args[0]}})
            else:
                write_pipe(sjson)

        elif type == "CHUNK_HEADER":
            _serialise.process_blob_header(msg)
            _serialise.process_blob(marshal.load(PIPE_IN))
        elif type is None and ("response" in msg or "error" in msg):
            _threaded_server.IncomingResponse(msg)
        else:
            print("Downlink worker socket got unrecognised message: "+repr(msg))
            sys.stdout.flush()
            os._exit(1)


def plotly_serialization_helper(class_fullname):
    name_parts = class_fullname.split(".")
    module_name = ".".join(name_parts[:-1])
    class_name = name_parts[-1]

    module = importlib.import_module(module_name)
    cls = getattr(module, class_name)

    if not hasattr(cls, '__serialize__'):
        #print(f"Registering {cls}")
        def serialize(self, global_data):
            #print("Serialising %s on downlink" % type(self))
            return self.to_plotly_json()

        @staticmethod
        def new_deserialized(data, global_data):
            #print("Deserialising %s on downlink" % cls)
            return cls(data)

        cls.__serialize__ = serialize
        cls.__new_deserialized__ = new_deserialized
        anvil.server.portable_class(cls, class_fullname)

_server._serialization_helpers["plotly.graph_objs"] = plotly_serialization_helper


if __name__ == "__main__":
    run()
