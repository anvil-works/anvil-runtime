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

#!defFunction(anvil.pdf,%anvil.Media instance,form_name,*args,**kwargs)!2:
# {
#   $doc: "Render an Anvil form to PDF. Pass the name of the form you want to render, plus any arguments you want to pass to its constructor.\n\nReturns a PDF as an Anvil Media object.",
#   anvil$helpLink: "/docs/working-with-files/creating-pdf-files"
# } ["render_form"]
def render_form(*args, **kwargs):
    return _real_component_to_pdf({}, args, kwargs)


form_to_pdf = render_form


class PDFRenderer(object):
#!defMethod(_,[filename="print.pdf"],[landscape=False],[margins=],[page_size="letter"],[quality="default"],[scale=1.0])!2:
# {
#   $doc: "Configure options for PDF rendering. Returns an object with a render_form() method.",
#   anvil$helpLink: "/docs/media/creating_pdfs",
#   anvil$args: {
#     filename: "The name of the generated PDF file.",
#     landscape: "Generate a PDF in landscape orientation.",
#     margins: "Page margins (in centimetres), as a dictionary specifying margins on each side (eg {'top': 1.0, 'bottom': 1.0, 'left': 1.0, 'right': 1.0}) or as a number specifying a global margin. The default value is 1.0", 
#     page_size: "Can be the name of a standard page size ('letter' or 'A0'-'A10'), or a tuple of (width, height) in centimetres.",
#     quality: "The quality of the generated PDF, which has a large impact on file size. Available values are: \n - 'original': All images will be embedded at original resolution. Output file can be very large. \n - 'screen': Low-resolution output similar to the Acrobat Distiller 'Screen Optimized' setting. \n - 'printer': Output similar to the Acrobat Distiller 'Print Optimized' setting. \n - 'prepress': Output similar to Acrobat Distiller 'Prepress Optimized' setting. \n - 'default': Output intended to be useful across a wide variety of uses, possibly at the expense of a larger output file.", 
#     scale: "The scale (zoom level) at which you are printing. The default value is 1.0.",
#   }
# } ["__init__"]
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
