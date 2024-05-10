import os, threading

import anvil_downlink_host
from anvil_downlink_host import TIMEOUT as CALL_TIMEOUT, BACKGROUND_TIMEOUT

CAN_PERSIST = (os.environ.get("DOWNLINK_CAN_PERSIST", "false").lower() in {"true", "1"})
# How long does the latest version of server code stay around? (default: 48 hours)
PRIMARY_PERSIST_TIME = int(os.environ.get("DOWNLINK_PRIMARY_PERSIST_TIMEOUT", 48*60*60))
# How long do other versions of server code (not the latest) stay around? (default: 2 minutes)
SECONDARY_PERSIST_TIME = int(os.environ.get("DOWNLINK_PRIMARY_PERSIST_TIMEOUT", 120))

# cache-key -> app-version -> WorkerEntry
entries_by_cache_key = {}
# Worker -> WorkerEntry
entries_by_worker = {}
CACHE_LOCK = threading.Lock()

# Worker -> kill timer (to cancel if it dies naturally)
retiring_workers = {}


# Half-baked enum for 2.7 compat
class WorkerState:
    NEW = "NEW"
    PRIMARY = "PRIMARY"
    SECONDARY = "SECONDARY"
    DRAINING = "DRAINING"
    RETIRING = "RETIRING"
    DEAD = "DEAD"


class WorkerEntry:
    def __init__(self, worker, cache_key, app_version):
        self.worker = worker
        self.cache_key = cache_key
        self.app_version = app_version
        self.state = WorkerState.NEW
        self.idle = True
        self._n_calls = 0
        self._timeout = None

    def repr(self):
        return "WorkerEntry<%s,%s>" % (self.state, self.cache_key)

    def demote(self):
        # A call has arrived for our cache key but not our version; we are now secondary at best
        if self.state == WorkerState.PRIMARY:
            print("%s demoted" % self)
            self.state = WorkerState.SECONDARY
            self._set_timeout()

    def promote(self):
        # A call has arrived for our cache key and version; we are now primary
        if self.state != WorkerState.PRIMARY:
            print("%s promoted" % self)
        self.state = WorkerState.PRIMARY
        self.idle = False
        self._n_calls += 1
        self._set_timeout()

    def _set_timeout(self):
        self._cancel_timeout()
        if self.state == WorkerState.PRIMARY:
            if PRIMARY_PERSIST_TIME == 0: # infinite is allowed
                return
            n_secs = PRIMARY_PERSIST_TIME
        elif self.state == WorkerState.SECONDARY:
            n_secs = SECONDARY_PERSIST_TIME
        else:
            n_secs = 1 # everyone else dies, like, fast.
        n_calls_at_timeout_set = self._n_calls
        self._timeout = threading.Timer(n_secs, lambda: self._start_draining(n_calls_at_timeout_set))
        self._timeout.start()

    def _cancel_timeout(self):
        if self._timeout is not None:
            self._timeout.cancel()
            self._timeout = None

    def set_dead(self):
        print("%s dead" % self)
        self.state = WorkerState.DEAD
        self._cancel_timeout()

    def set_retiring(self):
        print("%s retiring" % self)
        self.state = WorkerState.RETIRING
        self._cancel_timeout()

    def set_idle(self):
        self.idle = True

    # These are the only methods that may be called *without* CACHE_LOCK held
    def handle_call(self, msg):
        self.worker.send(msg)

    def _start_draining(self, n_calls_at_timeout_set):
        terminate_immediately = False
        with CACHE_LOCK:
            if self._n_calls != n_calls_at_timeout_set:
                # There have been new calls since this timeout, we're irrelevant
                print("%s ignoring drain timeout because we've received calls" % self)
                return
            print("%s draining due to inactivity (idle? %s)" % (self, self.idle))
            self.state = WorkerState.DRAINING
            self._cancel_timeout()
            if self.idle:
                terminate_immediately = True
            else:
                self._timeout = threading.Timer(CALL_TIMEOUT, lambda: self._hard_kill)
                self._timeout.start()
        if terminate_immediately:
            self._hard_kill()

    def _hard_kill(self):
        print("%s hard kill" % self)
        with CACHE_LOCK:
            if self.state != WorkerState.DRAINING:
                # Reprieve!
                print("%s aborted hard kill because no longer draining (now %s)" % (self, self.state))
                return
            _remove_entry_from_cache(self)
            self._cancel_timeout()
        self.worker.terminate()


def _remove_entry_from_cache(entry):
    entries_by_worker.pop(entry.worker, None)
    entries_by_version = entries_by_cache_key.get(entry.cache_key)
    if entries_by_version is not None:
        entries_by_version.pop(entry.app_version, None)
        if not entries_by_version:
            del entries_by_cache_key[entry.cache_key]


def worker_died(worker):
    # This worker is dead; remove it from caches forthwith
    with CACHE_LOCK:
        entry = entries_by_worker.get(worker)
        if entry is not None:
            entry.set_dead()
            _remove_entry_from_cache(entry)
        else:
            retire_timeout = retiring_workers.pop(worker, None)
            print("Uncached worker %s died; retired? %s" % (worker, bool(retire_timeout)))
            if retire_timeout is not None:
                retire_timeout.cancel()


def worker_idle(worker):
    terminate = False
    with CACHE_LOCK:
        entry = entries_by_worker.get(worker)
        if entry is None:
            terminate = True
        elif entry.state == WorkerState.DRAINING:
            _remove_entry_from_cache(entry)
            entry.cancel_timeouts()
            terminate = True
        else:
            entry.set_idle()

    if terminate:
        worker.terminate()


def retire_worker(worker, grace_period=CALL_TIMEOUT):
    """Do not route any more requests to this worker, and kill it if it does not terminate within a grace period"""
    def do_kill():
        retiring_workers.pop(entry.worker, None)
        entry.worker.terminate()

    with CACHE_LOCK:
        entry = entries_by_worker.get(worker)
        if entry:
            print("Retiring %s" % entry)
            entry.set_retiring()
            _remove_entry_from_cache(entry)

            t = retiring_workers[entry.worker] = threading.Timer(grace_period, do_kill)
            t.start()
    if not entry:
        print("Fast kill on timeout")
        worker.terminate()


anvil_downlink_host.retire_cached_worker = retire_worker


def handle(msg):
    # We import Worker in local scope because both 'worker' and 'worker_cache' refer to each other, and some of the
    # obvious ways of doing that don't work in Python 2. Refactor with care.
    from .worker import Worker

    persist_key = msg.get("persist-key")
    app_version = msg.get("app-version")
    app_id = msg.get("app-id")
    bg_task_timeout = msg.get("bg-task-timeout")

    is_background_task = msg["type"] == "LAUNCH_BACKGROUND"
    is_repl_launch = msg["type"] == "LAUNCH_REPL"
    can_timeout = None if is_repl_launch else BACKGROUND_TIMEOUT if is_background_task else CALL_TIMEOUT
    if is_background_task and bg_task_timeout is not None:
        can_timeout = min(bg_task_timeout, can_timeout) if can_timeout else bg_task_timeout
    # print("Timeout?", is_repl_launch, is_background_task, BACKGROUND_TIMEOUT, CALL_TIMEOUT)

    if CAN_PERSIST and not is_background_task and not is_repl_launch and persist_key is not None and app_id and app_version is not None:
        # It's cacheable; let's go.
        cache_key = (app_id, persist_key)

        with CACHE_LOCK:
            entries_by_version = entries_by_cache_key.setdefault(cache_key, {})
            entry = entries_by_version.get(app_version)
            if not entry:
                worker = Worker(msg, app_version=app_version, set_timeout=False, task_info={
                    "app_id": app_id,
                    "type": "persistent_worker",
                    "task": msg.get("command"),
                    "persist": {"key": persist_key, "version": app_version},
                })
                print("Launched new worker: %s" % worker)
                entry = WorkerEntry(worker, cache_key, app_version)
                entries_by_version[app_version] = entry
                entries_by_worker[worker] = entry
            else:
                print("Found worker for %s / %s: %s -> %s" % (cache_key, app_version, entry, entry.worker))
            for e in entries_by_version.values():
                if e is not entry:
                    e.demote()
            entry.promote()

        entry.handle_call(msg)

        #print("Attempt persistence: %s" % cache_key)
        #print("Version %s:\n%s\nvs\n%s" % (("MATCH" if version==supplied_version else "MISMATCH"), version, supplied_version))
    else:
        # Straight launch, no cache
        w = Worker(msg, app_version=app_version, set_timeout=can_timeout, task_info={
            "app_id": app_id,
            "type": "repl" if is_repl_launch else "background_task" if is_background_task else "server_call",
            "task": msg.get("command"),
            "persist": None,
        })
        print("Single-use worker %s" % w)
        w.send(msg)


    # if statsd:
    #     if is_background_task:
    #         statsd.incr('Downlink.LaunchBackgroundTask')
    #     else:
    #         statsd.incr('Downlink.Call')

