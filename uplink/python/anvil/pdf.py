import anvil.server

def render_form(*args, **kwargs):
    return anvil.server.call("anvil.private.pdf.component_to_pdf", {}, args, kwargs)


form_to_pdf = render_form


class PdfRenderer(object):
    def __init__(self, **kwargs):
        self.options = kwargs

    def render_form(self, *args, **kwargs):
        return anvil.server.call("anvil.private.pdf.component_to_pdf", self.options, args, kwargs)
