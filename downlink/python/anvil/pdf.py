import anvil.server
import anvil._threaded_server
from random import SystemRandom

_components = {}


def _mkstr(length):
    sr = SystemRandom()
    return "".join((sr.choice("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890") for i in range(length)))


def _real_component_to_pdf(options, component_args, component_kwargs):
    key = _mkstr(20)
    _components[key] = (component_args, component_kwargs)
    try:
        return anvil.server.call("anvil.private.pdf.do_print", [anvil._threaded_server.call_info.call_id, key], options)
    finally:
        del _components[key]


@anvil.server.callable('anvil.private.pdf.component_to_pdf')
def _component_to_pdf(options, component_args, component_kwargs):
    if not anvil.server.context.remote_caller.is_trusted:
        raise Exception("Can only generate PDFs from server code")
    return _real_component_to_pdf(options, component_args, component_kwargs)

#!defFunction(anvil.pdf,%anvil.Media instance,form_name,*args,**kwargs)!2: "Render an Anvil form to PDF. Pass the name of the form you want to render, plus any arguments you want to pass to its constructor.\n\nReturns a PDF as an Anvil Media object." ["render_form"]
def render_form(*args, **kwargs):
    return _real_component_to_pdf({}, args, kwargs)


form_to_pdf = render_form


class PDFRenderer(object):
    #!defMethod(_,[filename="print.pdf"],[landscape=False],[margins=],[page_size="letter"],[quality="default"],[scale=1.0])!2: "Configure options for PDF rendering. Returns an object with a render_form() method." ["__init__"]
    def __init__(self, **kwargs):
        self.options = kwargs

    #!defMethod(anvil.Media instance,form_name,*args,**kwargs)!2: "Render an Anvil form to PDF. Pass the name of the form you want to render, plus any arguments you want to pass to its constructor.\n\nReturns a PDF as an Anvil Media object." ["render_form"]
    def render_form(self, *args, **kwargs):
        return _real_component_to_pdf(self.options, args, kwargs)
#!defClass(anvil.pdf,%PDFRenderer)!0:


@anvil.server.callable('anvil.private.pdf.get_component')
def _get_component(pk):
    _, print_key = pk
    return _components[print_key]
