from __future__ import absolute_import
import ast, sys, importlib, time

# The downlink may need to coexist with the Uplink (for example in the standalone App Server).
# In these deployments, the downlink's version of the 'anvil' module is shipped as
# anvil_downlink_worker.anvil, and so we do some path gymnastics to load it from there:
old_path = sys.path
sys.path = __path__ + sys.path
import anvil
sys.path = old_path

import anvil.server
from anvil import _server, _serialise, _threaded_server, _form_templating
try:
    from anvil import _debugger
except ImportError:
    _debugger = None

if sys.version_info[0] < 3:
    from .exec2 import do_exec
else:
    from .exec3 import do_exec

_server._do_call = _threaded_server.do_call
_serialise.holding_reqresps = True # Don't do anything until we've loaded apps

ModuleType = type(sys)


def find(lst, f):
    for item in lst:
        if f(item):
            return item


def find_in_app(app, mod_name):
    return find(app.get('server_modules', []), lambda m: m['name'] == mod_name) or \
           find(app.get('modules', []), lambda m: m['name'] == mod_name)


class ErrorLoadingUserCode(Exception):
    def __init__(self, exc):
        self.exc = exc
        Exception.__init__(self, "Error loading user code: " + str(exc))


# Our jobs:
#
# 1. Assemble a virtual filesystem corresponding to an app's source code
# 2. (for Python 3 back-compatibility:) Intercept requests to import top-level modules in the main app,
#    and instead load the module in its main-app package, then alias it into sys.modules
#
class SimpleLoader(object):
    def __init__(self, module, real_name=None):
        self._module = module
        self._real_name = real_name

    def load_module(self, name):
        #print("Loading: " + name)
        if name in sys.modules:
            return sys.modules[name]

        real_name = self._real_name or name

        if real_name in sys.modules:
            sys.modules[name] = sys.modules[real_name]
            return sys.modules[name]

        # convert to str here to avoid unicode error in python 2
        mod = self._module.get("module_object") or ModuleType(str(real_name))
        sys.modules[real_name] = mod
        # Grungy horrid double-loading hack for Python 3
        if name != real_name:
            sys.modules[name] = mod

        if self._module.get('is_package'):
            mod.__path__ = []

        if 'code' in self._module:
            try:
                do_exec(compile(self._module['code'], real_name.replace(".", "/") + '.py', 'exec'), mod.__dict__)
            except ErrorLoadingUserCode as e:
                raise
            except Exception as e:
                raise ErrorLoadingUserCode(e)

        # Belt and braces? (honestly not sure about this -M)
        sys.modules[name] = mod

        return mod


def mk_script_fn(script_name, script_code):
    def run_script(*args):
        if not all(type(arg) is str for arg in args):
            raise ValueError("Only string arguments can be passed to scripts")
        old_argv = sys.argv
        sys.argv = args
        try:
            do_exec(compile(script_code, script_name + ".py", 'exec'), {"__name__": "__main__"})
        finally:
            sys.argv = old_argv
    return run_script


class AppModuleFinder(object):

    def __init__(self):
        self._app = None
        self._modules = {}
        self._main_package = ''

    def _load_mods(self, app_spec, prefix=''):
        for module in app_spec.get('modules', []) + app_spec.get('server_modules', []):
            self._modules[prefix + module['name']] = module

        for form in app_spec.get('forms', []):
            self._modules[prefix + form['class_name']] = form

            runtime_version = app_spec.get('runtime_options', {}).get('version', 0)
            if runtime_version < 2:
                template_mod = sys.modules['anvil']
            else:
                modname = prefix + form['class_name']
                if not form.get('is_package'):
                    modname = ".".join(modname.split(".")[:-1])
                modname += "._anvil_designer"
                if modname in self._modules:
                    template_mod = self._modules[modname]['module_object']
                else:
                    # convert to str here to avoid unicode error in python 2
                    template_mod = ModuleType(str(modname))
                    self._modules[modname] = {'module_object': template_mod}

            leaf_name = form['class_name'].split(".")[-1]
            if runtime_version < 3:
                # TODO: Decide whether we want this in runtime V3. Right now it explodes on forms without containers.
                setattr(template_mod, leaf_name+"Template", _form_templating.mk_template_class(form))


    def set_app(self, app_spec):
        self._app = app_spec
        self._main_package = app_spec.get('package_name', 'main_app_package')
        _form_templating.packages_by_app_id[''] = self._main_package

        deps = self._app.get('dependency_code', {})
        for dep_id in deps:
            dep = deps[dep_id]
            if 'package_name' in dep:
                _form_templating.packages_by_app_id[dep_id] = dep['package_name']
                self._modules[dep['package_name']] = {'is_package': True}
                self._load_mods(dep, dep['package_name']+".")

        self._modules[self._main_package] = {'is_package': True}
        self._load_mods(self._app, self._main_package+".")

    def get_main_package(self):
        return self._main_package

    def find_module(self, name, path=None):
        #print("Finding: " + name)
        #print(list(self._modules))
        mod = self._modules.get(name)
        if mod is not None:
            return SimpleLoader(mod)

        # Hack: Intercept top-level import requests

        #print("Initial miss on %s, trying %s" % (name, self._main_package+"."+name))
        mod = self._modules.get(self._main_package+"."+name)
        if mod is not None:
            return SimpleLoader(mod, self._main_package+"."+name)
    
    def find_spec(self, name, path=None, target=None):
        from importlib.util import spec_from_loader
        loader = self.find_module(name, path)
        if loader is not None:
            return spec_from_loader(name, loader)

    def app_is_loaded(self):
        return self._app is not None

    def get_scripts(self):
        return [(s['name'], s['code']) for s in self._app.get("scripts", [])]


module_finder = AppModuleFinder()
sys.meta_path.append(module_finder)

modules_to_import = []


def load_app(app):
    global modules_to_import

    module_finder.set_app(app)

    app_package = module_finder.get_main_package()
    modules_to_import = [app_package + "." + m['name'] for m in app.get("server_modules", [])]

    deps = app.get('dependency_code', {})
    for dep_app in deps.values():
        if "package_name" in dep_app:
            modules_to_import += [dep_app["package_name"] + "." + m['name'] for m in dep_app.get("server_modules", [])]

    # We have our app now. Anyone who's waiting should go ahead and execute.
    _serialise.release_reqresps()


_initial_import_done = False


def load_app_modules():
    """Call from _threaded_server when the environment is ready to import all server modules in this app"""
    global _initial_import_done
    if _initial_import_done: return

    start_import = time.time()
    try:
        for n in modules_to_import:
            importlib.import_module(n)
    except ErrorLoadingUserCode as e:
        raise e.exc

    for name, code in module_finder.get_scripts():
        anvil.server.background_task("script:"+name)(mk_script_fn(name, code))

    _initial_import_done = True
    end_import = time.time()
    return int((end_import - start_import) * 1000)


repl_scopes = {}


def run_repl(code, scope):
    module_ast = ast.parse(code, "<input>", "exec")
    node_list = module_ast.body

    if not node_list:
        return

    if isinstance(node_list[-1], ast.Expr):
        to_run_exec, to_run_interactive = node_list[:-1], node_list[-1:]
    else:
        to_run_exec, to_run_interactive = node_list, []

    if to_run_exec:
        cobj = compile(ast.Module(to_run_exec, type_ignores=[]), "<input>", "exec")
        do_exec(cobj, scope)
    if to_run_interactive:
        cobj = compile(ast.Interactive(to_run_interactive), "<input>", "single")
        do_exec(cobj, scope)


def handle_incoming_call(msg, send_to_host):
    if msg['type'].startswith("LAUNCH_BACKGROUND"):
        anvil.server.task_state = {}

    if not module_finder.app_is_loaded():
        if msg.get('app'):
            load_app(msg['app'])
        else:
            send_to_host({"type": "GET_APP", "id": _threaded_server.gen_id(), "originating-call": msg['id'],
                          "app-id": msg["app-id"], "app-version": msg["app-version"]})

    # This part happens out here because uplinks can't do REPLs:
    run_fn = None
    if msg['type'] == "LAUNCH_REPL":
        def run_fn():
            send_to_host({'output': "Application loaded\n", 'id': msg['id']})
            raise _threaded_server.SendNoResponse

    elif msg["type"] == "REPL_COMMAND":
        # adding __package__ allows relative imports to work in the repl
        # we add the repl scope now if it doesn't exist
        # since we don't have the package name when we launch the repl
        # for convenience we include anvil (which also adds anvil.server)
        scope = repl_scopes.setdefault(
            msg["repl"], {"anvil": anvil, "__package__": module_finder.get_main_package() or None}
        )

        def run_fn():
            run_repl(msg['command'], scope)

    elif msg['type'] == "TERMINATE_REPL":
        repl_scopes.pop(msg['repl'], None)
        send_to_host({"id": msg['repl'], "response": None})
        send_to_host({"id": msg['id'], "response": None})
        return

    elif msg['type'] == "DEBUG_REQUEST":
        if _debugger:
            response = _debugger.handle_debug_request(msg, file_prefix=module_finder.get_main_package()+"/")
        else:
            response = {"error": "Debugger not found"}

        response["id"] = msg['id']
        send_to_host(response)
        return

    try:
        _threaded_server.IncomingRequest(msg, load_app_modules,
                                         get_file_prefix=lambda: module_finder.get_main_package()+"/",
                                         run_fn=run_fn,
                                         dump_task_state=(msg['type'].startswith("LAUNCH_BACKGROUND")))
    except:
        send_to_host(_server._report_exception(msg['id']))
