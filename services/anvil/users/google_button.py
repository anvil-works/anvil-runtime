import anvil
import anvil.js
import anvil.server


origin = anvil.server.get_app_origin() or ""


class GoogleSignInButton(anvil.HtmlTemplate):
    _loaded = False
    _path = (
        origin
        + "/_/static/runtime/img/google-signin-buttons/btn.js?sha=277762afd28c6a94830"
    )

    @classmethod
    def load_component(cls):
        if cls._loaded:
            return
        cls._loaded = True
        document = anvil.js.window.document
        s = document.createElement("script")
        s.src = cls._path
        document.head.append(s)

    def __init__(self, text="Sign in with Google"):
        self.load_component()
        anvil.HtmlTemplate.__init__(self, html="<google-signin-button>" + text)
