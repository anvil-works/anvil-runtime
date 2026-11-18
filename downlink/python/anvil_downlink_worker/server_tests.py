from __future__ import absolute_import
import base64
import io
import os
import posixpath
import shutil
import sys
import tempfile
import time
import traceback
from contextlib import contextmanager

try:
    import pytest
except ImportError:
    pytest = None

# The directory we write server tests to, relative to the directory we run pytest in. It matches the
# directory's name in the app's repo (tests/server_tests), so test IDs look like server_tests/test_foo.py::test_bar.
SERVER_TESTS_PATH = "server_tests"

# Server tests need a recent pytest, which needs a recent Python
MIN_PYTHON_VERSION = (3, 10)

OUTCOMES = ["passed", "failed", "error", "skipped", "xfailed", "xpassed"]

STRICT_XPASS_PREFIX = "[XPASS(strict)]"
STRICT_XPASS_MESSAGE = "This test passed, but it is marked as an expected failure with xfail(strict=True)."

# Every text field we send is capped, to keep messages well under the downlink's size limit
MAX_TEXT_LENGTH = 64 * 1024


def _file_path(test_file):
    """The local path of a server test file, relative to server_tests/"""
    path = test_file["path"]
    parts = path.split("/")
    if not all(parts) or any(p in (".", "..") or "\\" in p for p in parts):
        raise ValueError("Invalid server test file path: %r" % path)
    return os.path.join(*parts)


def _write_server_tests(files, directory):
    for test_file in files:
        path = os.path.join(directory, _file_path(test_file))
        if not os.path.isdir(os.path.dirname(path)):
            os.makedirs(os.path.dirname(path))
        with io.open(path, "wb") as f:
            f.write(base64.b64decode(test_file["content"]))


@contextmanager
def server_tests_directory(files):
    """
    Write server test files (base64-encoded, with paths relative to server_tests/) into server_tests/ in a new
    temporary directory.
    Yields the temporary root (the equivalent of the repo's tests/ directory), and deletes it afterwards.
    """
    root = os.path.realpath(tempfile.mkdtemp(prefix="anvil-server-tests-"))
    try:
        tests_dir = os.path.join(root, SERVER_TESTS_PATH)
        os.makedirs(tests_dir)
        _write_server_tests(files, tests_dir)
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


def _truncate(text):
    if text and len(text) > MAX_TEXT_LENGTH:
        return text[:MAX_TEXT_LENGTH] + "\n[...%d characters truncated]" % (len(text) - MAX_TEXT_LENGTH)
    return text


def _strict_xpass_reason(report):
    """
    The xfail reason of a test that passed despite xfail(strict=True), or None for any other report.
    pytest reports this as a failure with no exception, only the text "[XPASS(strict)] <reason>".
    """
    longrepr = report.longrepr
    if report.when == "call" and report.failed and isinstance(longrepr, str) \
            and longrepr.startswith(STRICT_XPASS_PREFIX):
        return longrepr[len(STRICT_XPASS_PREFIX):].strip()
    return None


def _first_line(text):
    for line in (text or "").splitlines():
        if line.strip():
            return line.strip()
    return ""


def _exception_summary(exc):
    """(type, one-line message) for an exception, eg ("ValueError", "ValueError: bad input")"""
    return type(exc).__name__, _first_line(traceback.format_exception_only(type(exc), exc)[-1])


def _traceback_from(exc, path):
    """An exception's formatted traceback, from its first frame in the file at `path`"""
    tb = exc.__traceback__
    while tb is not None and os.path.realpath(tb.tb_frame.f_code.co_filename) != os.path.realpath(path):
        tb = tb.tb_next
    return "".join(traceback.format_exception(type(exc), exc, tb))


def _exit_code_name(exit_code):
    try:
        return pytest.ExitCode(exit_code).name
    except ValueError:
        return None


def _normalize_target(target):
    path, sep, rest = target.partition("::")
    return posixpath.normpath(path) + sep + rest


def _target_matches(target, test_id):
    """Whether a (normalized) test target selects a test (same behavior as pytest's positional args)"""
    if target == ".":
        return True
    return test_id == target or any(test_id.startswith(target + sep) for sep in ("/", "::", "["))


def _hookwrapper(f):
    return pytest.hookimpl(hookwrapper=True)(f) if pytest else f


def _error(message, type=None, traceback=None, **fields):
    error = dict(fields, message=_truncate(message))
    if type:
        error["type"] = type
    if traceback:
        error["traceback"] = _truncate(traceback)
    return error


class ProgressPlugin(object):
    """
    A pytest plugin that reports a run's progress to `emit`, as the test_event payloads described in
    platform/server/docs/SERVER_TESTS_MESSAGES.md: test_run_update, discovered_tests and test_updates.

    pytest collects every test, so we can list them all in discovered_tests.
    Then the run's selection deselects the ones that don't match `test_targets`.
    We apply `test_targets` ourselves, because passing them to pytest would stop it
    collecting all tests.
    """

    def __init__(self, emit, test_targets=None, collect_only=False):
        self._emit = emit
        self._test_targets = test_targets
        self._collect_only = collect_only
        self._config = None
        self._reports = {}
        self._collection_errors = []
        self._discovered = None
        self._selected = None
        self._error = None
        self._start_time = None
        self._running = False
        self.counts = dict.fromkeys(OUTCOMES, 0)
        self.finished = False

    def send(self, type, **fields):
        fields["type"] = type
        self._emit(fields)

    def send_complete(self, exit_code, error=None):
        """Sends the run's complete event, with `error` or the error pytest stopped with"""
        self.finished = True
        error = error or self._error
        if error is None and self._start_time is None:
            error = _error("pytest exited without running tests (%s)" % _exit_code_name(exit_code))
        fields = {"status": "complete",
                  "exit_code": _exit_code_name(exit_code) if exit_code is not None else None,
                  "duration": None if self._start_time is None else time.time() - self._start_time}
        if not self._collect_only:
            fields["counts"] = dict(self.counts)
        if error:
            fields["error"] = error
        self.send("test_run_update", **fields)

    # pytest hooks

    @_hookwrapper
    def pytest_cmdline_parse(self):
        # pytest only calls this for plugins passed to pytest.main. pytest.main prints errors from here instead of
        # raising them, for example a conftest.py that fails to import, and returns USAGE_ERROR
        outcome = yield
        self._record_error(outcome.excinfo)

    @_hookwrapper
    def pytest_cmdline_main(self):
        # This wraps the whole session. pytest.main prints a UsageError from here, for example a keyword expression
        # it can't parse, and returns USAGE_ERROR
        outcome = yield
        self._record_error(outcome.excinfo)

    def pytest_configure(self, config):
        self._config = config

    def pytest_sessionstart(self, session):
        self._start_time = time.time()
        args = list(session.config.invocation_params.args)
        if self._test_targets:
            # Report the args pytest would have been given if it applied the run's test targets itself
            i = args.index(SERVER_TESTS_PATH)
            args[i:i + 1] = self._test_targets
        self.send("test_run_update", status="collecting_tests", pytest_version=pytest.__version__, args=args)

    def pytest_exception_interact(self, call, report):
        # pytest calls this for each failed test phase (after logging its report) and each failed
        # collection (before logging its report). It's the only place the exception is available.
        exc = call.excinfo.value
        cause = getattr(exc, "__cause__", None)
        if type(exc).__name__ == "CollectError" and isinstance(cause, Exception):
            # pytest wraps import and syntax errors in a test module; report the original
            report._anvil_exception = _exception_summary(cause)
        else:
            report._anvil_exception = (call.excinfo.typename, _first_line(call.excinfo.exconly(tryshort=True)))

    def pytest_collectreport(self, report):
        if report.failed:
            self.counts["error"] += 1
            self._collection_errors.append(self._report_error(report, file_path=report.nodeid.split("::")[0]))

    @_hookwrapper
    def pytest_collection_modifyitems(self, session, config, items):
        # This wraps every other plugin's pytest_collection_modifyitems, so it sees every test before any are
        # deselected, and the run's tests after
        self._discovered = list(items)
        if self._test_targets and not self._collection_errors:
            self._deselect_by_targets(config, items)
        outcome = yield
        if outcome.excinfo is None:
            self._selected = list(items)

    def pytest_collection_finish(self, session):
        if self._collection_errors:
            # pytest will stop without running anything, so the run's tests are unknown
            self.send("test_run_update", collection_errors=self._collection_errors)
            return
        if self._discovered is None:
            return

        tests = []
        for item in self._discovered:
            path, lineno, name = item.location
            tests.append({"test_id": item.nodeid, "file_path": path,
                          "line": None if lineno is None else lineno + 1, "name": name})
        self.send("discovered_tests", tests=tests)
        # If selecting the tests failed, pytest stops without running any
        if self._selected is not None and not self._collect_only:
            self.send("test_updates", tests=[{"test_id": item.nodeid, "result": {"status": "pending"}}
                                             for item in self._selected])

    def pytest_runtest_logstart(self, nodeid, location):
        if not self._running:
            self._running = True
            self.send("test_run_update", status="running_tests")
        self._reports[nodeid] = []
        self.send("test_updates", tests=[{"test_id": nodeid, "result": {"status": "running"}}])

    def pytest_runtest_logreport(self, report):
        self._reports.setdefault(report.nodeid, []).append(report)

    def pytest_runtest_logfinish(self, nodeid, location):
        reports = self._reports.pop(nodeid, [])
        outcome = self._outcome(reports)
        self.counts[outcome] += 1

        result = {"status": "finished", "outcome": outcome, "duration": sum(r.duration for r in reports)}
        errors = [self._report_error(r, phase=r.when) for r in reports if r.failed]
        if errors:
            result["errors"] = errors
        reason = self._reason(reports)
        if reason:
            result["reason"] = _truncate(reason)
        if reports:
            # Each phase's report includes the captured output of the phases before it
            last = reports[-1]
            for key, text in [("stdout", last.capstdout), ("stderr", last.capstderr), ("log", last.caplog)]:
                if text:
                    result[key] = _truncate(text)
        self.send("test_updates", tests=[{"test_id": nodeid, "result": result}])

    def pytest_internalerror(self, excrepr, excinfo):
        # pytest calls this for an exception outside any test or collect report, for example from an unknown hook
        # in conftest.py. It then ends the session with INTERNAL_ERROR.
        if self._error is None:
            exception_type, message = _exception_summary(excinfo.value)
            self._error = _error(message, type=exception_type, traceback=str(excrepr))

    # Helpers

    def _record_error(self, excinfo):
        """Records the error from a pytest.main phase that failed, if it's one pytest.main only prints"""
        exc = excinfo and excinfo[1]
        if exc is None or self._error is not None:
            return
        if isinstance(exc, pytest.UsageError):
            self._error = _error(str(exc))
        elif type(exc).__name__ == "ConftestImportFailure" and isinstance(exc.__cause__, Exception):
            # The original error, eg a SyntaxError. The path is relative to the directory pytest runs in.
            cause, path = exc.__cause__, str(exc.path)
            exception_type, message = _exception_summary(cause)
            self._error = _error("%s: %s" % (os.path.relpath(path), message), type=exception_type,
                                 traceback=_traceback_from(cause, path))

    def _deselect_by_targets(self, config, items):
        """Deselects the tests that none of the run's test targets select, with pytest's errors for bad targets"""
        targets = [_normalize_target(t) for t in self._test_targets]
        for original, target in zip(self._test_targets, targets):
            if not os.path.exists(os.path.join(str(config.rootpath), target.partition("::")[0])):
                raise pytest.UsageError("file or directory not found: %s" % original)
            if "::" in target and not any(_target_matches(target, item.nodeid) for item in items):
                raise pytest.UsageError("Test not found: %s" % original)

        selected, deselected = [], []
        for item in items:
            (selected if any(_target_matches(t, item.nodeid) for t in targets) else deselected).append(item)
        if deselected:
            config.hook.pytest_deselected(items=deselected)
            items[:] = selected

    @staticmethod
    def _report_error(report, **fields):
        if _strict_xpass_reason(report) is not None:
            return _error(STRICT_XPASS_MESSAGE, **fields)
        exception_type, message = getattr(report, "_anvil_exception", (None, None))
        if not message:
            # No exception
            crash = getattr(report.longrepr, "reprcrash", None)
            message = _first_line(crash.message if crash else report.longreprtext)
        return _error(message, type=exception_type, traceback=report.longreprtext, **fields)

    def _category(self, report):
        # The same classification pytest's terminal summary uses ("" for a passing setup/teardown)
        return self._config.hook.pytest_report_teststatus(report=report, config=self._config)[0]

    def _outcome(self, reports):
        by_phase = dict((r.when, self._category(r)) for r in reports)
        outcome = by_phase.get("call") or by_phase.get("setup") or "passed"
        if by_phase.get("teardown") == "error" and outcome == "passed":
            outcome = "error"
        return outcome

    @staticmethod
    def _reason(reports):
        for r in reports:
            if getattr(r, "wasxfail", None):
                return r.wasxfail
            xpass_reason = _strict_xpass_reason(r)
            if xpass_reason:
                return xpass_reason
            if r.skipped and isinstance(r.longrepr, tuple):
                reason = r.longrepr[2]
                return reason[len("Skipped: "):] if reason.startswith("Skipped: ") else reason


def run_server_tests(files, emit, selection=None, collect_only=False):
    """
    Run an app's server tests with pytest, and return pytest's exit code.
    `selection` is the run's {test_targets, keyword_expression}, if it doesn't include every test. If `collect_only`
    is set, pytest lists the tests without running them.
    Progress goes to `emit`, as test_event payloads (see ProgressPlugin). pytest's terminal output goes to
    stdout, which the worker forwards as ordinary task output.
    """
    selection = selection or {}
    plugin = ProgressPlugin(emit, test_targets=selection.get("test_targets"), collect_only=collect_only)
    message = None
    if sys.version_info < MIN_PYTHON_VERSION:
        message = "Server tests need Python %d.%d or later. This server environment uses Python %d.%d." % (
            MIN_PYTHON_VERSION + tuple(sys.version_info[:2]))
    elif pytest is None:
        message = "pytest is not installed in this server environment. Add pytest to your app's test requirements."
    if message:
        plugin.send_complete(None, error=_error(message))
        raise Exception(message)

    try:
        with server_tests_directory(files) as root:
            old_cwd = os.getcwd()
            old_stderr = sys.stderr
            os.chdir(root)
            # pytest writes usage errors to stderr. Send them wherever its terminal output goes.
            sys.stderr = sys.stdout
            args = [SERVER_TESTS_PATH, "--rootdir", root]
            if selection.get("keyword_expression"):
                args += ["-k", selection["keyword_expression"]]
            if collect_only:
                args += ["--collect-only"]
            try:
                exit_code = int(pytest.main(args, plugins=[plugin]))
            finally:
                sys.stderr = old_stderr
                os.chdir(old_cwd)
        plugin.send_complete(exit_code)
        return exit_code
    except Exception as e:
        if not plugin.finished:
            exception_type, message = _exception_summary(e)
            plugin.send_complete(None, error=_error(message, type=exception_type, traceback=traceback.format_exc()))
        raise
