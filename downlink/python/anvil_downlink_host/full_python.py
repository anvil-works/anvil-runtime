import  marshal, os, psutil, random, sys, threading, time
from subprocess import PIPE

# State representing which workers are running here
from anvil_downlink_host import workers_by_id, send_with_header, maybe_quit_if_draining_and_done, \
                                    PopenWithGroupKill, get_demote_fn, TIMEOUT, \
                                    report_worker_stats

CAN_PERSIST = (os.environ.get("DOWNLINK_CAN_PERSIST", "false").lower() in {"true", "1"})

cached_workers = {}
CACHE_LOCK = threading.Lock()

class Worker:
    def __init__(self, first_req_id, enable_profiling=False, app_id=None, app_version=None, cache_key=None, set_timeout=True, task_info=None):
        self.req_ids = {first_req_id}
        self.outbound_ids = {} # Outbound ID -> inbound ID it came from
        self.lock = threading.RLock()
        self.media_tracking = {} # reqID -> (set([mediaId, mediaId, ]), finishedCallback)

        self.proc = PopenWithGroupKill([sys.executable, "-um", "anvil_downlink_worker.full_python_worker"],
                                       bufsize=0, stdin=PIPE, stdout=PIPE, preexec_fn=get_demote_fn(app_id))
        self.proc_info = psutil.Process(self.proc.pid)
        self.task_info = task_info

        workers_by_id[first_req_id] = self
        self.cache_key = cache_key
        if cache_key is not None:
            #print("Saving to cache for %s [version %s]" % (cache_key, app_version))
            with CACHE_LOCK:
                old_version, displaced_worker = cached_workers.get(cache_key, (None, None))
                cached_workers[cache_key] = (app_version, self)
            if displaced_worker is not None:
                print("Displacing persistent worker for %s:\nVersion %s -> %s" % (cache_key, old_version, app_version))
                displaced_worker.drain()
            else:
                print("New persistent worker for %s (version %s)" % (cache_key, app_version))

        self.timed_out = False
        self.timeouts = {}
        self.app_version = app_version
        if cache_key is None and set_timeout:
            self.set_timeout(first_req_id)

        self.start_time = {first_req_id: time.time()}
        self.enable_profiling = {first_req_id: enable_profiling}
        self.killing_task = False

        threading.Thread(target=self.read_loop).start()

    def on_media_complete(self, msg, callback):
        media_ids = set()
        for o in msg.get("objects", []):
            if "DataMedia" in o.get("type", []):
                media_ids.add(o["id"])
        if len(media_ids) == 0:
            callback()
        else:
            #print("Waiting for media for request '%s': %s" % (msg['id'], repr(list(media_ids))))
            self.media_tracking[msg['id']] = (media_ids, callback)

    def transmitted_media(self, request_id, media_id):
        #print("Media complete: '%s', '%s'" % (request_id, media_id))
        if request_id in self.media_tracking:
            media_ids, callback = self.media_tracking[request_id]
            media_ids.discard(media_id)
            if len(media_ids) == 0:
                callback()
                del self.media_tracking[request_id]

    def set_timeout(self, timeout_key):
        #print("Set timeout for %s" % timeout_key)
        if timeout_key in self.timeouts:
            return
        timeout_timer = threading.Timer(TIMEOUT, lambda: self.soft_timeout(timeout_key))
        self.timeouts[timeout_key] = timeout_timer
        timeout_timer.start()

    def clear_timeout(self, timeout_key):
        timeout_timer = self.timeouts.pop(timeout_key, None)
        if timeout_timer is not None:
            timeout_timer.cancel()

    def soft_timeout(self, timeout_key):
        # Something has timed out. If we are cached, drain ourselves nicely before terminating
        print("TIMEOUT for %s" % timeout_key)
        self.timed_out = True
        if self.cache_key is None:
            self.hard_timeout()
        else:
            print("Cached worker %s timed out; draining" % self.cache_key)
            with CACHE_LOCK:
                if self.cache_key in cached_workers and cached_workers[self.cache_key][1] is self:
                    cached_workers.pop(self.cache_key, None)
            self.timeout_timer = threading.Timer(TIMEOUT, self.hard_timeout)
            self.timeout_timer.start()

    def hard_timeout(self):
        print("TIMEOUT TERMINATE FOR %s" % self.req_ids)
        self.timed_out = True
        self.proc.terminate()

    def drain(self):
        # Finish up our execution and time out.
        if self.cache_key is None:
            print("Worker for %s is not cached, ignoring drain request" % self.req_ids)
        elif len(self.req_ids) == 0:
            print("Worker for %s drained, terminating instantly (version %s)" % (self.cache_key, self.app_version))
            try:
                self.proc.terminate()
            except:
                pass
        else:
            print("Worker for %s draining, setting timeout (version %s)" % (self.cache_key, self.app_version))
            self.set_timeout("DRAINED")

    def responded(self, req_id):
        self.clear_timeout(req_id)
        self.req_ids.discard(req_id)
        workers_by_id.pop(req_id, None)
        self.start_time.pop(req_id, None)
        self.enable_profiling.pop(req_id, None)
        if (self.cache_key is None or cached_workers.get(self.cache_key, (None,None))[1] is not self) and len(self.req_ids) == 0:
            # Drain complete; goodbye!
            if self.cache_key is not None:
                print("Cache worker for %s drained (version %s)" % (self.cache_key, self.app_version))
            self.proc.terminate()

        maybe_quit_if_draining_and_done()
        #print("Done @%s -> %s" % (self.cache_key, cached_workers.get(self.cache_key)))

    def kill_background_task(self):
        if self.killing_task:
            return
        self.killing_task = True

        # Request state. If it returns with in 5 seconds, we will die with state, else we hard-kill
        self.timeout_timer = threading.Timer(5, self._hard_kill_background_task)
        self.send({'type': 'GET_TASK_STATE', 'id': 'pre-kill-task-state'})
        self.timeout_timer.start()

    def _hard_kill_background_task(self):
        print("TIMEOUT KILLING BACKGROUND TASK %s" % self.req_ids)
        try:
            self.req_ids.discard('pre-kill-task-state')
            send_with_header({'type': 'NOTIFY_TASK_KILLED', 'id': list(self.req_ids)[0]})
        finally:
            self.hard_timeout()

    # Output gets forwarded straight upstream
    def read_loop(self):
        try:
            while True:
                # marshal.load() takes the GIL, so only do it once we know there's something there to load.
                dummy_char = self.proc.stdout.read(1)
                if len(dummy_char) == 0:
                    break
                msg = marshal.load(self.proc.stdout)
                type = msg.get("type")
                id = msg.get("id") or msg.get("requestId")

                if type == "CALL" or type == "GET_APP":
                    self.outbound_ids[msg["id"]] = msg.get('originating-call')
                    workers_by_id[msg["id"]] = self
                else:
                    if id is None:
                        if "output" in msg:
                            # Output from unknown thread? Broadcast it.
                            print("Broadcasting output from unknown thread: %s" % msg)
                            for i in self.req_ids:
                                msg["id"] = i
                                send_with_header(msg)
                        else:
                            print("Discarding invalid message with no ID: %s" % repr(msg))
                        continue
                    if id not in self.req_ids and id not in self.outbound_ids:
                        print("Discarding invalid message with bogus ID: %s" % repr(msg))
                        if type == "CHUNK_HEADER":
                            print("Discarding binary data chunk")
                            marshal.load(self.proc.stdout)
                        continue

                try:
                    if type == "CHUNK_HEADER":
                        x = marshal.load(self.proc.stdout)
                        send_with_header(msg, x)
                        if msg.get("lastChunk"):
                            self.transmitted_media(msg['requestId'], msg['mediaId'])
                    else:

                        if "response" in msg and self.enable_profiling.get(id):
                            p = msg.get("profile", None)
                            msg["profile"] = {
                                "origin": "Server (Python)",
                                "description": "Downlink dispatch",
                                "start-time": float(self.start_time.get(id, 0)*1000),
                                "end-time": float(time.time()*1000)
                            }
                            if p is not None:
                                msg["profile"]["children"] = [p]

                                for o in msg.get("objects", []):
                                    if o["path"][0] == "profile":
                                        o["path"].insert(1,"children")
                                        o["path"].insert(2, 0)

                        if "response" in msg and msg['id'] == 'pre-kill-task-state':
                            # Special case handling for a "clean" kill (where we manage to recover the state)

                            objects = msg.get('objects', [])
                            for o in objects:
                                if 'path' in o and o['path'][0] == 'response':
                                    o['path'][0] = 'taskState'
                                if 'DataMedia' in o['type']:
                                    msg['objects'] = []
                                    msg['response'] = None
                                    break

                            self.req_ids.discard('pre-kill-task-state')

                            send_with_header({'type': 'NOTIFY_TASK_KILLED', 'id': list(self.req_ids)[0],
                                                         'taskState': msg['response'], 'objects': objects})

                            self.proc.terminate()
                        else:
                            send_with_header(msg)

                    if "response" in msg or "error" in msg:
                        #if statsd and (id in self.start_time):
                        #    statsd.timing('Downlink.WorkerLifetime', (time.time()*1000) - self.start_time.get(id, 0)*1000)
                        self.on_media_complete(msg, lambda: self.responded(id))

                except UnicodeError:
                    send_with_header({"id": id, "error": {"type": "UnicodeError", "message": "This function returned a binary string (not text). If you want to return binary data, use a BlobMedia object instead."}})
                    self.responded(id)

        except EOFError:
            print("EOFError while reading worker stdout. This should not have happened.")
            pass

        finally:
            for i in self.req_ids:
                workers_by_id.pop(i, None)
            for i in self.outbound_ids.keys():
                workers_by_id.pop(i, None)
            rt = self.proc.poll()
            if rt is None:
                self.proc.terminate()
            for _,t in self.timeouts.items():
                t.cancel()
            if self.cache_key is not None and cached_workers.get(self.cache_key, (None,None))[1] is self:
                cached_workers.pop(self.cache_key, None)

            error_id = "".join([random.choice('0123456789abcdef') for x in range(10)])
            for i in self.req_ids:
                if self.timed_out:
                    message = 'Server code took too long'
                    type = "anvil.server.TimeoutError"
                elif rt == -9:
                    message = 'Server code execution process was killed. It may have run out of memory: %s' % (error_id)
                    type = "anvil.server.ExecutionTerminatedError"
                    sys.stderr.write(message + " (IDs %s)\n" % i)
                    sys.stderr.flush()
                else:
                    message = 'Server code exited unexpectedly: %s' % (error_id)
                    type = "anvil.server.ExecutionTerminatedError"
                    sys.stderr.write(message + " (IDs %s)\n" % i)
                    sys.stderr.flush()
                send_with_header({'id': i, 'error':{'type': type, 'message': message}})
            print ("Worker terminated for IDs %s (return code %s)" % (self.req_ids, rt))
            maybe_quit_if_draining_and_done()

    def send(self, msg, bin=False):

        if not bin:
            id = msg.get("id")
            if msg.get("type") in ["CALL", "CALL_WITH_APP", "GET_TASK_STATE", "LAUNCH_REPL", "REPL_COMMAND", "TERMINATE_REPL"]:
                # It's a new request! Start the timeout
                #print ("Setting timeout and routing for new request ID %s" % id)
                workers_by_id[id] = self
                if msg.get("enable-profiling"):
                    self.enable_profiling[id] = True
                    self.start_time[id] = time.time()
                self.req_ids.add(id)
                if msg["type"] != "REPL_COMMAND":
                    self.set_timeout(id)

            elif msg.get("type") == "REPL_KEEPALIVE":
                self.clear_timeout(msg["repl"])
                self.set_timeout(msg["repl"])
                send_with_header({"id": id, "response": None})
                return

            # A horrid hack - a one-char "activation" that's not marshalled, because marshal holds the GIL and Windows doesn't support select() on pipes and urrrggghhh

            d = b"X" + marshal.dumps(msg)
        else:
            d = marshal.dumps(msg)

        self.proc.stdin.write(d)
        self.proc.stdin.flush()

        if not bin:
            def outbound_done():
                self.outbound_ids.pop(id, None)
                workers_by_id.pop(id, None)
                maybe_quit_if_draining_and_done()

            if "response" in msg or "error" in msg:
                self.on_media_complete(msg, outbound_done)

    def get_task_state(self, msg):
        self.send(msg)

    def handle_inbound_message(self, msg, bin=None):
        self.send(msg)
        if bin is not None:
            self.send(bin, bin=True)
            if msg.get("last_chunk"):
                self.transmitted_media(msg.get("requestId"), msg.get("mediaId"))

    report_stats = report_worker_stats


def launch(data):
    type = data.get("type")
    id = data.get("id")

    persist_key = data.get("persist-key")

    start_time = time.time()

    is_background_task = (type in ["LAUNCH_BACKGROUND", "LAUNCH_BACKGROUND_WITH_APP"])
    is_repl_launch = type == "LAUNCH_REPL"
    cache_key = None
    worker = None
    version = None
    supplied_version = data.get("app-version")

    print ("%s '%s' for app '%s' (ID %s)" % ("Launching REPL" if is_repl_launch else "Launching BG task" if is_background_task else "Calling function",
                                             data.get("command", "<no func>"), data.get("app-id", "<unknown>"), id))

    if CAN_PERSIST and not is_background_task and persist_key is not None and "app-id" in data and supplied_version is not None:
        cache_key = repr((data["app-id"], persist_key))
        #print("Attempt persistence: %s" % cache_key)
        version, worker = cached_workers.get(cache_key, (None,None))
        #print("Version %s:\n%s\nvs\n%s" % (("MATCH" if version==supplied_version else "MISMATCH"), version, supplied_version))

    if data.get('command') == "anvil.private.pdf.get_component" and not is_background_task:
        wid = data['args'][0][0]
        worker = workers_by_id.get(wid)
        if worker is None:
            send_with_header({'id': id, 'error': {'message': "No component worker found for print call '%s'" % wid}})
            return

    elif worker is None or version != supplied_version:
        worker = Worker(id, data.get("enable-profiling", False), data.get("app-id", "<unknown>"),
                        cache_key=cache_key, app_version=supplied_version, set_timeout=not is_background_task and not is_repl_launch,
                        task_info={
                            "app_id": data["app-id"],
                            "type": "repl" if is_repl_launch else "background_task" if is_background_task else "persistent_worker" if cache_key else "server_call",
                            "task": data.get("command"),
                            "persist": {"key": persist_key, "version": supplied_version} if cache_key else None,
                        })

    worker.send(data)

    # if statsd:
    #     if is_background_task:
    #         statsd.incr('Downlink.LaunchBackgroundTask')
    #     else:
    #         statsd.incr('Downlink.Call')

