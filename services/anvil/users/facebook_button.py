import anvil
import anvil.js
import anvil.server


origin = anvil.server.get_app_origin() or ""


class FacebookSignInButton(anvil.HtmlTemplate):
    _loaded = False
    # if you update this sha, then also update runtime/services/anvil/facebook/auth.js
    _path = (
        origin
        + "/_/static/runtime/img/facebook-signin-buttons/btn.js?sha=e0f560cd9d9b7bca9214"
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

    def __init__(self, text="Sign in with Facebook"):
        self.load_component()
        anvil.HtmlTemplate.__init__(self, html="<facebook-signin-button>" + text)
