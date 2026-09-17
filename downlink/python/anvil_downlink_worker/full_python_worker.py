# Run this file, using a serialised version of the RPC protocol on stdin + stdout
from __future__ import absolute_import
import time
import_start_time = int(time.time() * 1e9)
import os, sys, threading, json, importlib
from anvil_downlink_worker import handle_incoming_call, load_app, internal_tracer_provider
import anvil_downlink_worker
from anvil_downlink_util.pipes import MessagePipe
from anvil import _serialise, _server, _threaded_server
import anvil.server
import anvil.pdf

from anvil_downlink_util.tracing import context
tracer = internal_tracer_provider.get_tracer(__name__)

PIPE_IN = MessagePipe(os.fdopen(os.dup(0), 'rb'))
PIPE_OUT = MessagePipe(os.fdopen(os.dup(1), 'wb'))
OLD_STDERR = os.fdopen(os.dup(2), 'wb')

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
    try:
        PIPE_OUT.send(data, bin)
    except ValueError:
        raise _server.SerializationError("You can only pass strings, numbers, arrays, lists, LiveObjects and Media to or from server functions")


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


def send_reqresp(r, collect_capabilities=None, remote_is_trusted=False):
    _serialise.serialise(r, write_pipe, collect_capabilities=collect_capabilities, remote_is_trusted=remote_is_trusted)

_threaded_server.send_reqresp = send_reqresp


def run():
    global import_start_time
    ready_time = int(time.time()*1e9)
    while True:
        msg, bindata = PIPE_IN.receive()

        type = msg.get("type", None)
        if type in ["CALL", "LAUNCH_BACKGROUND", "LAUNCH_REPL", "REPL_COMMAND", "TERMINATE_REPL", "DEBUG_REQUEST"]:
            handle_incoming_call(msg, write_pipe, import_start_time, ready_time)
            import_start_time = None
            ready_time = None

        elif type == "PROVIDE_APP":
            context.attach(anvil_downlink_worker.APP_LOAD_REQUESTED)
            load_app(msg["app"])

        elif type == "GET_TASK_STATE":
            def err(*args):
                raise _server.SerializationError("Cannot use BlobMedia objects in task state.")

            try:
                sjson = _server.fill_out_media({'id': msg['id'], 'response': anvil.server.task_state}, err,
                                               remote_is_trusted=False)
                json.dumps(sjson)
            except (TypeError, _server.SerializationError) as e:
                write_pipe({'id': msg['id'], 'error': {'type': 'anvil.server.SerializationError', 'message': "Illegal value in a anvil.server.task_state. " + e.args[0]}})
            except Exception as e:
                write_pipe({'id': msg['id'], 'error': {'type': 'anvil.server.InternalError', 'message': "Could not get task state: " + e.args[0]}})
            else:
                write_pipe(sjson)

        elif type == "CHUNK_HEADER":
            _serialise.process_blob_header(msg)
            _serialise.process_blob(bindata)
        elif type == "MEDIA_ERROR":
            _serialise.process_media_error(msg)
        elif type is None and ("response" in msg or "error" in msg):
            _threaded_server.IncomingResponse(msg)
        elif type is None and ("debuggers" in msg or "debugger" in msg):
            # A breakpoint was hit in a server function called (possibly transitively, e.g. via a
            # nested anvil.server.call) by this process. We have no interactive debugger session on
            # this side of that call, so just ignore the pause notification and keep waiting for the
            # real response.
            pass
        else:
            print("Downlink worker socket got unrecognised message: "+repr(msg))
            sys.stdout.flush()
            os._exit(1)


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        OLD_STDERR.write("Downlink worker interrupted".encode())
        OLD_STDERR.flush()
        os._exit(1)
