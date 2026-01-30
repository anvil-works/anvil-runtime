import anvil
import anvil.js
import anvil.server


origin = anvil.server.get_app_origin() or ""


class MicrosoftSignInButton(anvil.HtmlTemplate):
    _loaded = False
    # if you update this sha, then also update runtime/services/anvil/microsoft/auth.js
    _path = (
        origin
        + "/_/static/runtime/img/microsoft-signin-buttons/btn.js?sha=571f3e80eba45f5901fc"
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

    def __init__(self, text="Sign in with Microsoft"):
        self.load_component()
        anvil.HtmlTemplate.__init__(self, html="<microsoft-signin-button>" + text)
