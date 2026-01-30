import psutil, random, sys, threading
from subprocess import PIPE
from anvil_downlink_util.pipes import MessagePipe

# State representing which workers are running here
from anvil_downlink_host import send_with_header, maybe_quit_if_draining_and_done, \
    PopenWithGroupKill, get_demote_fn, TIMEOUT, \
    report_worker_stats, BaseWorker, report_oversize_response, truncate_oversize_output

import anvil_downlink_host.full_python.worker_cache as cache

from anvil_downlink_util.tracing import trace
tracer = trace.get_tracer(__name__)

REPL_TIMEOUT=30 # This must be more than the interval between heartbeat messages sent from worker-heartbeat in the IDE.

class Worker(BaseWorker):
    def __init__(self, initial_msg, app_version=None, set_timeout=TIMEOUT, task_info=None):
        BaseWorker.__init__(self, initial_msg, task_info)

        first_req_id = initial_msg["id"]

        app_id = initial_msg.get("app-id", "<unknown>")
        self.record_inbound_call_started(initial_msg)

        with tracer.start_span("Launch full Python worker"):
            self.proc = PopenWithGroupKill([sys.executable, "-um", "anvil_downlink_worker.full_python_worker"],
                                           bufsize=0, stdin=PIPE, stdout=PIPE, preexec_fn=get_demote_fn(app_id))
            self.proc_info = psutil.Process(self.proc.pid)
            self.from_worker = MessagePipe(self.proc.stdout)
            self.to_worker = MessagePipe(self.proc.stdin)


            self.timed_out = False
            self.timeout_msg = ""
            self.timeouts = {}
            self.hard_timeout_timer = None
            self.app_version = app_version
            if set_timeout:
                self.set_timeout(first_req_id, set_timeout, request_id=first_req_id)

            self.enable_profiling = {first_req_id: initial_msg.get("enable-profiling", False)}
            self.killing_task = False
            self.global_error = None

        threading.Thread(target=self.read_loop, name="Worker.read_loop {}".format(repr(self))).start()

    def __repr__(self):
        return "<Worker first_req_id=%s pid=%s reqs=%s outbound=%s at %s>" % (self.initial_req_id, self.proc.pid,len(self.req_ids), len(self.outbound_ids), hex(id(self)))

    def set_timeout(self, timeout_key, timeout_duration=TIMEOUT, timeout_msg="", request_id=None):
        # print("Set timeout for %s, msg %r" % (timeout_key, timeout_msg))
        if timeout_key in self.timeouts:
            return
        timeout_timer = threading.Timer(timeout_duration, lambda: self.soft_timeout(timeout_key, timeout_msg, request_id))
        timeout_timer.daemon = True
        self.timeouts[timeout_key] = timeout_timer
        timeout_timer.start()

    def clear_timeout(self, timeout_key):
        timeout_timer = self.timeouts.pop(timeout_key, None)
        if timeout_timer is not None:
            timeout_timer.cancel()

    def soft_timeout(self, timeout_key, timeout_msg, request_id):
        # Something has timed out. If we are cached, drain ourselves nicely before terminating
        print("TIMEOUT for %s %r" % (timeout_key, timeout_msg))
        self.timed_out = True
        self.timeout_msg = timeout_msg

        cache.retire_worker(self)
        if len(self.req_ids) == 1:
            self.hard_timeout()
        elif request_id is not None:
            # This worker will be killed by retirement some time in the future...but that might be
            # quite a way in the future. If we know the ID of the request, give the developer a hint
            # that this is the offending request!
            send_with_header({"id": request_id, "output": "[SERVER CALL TOOK TOO LONG, WILL BE TERMINATED SHORTLY]\n"})


    def hard_timeout(self):
        print("TIMEOUT TERMINATE FOR %s" % self.req_ids)
        self.timed_out = True
        self.proc.terminate()

    def kill_with_error(self, err):
        self.global_error = err
        self.proc.terminate()

    def terminate(self):
        try:
            self.proc.terminate()
            cache.worker_died(self)
        except:
            pass

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
        self.enable_profiling.pop(req_id, None)
        self.record_inbound_call_complete(req_id)

        #print("Done @%s -> %s" % (self.cache_key, cached_workers.get(self.cache_key)))

    def kill_background_task(self):
        if self.killing_task:
            return
        self.killing_task = True
        print("SOFT KILL BACKGROUND TASK %s" % self.initial_req_id)

        # Request state. If it returns with in 5 seconds, we will die with state, else we hard-kill
        self.hard_timeout_timer = threading.Timer(5, self._hard_kill_background_task)
        self.hard_timeout_timer.daemon = True
        self.send({'type': 'GET_TASK_STATE', 'id': 'pre-kill-task-state'})
        self.hard_timeout_timer.start()

    def _hard_kill_background_task(self):
        print("HARD KILL BACKGROUND TASK %s" % self.initial_req_id)
        try:
            self.req_ids.discard('pre-kill-task-state')
            send_with_header({'type': 'NOTIFY_TASK_KILLED', 'id': self.initial_req_id})
        finally:
            self.hard_timeout()

    # Output gets forwarded straight upstream
    def read_loop(self):
        try:
            while True:
                try:
                    msg, bindata = self.from_worker.receive()
                except EOFError:
                    break
                type = msg.get("type")
                id = msg.get("id") or msg.get("requestId")

                if type == "CALL" or type == "GET_APP":
                    self.record_outbound_call_started(msg)
                elif type == "SPANS":
                    send_with_header(msg)
                    continue
                else:
                    if id is None:
                        if "output" in msg:
                            # Output from unknown thread? Broadcast it.
                            print("Broadcasting output from unknown thread: %s" % msg)
                            for i in self.req_ids:
                                msg["id"] = i
                                send_with_header(msg, on_oversize=truncate_oversize_output)
                        else:
                            print("Discarding invalid message with no ID: %s" % repr(msg))
                        continue
                    if id not in self.req_ids and id not in self.outbound_ids:
                        print("Discarding invalid message with bogus ID: %s" % repr(msg))
                        if type == "CHUNK_HEADER":
                            print("Discarding binary data chunk")
                        continue

                try:
                    if type == "CHUNK_HEADER":
                        send_with_header(msg, bindata)
                        if msg.get("lastChunk"):
                            self.transmitted_media(msg['requestId'], msg['mediaId'])
                    else:

                        if "response" in msg and self.enable_profiling.get(id):
                            self.fill_out_profiling(msg)

                        if "debugger" in msg:
                            dbg = msg["debugger"]
                            if dbg["state"] == "PAUSED_EXECUTING":
                                self.set_timeout(
                                    msg["id"],
                                    timeout_msg="Code executing while debugger paused took too long",
                                    request_id=msg["id"]
                                )
                            elif dbg["state"] == "PAUSED":
                                self.clear_timeout(msg["id"])
                            elif dbg["state"] == "RUNNING":
                                self.set_timeout(msg["id"], request_id=msg["id"])
                            elif dbg["state"] == "TERMINATED":
                                self.kill_with_error(
                                    {
                                        "message": "Server code debug execution was killed.",
                                        "type": "anvil.server.ExecutionTerminatedError",
                                    }
                                )

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

                            send_with_header({'type': 'NOTIFY_TASK_KILLED', 'id': self.initial_req_id,
                                              'taskState': msg['response'], 'objects': objects})

                            if self.hard_timeout_timer:
                                self.hard_timeout_timer.cancel()

                            self.proc.terminate()
                        else:
                            on_oversize = None
                            if "response" in msg or "error" in msg:
                                on_oversize = report_oversize_response
                            elif type == "CALL":
                                on_oversize = self.report_oversize_call
                            elif "output" in msg:
                                on_oversize = truncate_oversize_output
                            send_with_header(msg, on_oversize=on_oversize)

                    if "response" in msg or "error" in msg:
                        #if statsd and (id in self.start_times):
                        #    statsd.timing('Downlink.WorkerLifetime', (time.time()*1000) - self.start_times.get(id, 0)*1000)
                        self.on_media_complete(msg, lambda: self.responded(id))
                        if "error" in msg and msg.get("moduleLoadFailed"):
                            self.kill_with_error(msg["error"])


                except UnicodeError:
                    send_with_header({"id": id, "error": {"type": "UnicodeError", "message": "This function returned a binary string (not text). If you want to return binary data, use a BlobMedia object instead."}})
                    self.responded(id)

        except EOFError:
            print("EOFError while reading worker stdout. This should not have happened.")
            pass

        finally:


            rt = self.proc.poll()
            if rt is None:
                self.proc.terminate()
            for _,t in self.timeouts.items():
                t.cancel()

            cache.worker_died(self)

            error_id = "".join([random.choice('0123456789abcdef') for x in range(10)])

            if self.global_error is not None:
                err = self.global_error
            elif self.timed_out:
                err = {
                    'message': self.timeout_msg or "Server code took too long",
                    'type': "anvil.server.TimeoutError"
                }
            elif rt == -9:
                err = {
                    'message': "Server code execution process was killed. This is usually caused by running out of memory. (%s)" % (error_id),
                    'type': "anvil.server.ExecutionTerminatedError"
                }
            elif rt is not None and rt < 0:
                err = {
                    'message': "Server code execution process was killed with signal %d. (%s)" % (-rt, error_id),
                    'type': "anvil.server.ExecutionTerminatedError"
                }
            else:
                err = {
                    'message': "Server code exited unexpectedly: %s (exit code %s)" % (error_id, rt),
                    'type': "anvil.server.ExecutionTerminatedError"
                }

            self.report_dead(err, self.global_error is None and not self.timed_out)
            print ("Worker terminated for IDs %s (return code %s) %s: %s" % (self.req_ids, rt, error_id, self))

            # Don't clean up until we've sent the errors, so media shootdowns happen afterwards.
            self.clean_up_all_outstanding_records(err)

            maybe_quit_if_draining_and_done()

    def send(self, msg, bindata=None):
        # RECEIVE FROM PLATFORM SERVER, SEND TO WORKER
        id = msg.get("id")
        msg_type = msg.get("type")
        if msg_type in ["CALL", "GET_TASK_STATE", "LAUNCH_REPL", "REPL_COMMAND", "TERMINATE_REPL", "DEBUG_REQUEST"]:
            # It's a new request! Start the timeout
            #print ("Setting timeout and routing for new request ID %s" % id)
            self.record_inbound_call_started(msg)
            if msg.get("enable-profiling"):
                self.enable_profiling[id] = True
            if msg["type"] == "LAUNCH_REPL":
                # We don't want to use the configurable worker timeout here. REPLs time out
                # if they don't receive keepalives, which arrive every 20s.
                self.set_timeout(id, request_id=id, timeout_duration=REPL_TIMEOUT, timeout_msg="Server repl disconnected")
            elif msg["type"] != "REPL_COMMAND":
                timeout_msg = "Timeout getting task state, terminating task" \
                    if msg["type"] == "GET_TASK_STATE" else None
                self.set_timeout(id, request_id=id, timeout_msg=timeout_msg)


        elif msg_type == "REPL_KEEPALIVE":
            self.clear_timeout(msg["repl"])
            # REPL_KEEPALIVE messages arrive every 20s, so we want a fixed custom timeout of 30s here, regardless of the usual worker timeout.
            self.set_timeout(msg["repl"], timeout_duration=REPL_TIMEOUT, timeout_msg="Server repl disconnected")
            send_with_header({"id": id, "response": None})
            return

        try:
            self.to_worker.send(msg, bindata)
        except (BrokenPipeError, EOFError) as e:
            print("Host got {}: {} sending to worker, terminating.".format(type(e).__name__, e))
            try:
                self.proc.terminate()
            except:
                # Ignore it. The cleanup machinery (via record_inbound_call_started()) will report anything that
                # needs reporting.
                pass


        if "response" in msg or "error" in msg or msg_type == "PROVIDE_APP":
            self.on_media_complete(msg, lambda: self.record_outbound_call_complete(id))
        elif msg.get("type") == "PROVIDE_APP":
            self.record_outbound_call_complete(id)

    def get_task_state(self, msg):
        self.send(msg)

    def handle_debug_request(self, msg):
        self.send(msg)

    def handle_inbound_message(self, msg, bindata=None):
        self.send(msg, bindata)
        if bindata is not None and msg.get("lastChunk"):
            self.transmitted_media(msg.get("requestId"), msg.get("mediaId"))

    def on_all_inbound_calls_complete(self):
        cache.worker_idle(self)

    def report_oversize_call(self, json_data):
        def respond():
            self.send({
                "id": json_data.get("id"),
                "error": {
                    "type": "anvil.server.SerializationError",
                    "message": "Tried to pass too much data to a server function - please use Media objects to transfer large amounts of data."
                }
            })
        # Do this in another thread to avoid locking up sending thread
        threading.Thread(target=respond).start()

    report_stats = report_worker_stats
