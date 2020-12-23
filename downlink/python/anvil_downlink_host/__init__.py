import collections, json, os, psutil, random, signal, subprocess, sys, threading, time, traceback, platform
from ws4py.client.threadedclient import WebSocketClient


# Configuration

TIMEOUT = int(os.environ.get("DOWNLINK_WORKER_TIMEOUT", "30"))
DROP_PRIVILEGES = os.environ.get("DROP_PRIVILEGES")
RUNTIME_ID = os.environ.get("RUNTIME_ID", None) or ('python2-full' if sys.version_info[0] < 3 else 'python3-full')
USER_ID = os.environ.get("DOWNLINK_USER_ID", None)
ORG_ID = os.environ.get("DOWNLINK_ORG_ID", None)
APP_CACHE_SIZE = int(os.environ.get("APP_CACHE_SIZE", "16"))
ENABLE_PDF_RENDER = os.environ.get("ENABLE_PDF_RENDER")
PER_WORKER_SOFT_MEMORY_LIMIT = int(os.environ["PER_WORKER_SOFT_MEMORY_LIMIT_MB"])*1024*1024 \
                                    if "PER_WORKER_SOFT_MEMORY_LIMIT_MB" in os.environ else None

IS_WINDOWS = "Windows" in platform.system() or "CYGWIN" in platform.system()

for V in ["DOWNLINK_WORKER_TIMEOUT", "DROP_PRIVILEGES", "RUNTIME_ID", "DOWNLINK_USER_ID", "DOWNLINK_ORG_ID", "APP_CACHE_SIZE", "ENABLE_PDF_RENDER"]:
    if V in os.environ:
        del os.environ[V]

# Worker modules register themselves here
workers_by_id = {}

# Cache app content
app_cache = collections.OrderedDict()


def send_with_header(json_data, blob=None):
    """"Send data to the API router"""
    connection.send_with_header(json_data, blob)

# Host state

launch_worker = None
launch_pdf_worker = None

connection = None

rnd = random.SystemRandom()
MY_SESSION_ID = "".join((rnd.choice("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") for _ in range(20)))

draining_start_time = None

def maybe_quit_if_draining_and_done():
    if draining_start_time is not None and len(workers_by_id) == 0:
        if time.time() < draining_start_time + 10:
            print("Giving API 10 seconds' grace for drain...")
            def f():
                time.sleep(draining_start_time + 10 - time.time())
                maybe_quit_if_draining_and_done()
            threading.Thread(target=f).start()
        else:
            print("Drain complete. Exiting.")
            os._exit(0)


# Utility functions

def get_demote_fn(app_id):
    if os.name == "nt":
        return None

    # TODO: Use app_id here to seed UID generation. It might be an actual app ID, or None
    uid = 20000
    def do_demotion():
        if DROP_PRIVILEGES and os.getuid() == 0:
            os.setgroups([])
            os.setgid(uid)
            os.setegid(uid)
            os.setuid(uid)
            os.seteuid(uid)

        # Give ourselves an isolated process group so we can take child processes with us when we go
        os.setpgid(0, 0)

    return do_demotion


class PopenWithGroupKill(subprocess.Popen):
    def terminate(self):
        try:
            os.killpg(self.pid, 9)
        except:
            pass
        super(PopenWithGroupKill, self).terminate()


# Handle communication with API router
class Connection(WebSocketClient):
    def __init__(self, url, key):
        print("Connecting to " + url)
        WebSocketClient.__init__(self, url)

        self._sending_lock = threading.RLock()
        self._send_next_bin = None
        self._key = key

    def opened(self):
        print("Anvil websocket open")
        spec = {
            'runtime': RUNTIME_ID,
            'session_id': MY_SESSION_ID,
        }

        if USER_ID is not None:
            spec['user_id'] = USER_ID
        elif ORG_ID is not None:
            spec['org_id'] = ORG_ID

        id = os.environ.get("DOWNLINK_ID", None)
        if id:
            spec['id'] = id
        self.send(json.dumps({
            'key': self._key,
            'v': 2,
            'spec': spec,
        }))

    def closed(self, code, reason=None):
        print("Anvil websocket closed (code %s, reason=%s)" % (code, reason))
        # The world has ended. Let whatever is in charge of restarting us sort it out.
        os._exit(1)

    def received_message(self, message):
        try:
            self._received_message(message)
        except Exception as e:
            print("Error in received_message():")
            traceback.print_exc()
            raise

    def _received_message(self, message):

        if message.is_binary:
            self._send_next_bin(message.data)

        else:
            data = json.loads(message.data.decode())
            #print "Received: " + repr(data)

            type = data["type"] if 'type' in data else None
            id = data["id"] if 'id' in data else None

            if 'auth' in data:
                print("Downlink authenticated OK")

            elif 'output' in data:
                # Output from something this worker has called.
                calling_worker = workers_by_id.get(data.get('id'))
                originating_call = calling_worker.outbound_ids.get(id) if calling_worker is not None else None

                if originating_call is not None:
                    data['id'] = originating_call
                    self.send_with_header(data)
                else:
                    print("Bogus output, probably for an old request (worker: %s): %s" %
                          ("FOUND" if calling_worker else "MISSING", repr(data)[:100]))

            elif type in ["CALL_WITH_APP", "LAUNCH_BACKGROUND_WITH_APP", "CALL", "LAUNCH_BACKGROUND", "LAUNCH_REPL"]:

                if "app" not in data:
                    cached_app = app_cache.get((data["app-id"], data["app-version"]))
                    if cached_app is not None:
                        #print("Filling out app from cache for %s" % ((data["app-id"], data["app-version"]),))
                        data["type"] += "_WITH_APP"
                        data["app"] = cached_app

                #print "Launching new worker for ID " + id
                if draining_start_time:
                    self.send_with_header({"id": id, "error": {"type": "anvil.server.DownlinkDrainingError", "message": "New call routed to draining downlink"}})
                else:
                    if data.get("command", None) == "anvil.private.pdf.do_print":
                        if launch_pdf_worker:
                            launch_pdf_worker(data)
                        else:
                            self.send_with_header({"id": id, "error": {"type": "anvil.server.RuntimeUnavailableError", "message": "PDF Rendering unavailable"}})
                    else:
                        launch_worker(data)

                #print "Launched"

            elif type in ["REPL_COMMAND", "REPL_KEEPALIVE", "TERMINATE_REPL"]:
                worker = workers_by_id.get(data['repl'])

                # TODO allow REPL commands to be run on us too

                if worker is not None:
                    worker.handle_inbound_message(data)
                else:
                    print("Couldn't find repl %s; current workers: %s" % (data['repl'], workers_by_id.keys()))
                    connection.send_with_header(
                        {'error': {'type': 'anvil.server.NotRunningTask', 'message': 'No such REPL running'},
                         'id': data['id']}
                    )

            elif type == "KILL_TASK":

                worker = workers_by_id.get(data['task'])
                if worker is not None:
                    worker.kill_background_task()

            elif type == "GET_TASK_STATE":

                worker = workers_by_id.get(data['task'])
                if worker is not None:
                    worker.get_task_state(data)
                else:
                    connection.send_with_header(
                        {'error': {'type': 'anvil.server.NotRunningTask', 'message': 'No such task running'},
                         'id': data['id']})

            elif type == "CHUNK_HEADER":
                if data['requestId'] in workers_by_id:
                    worker = workers_by_id[data['requestId']]

                    def send_next_bin(bin_data):
                        worker.handle_inbound_message(data, bin_data)
                        self._send_next_bin = None

                    self._send_next_bin = send_next_bin
                else:
                    print("Ignoring media for unknown request %s" % data['requestId'])
                    self._send_next_bin = lambda x: 0

            elif (type is None or type == "PROVIDE_APP") and "id" in data:
                if type == "PROVIDE_APP":
                    #print("PROVIDE_APP: Cache fill for %s" % ((data["app-id"], data["app-version"]),))
                    app_cache[(data["app-id"], data["app-version"])] = data["app"]
                    if len(app_cache) > APP_CACHE_SIZE:
                        app_cache.popitem(False)

                if id in workers_by_id:
                    workers_by_id[id].handle_inbound_message(data)
                elif id.startswith("downlink-keepalive"):
                    pass # We don't care about these
                else:
                    print("Bogus reply: " + repr(data)[:100])

            elif type is None and "error" in data:
                print("Fatal error from Anvil server: " + str(data["error"]))
                os._exit(1)
            else:
                print("Anvil websocket got unrecognised message: "+repr(data))

    def send(self, payload, binary=False):
        with self._sending_lock:
            return WebSocketClient.send(self, payload, binary)

    def send_with_header(self, json_data, blob=None):
        with self._sending_lock:
            WebSocketClient.send(self, json.dumps(json_data), False)
            if blob is not None:
                WebSocketClient.send(self, blob, True)


# Defined in two places, so it can be used by BaseWorker and the full-python worker. Yeuch.
def report_worker_stats(self):
    p = self.proc_info
    if p is None:
        return {}
    try:
        cpu = p.cpu_times()
        mem = p.memory_full_info()
        return {
            "info": self.task_info,
            "age":  time.time() - p.create_time(),
            "cpu": {
                "user": cpu.user + cpu.children_user,
                "system": cpu.system + cpu.children_system,
                "total": cpu.user + cpu.system + cpu.children_user + cpu.children_system
            },
            "mem": {"vms": mem.vms, "uss": mem.uss},
        }
    except psutil.Error:
        return {}


# Shared tools for managing worker processes.
# Nomenclature: "Inbound" calls come from the API server. "Outbound" calls come from the server.
class BaseWorker(object):
    def __init__(self, initial_msg, task_info):
        self.req_ids = set()
        self.outbound_ids = {} # Outbound ID -> inbound ID it came from
        self._media_tracking = {} # reqID -> (set([mediaId, mediaId, ]), finishedCallback)
        self.lock = threading.RLock() # TODO do we need this?
        self.start_times = {}
        self.proc_info = None
        self.task_info = task_info

        self.initial_req_id = initial_msg['id']

    # Handle bookkeeping for which requests we're handling and waiting for

    def record_outbound_call_started(self, outbound_msg):
        outbound_id = outbound_msg['id']
        if outbound_id in workers_by_id:
            raise Exception("Duplicate ID: %s" % outbound_id)
        self.outbound_ids[outbound_msg['id']] = outbound_msg.get('originating-call', self.initial_req_id)
        workers_by_id[outbound_id] = self

    def record_outbound_call_complete(self, outbound_id):
        self.outbound_ids.pop(outbound_id, None)
        workers_by_id.pop(outbound_id, None)

    def record_inbound_call_started(self, inbound_msg):
        inbound_id = inbound_msg['id']
        self.req_ids.add(inbound_id)
        self.start_times[inbound_id] = time.time()
        workers_by_id[inbound_id] = self

    def record_inbound_call_complete(self, inbound_id):
        self.req_ids.discard(inbound_id)
        self.start_times.pop(inbound_id, None)
        workers_by_id.pop(inbound_id, None)

        if len(self.req_ids) == 0:
            self.on_all_inbound_calls_complete()

        maybe_quit_if_draining_and_done()

    def clean_up_all_outstanding_records(self):
        for id in self.req_ids:
            self._media_tracking.pop(id, None)
            workers_by_id.pop(id, None)
        for id in self.outbound_ids:
            self._media_tracking.pop(id, None)
            workers_by_id.pop(id, None)

    def ensure_id_is_mine(self, req_id):
        if not (req_id in self.req_ids or req_id in self.outbound_ids):
            raise Exception("Worker attempted to send an ID that doesn't belong to it")

    # Events to be overridden by children

    def handle_inbound_message(self, msg, bindata=None):
        raise Exception("handle_inbound_message() not implemented")

    def on_all_inbound_calls_complete(self):
        raise Exception("on_all_inbound_calls_complete() not implemented")

    def repl_keepalive(self):
        raise Exception("repl_keepalive() not implemented")

    # A common task is to track when the worker has finished sending media for a particular request,
    # so we can safely kill it.

    def on_media_complete(self, msg, callback):
        """Register a callback to execute when the worker has finished sending all the media in the given message."""
        media_ids = set()
        for o in msg.get("objects", []):
            if "DataMedia" in o.get("type", []):
                media_ids.add(o["id"])
        if len(media_ids) == 0:
            callback()
        else:
            # print("Waiting for media for request '%s': %s" % (msg['id'], repr(list(media_ids))))
            self._media_tracking[msg['id']] = (media_ids, callback)

    def transmitted_media(self, request_id, media_id):
        """The worker has finished sending the specified media object; call any necessary callbacks"""

        # print("Media complete: '%s', '%s'" % (request_id, media_id))
        if request_id in self._media_tracking:
            media_ids, callback = self._media_tracking[request_id]
            media_ids.discard(media_id)
            if len(media_ids) == 0:
                callback()
                del self._media_tracking[request_id]

    # Slightly awkward shimming of profiling information into a response message
    def fill_out_profiling(self, response_msg, description="Downlink dispatch"):
        """Add profiling information to a response message"""

        p = response_msg.get("profile", None)
        response_msg["profile"] = {
            "origin": "Server (Python)",
            "description": description,
            "start-time": float(self.start_times.get(response_msg['id'], 0)*1000),
            "end-time": float(time.time()*1000)
        }
        if p is not None:
            response_msg["profile"]["children"] = [p]

            for o in response_msg.get("objects", []):
                if o["path"][0] == "profile":
                    o["path"].insert(1,"children")
                    o["path"].insert(2, 0)

    report_stats = report_worker_stats


# Import the actual worker modules

def init_pdf_worker():
    global launch_pdf_worker

    if sys.version_info < (3,7,0):
        print("Warning: PDF Rendering requires Python 3.7. Renderer not initialised")
    elif IS_WINDOWS:
        print("Warning: PDF Rendering not supported on Windows. Renderer not initialised")
    else:
        from . import pdf_renderer
        launch_pdf_worker = pdf_renderer.launch


if RUNTIME_ID == "pdf-renderer":
    init_pdf_worker()
elif RUNTIME_ID.endswith('-sandbox'):
    from . import pypy_sandbox
    launch_worker = pypy_sandbox.launch
else:
    from . import full_python
    launch_worker = full_python.launch

    if ENABLE_PDF_RENDER:
        init_pdf_worker()


def signal_drain(_signum, _frame):
    global draining_start_time
    connection.send_with_header({
        "type": "DRAIN"
    })
    print("Draining downlink. %s call(s) remaining:" % len(workers_by_id))
    print(list(workers_by_id.keys()))
    draining_start_time = time.time()
    maybe_quit_if_draining_and_done()


def report_stats():
    workers = set(workers_by_id.values())
    worker_stats = []
    for worker in workers:
        stats = worker.report_stats()
        mem_usage = stats.get("mem", {}).get("uss", 0)
        if PER_WORKER_SOFT_MEMORY_LIMIT is not None and mem_usage > PER_WORKER_SOFT_MEMORY_LIMIT:
            print("Worker is using %.0fMB: %s " % (mem_usage/(1024*1024.0), stats.get('info')))
            worker.drain()
        worker_stats.append(stats)
    connection.send_with_header({
        "type": "STATS",
        "data": worker_stats
    })



def run_downlink_host():
    global connection

    url = os.environ.get("DOWNLINK_SERVER", "ws://127.0.0.1:3000/downlink")
    key = os.environ.get("DOWNLINK_KEY", "ZeXiedeaceimahm1ePhaguvu5Ush9E")
    os.environ['TZ'] = 'UTC'

    for v in ["DOWNLINK_SERVER", "DOWNLINK_KEY"]:
        if v in os.environ:
            del os.environ[v]

    connection = Connection(url, key)

    connection.connect()

    if not IS_WINDOWS:
        try:
            signal.signal(signal.SIGUSR2, signal_drain)
        except Exception as e:
            print("Failed to add signal handler: %s" % e)

    n = 0
    while True:
        try:
            for _ in range(6):
                time.sleep(5)
                report_stats()

            connection.send_with_header({
                "type": "CALL",
                "id": "downlink-keepalive-%d" % n,
                "command": "anvil.private.echo",
                "args": ["keep-alive"],
                "kwargs": {},
            })
            n += 1
        except Exception as e:
            print("Keepalive failed. The downlink has probably disconnected.")
            print(e)
            os._exit(1)
