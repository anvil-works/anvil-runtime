import anvil.server
from anvil import *
from ..exceptions import AuthenticationFailed
from ..config import get_client_config

#!defFunction(anvil.users,_,email_address)!2: "Send a two-factor authentication reset email to the specified user." ["send_mfa_reset_email"]
def send_mfa_reset_email(email):
    anvil.server.call("anvil.private.users.send_mfa_reset_email", email)
if is_server_side():
    pass
else:
    from . import webauthn

    #!defFunction(anvil.users.mfa,_,email_address)!2: "Generate a WebAuthn challenge that can be used to register a new hardware token for two-factor authentication." ["create_fido_mfa_method"]
    def create_fido_mfa_method(email):
        opts = anvil.server.call("anvil.private.users.begin_fido_attestation", email)
        result = webauthn.create(opts)
        if result:
            return anvil.server.call("anvil.private.users.validate_fido_attestation", result)

    #!defFunction(anvil.users.mfa,_,email_address,password)!2: "Generate a WebAuthn challenge that the given user can use to log in with a previously registered hardware token." ["get_fido_mfa_login"]
    def get_fido_mfa_login(email, password):
        opts = anvil.server.call("anvil.private.users.begin_fido_assertion", email, password)
        result = webauthn.get(opts)
        if result:
            return {"type": 'fido', "result": result}

    #!defFunction(anvil.users.mfa,_,code)!2: "Get an MFA login object representing a TOTP login code. This can be passed to the login_with_email function as the mfa argument." ["get_totp_mfa_login"]
    def get_totp_mfa_login(code):
        return {"type": "totp", "code": code}

    #!defFunction(anvil.users.mfa,_,email_address)!2: "Generate a TOTP secret that can be added as two-factor authentication for the current user." ["generate_totp_secret"]
    def generate_totp_secret(email):
        return anvil.server.call("anvil.private.users.totp.generate_secret", email)

    #!defFunction(anvil.users.mfa,_,mfa_method,code)!2: "Validate the given TOTP code against the given MFA method from a User row." ["validate_totp_code"]
    def validate_totp_code(mfa_method, code):
        return anvil.server.call("anvil.private.users.totp.validate_code", mfa_method, code)

    #!defFunction(anvil.users.mfa,_,password,mfa_method,[clear_existing=False])!2: "Add an MFA method to the current user by passing the user's password and the mfa method, optionally clearing all existing methods." ["add_mfa_method"]
    def add_mfa_method(password, method, clear_existing=False):
        return anvil.server.call("anvil.private.users.add_mfa_method", password, method, clear_existing)

    #!defFunction(anvil.users.mfa,_,email_address,password)!2: "Get the available MFA types for the given user by passing their email and password." ["get_available_mfa_types"]
    def get_available_mfa_types(email, password):
        return anvil.server.call("anvil.private.users.get_available_mfa_types", email, password)

    def _configure_mfa(email, mfa_error, require_password, allow_cancel, confirm_button_text):
        totp_config = generate_totp_secret(email)
        totp_secret = totp_config['secret']
        qr_code = totp_config['qr_code']
        mfa_methods = {
            'totp': totp_config['mfa_method'],
        }

        while True:

            mfa_panel = LinearPanel()
            mfa_panel.add_component(Label(text="This app requires 2-factor authentication to log in."))

            def signup_with_fido(**e):
                result = create_fido_mfa_method(email)
                if result:
                    mfa_methods['fido'] = result
                    mfa_panel.raise_event("x-close-alert", value='fido')

            if webauthn.is_webauthn_available():
                fido_link = Link(text="Use hardware token",icon="fa:lock")
                fido_link.set_event_handler("click", signup_with_fido)
                mfa_panel.add_component(fido_link)
            else:
                mfa_panel.add_component(Label(text="Hardware token unavailable", icon="fa:lock", tooltip="Is this page running in an iframe or an unsupported browser?"))

            mfa_panel.add_component(Label(text="Alternatively, scan this QR-code with your Authenticator app and then enter the current code below to continue."))
            mfa_panel.add_component(Image(source=qr_code, display_mode="fill_width"))

            totp_box = TextBox(placeholder="Enter 6-digit code", align="center", font="monospace")
            totp_box.set_event_handler("pressed_enter", lambda **e: mfa_panel.raise_event("x-close-alert", value='totp'))

            password_box = TextBox(placeholder="Current password", align="center", hide_text=True)
            password_box.set_event_handler("show", lambda **e: password_box.focus())
            password_box.set_event_handler("pressed_enter", lambda **e: totp_box.focus())

            if require_password:
                mfa_panel.add_component(password_box)
                password_box.set_event_handler("show", lambda **e: password_box.focus())
            else:
                totp_box.set_event_handler("show", lambda **e: totp_box.focus())

            mfa_panel.add_component(totp_box)



            if mfa_error:
                mfa_panel.add_component(Label(foreground="red", bold=True, spacing_below="none", text=mfa_error))

            maybe_cancel_button = [("Cancel", None)] if allow_cancel else []
            mfa = alert(mfa_panel, title="2-Factor Authentication", buttons=[(confirm_button_text, 'totp', 'success')] + maybe_cancel_button, dismissible=bool(allow_cancel))
            if mfa == 'totp': 
                if validate_totp_code(mfa_methods['totp'], totp_box.text):
                    return mfa_methods['totp'], password_box.text
                else:
                    mfa_error = "Incorrect code entered. Please try again."
                    continue
            elif mfa == 'fido':
                return mfa_methods['fido'], password_box.text
            else:
                return None, ""


    #!defFunction(anvil.users.mfa,!,email_address, password)!2: "Display a form to collect two-factor authentication credentials from the user currently logging in by passing the function their email and password." ["mfa_login_with_form"]
    def mfa_login_with_form(email, password):
        mfa_panel = LinearPanel()

        mfa_types = get_available_mfa_types(email, password)

        maybe_login_button = []
        
        if 'totp' in mfa_types:
            totp_box = TextBox(placeholder="Enter 6-digit code", align="center", font="monospace")
            totp_box.set_event_handler("pressed_enter", lambda **e: mfa_panel.raise_event('x-close-alert', value=get_totp_mfa_login(totp_box.text)))
            totp_box.set_event_handler("show", lambda **e: totp_box.focus())
            mfa_panel.add_component(Label(text="Please enter the 2-factor authentication code from your Authenticator app"))
            mfa_panel.add_component(totp_box)
            maybe_login_button = [("Log In", 'totp', 'success')]

        if 'fido' in mfa_types:
            def use_fido(**e):
                val = get_fido_mfa_login(email, password)
                if val:
                    mfa_panel.raise_event("x-close-alert", value=val)

            
            if webauthn.is_webauthn_available():
                fido_link = Link(text="Use hardware token", icon="fa:lock")
                fido_link.set_event_handler("click", use_fido)
                mfa_panel.add_component(fido_link)
            else:
                mfa_panel.add_component(Label(text="Hardware token unavailable", icon="fa:lock", tooltip="Is this page running in an iframe or an unsupported browser?"))


        if not mfa_types:
            mfa_panel.add_component(Label(text="No authentication methods available."))

        if not mfa_types or get_client_config().get("allow_mfa_email_reset", False):
            mfa_reset_link = Link(text="Reset 2-factor authentication by email")
            mfa_reset_link.set_event_handler('click', lambda **e: mfa_panel.raise_event('x-close-alert', value='reset_mfa'))
            mfa_panel.add_component(mfa_reset_link)

        r = alert(mfa_panel, title="2-Factor Authentication", buttons=maybe_login_button + [("Cancel", None, 'default')], dismissible=False)

        if r == 'totp':
            return get_totp_mfa_login(totp_box.text)
        else:
            return r


    #!defFunction(anvil.users.mfa,!,[allow_cancel=False])!2: "Display a form for the user to configure 2-factor authentication.\n\nallow_cancel: if True, the signup form has a Cancel button that the user can use to dismiss the form." ["configure_mfa_with_form"]
    def configure_mfa_with_form(allow_cancel=False):

        error = None
        while True:
            mfa_method, password = _configure_mfa(None, error, True, allow_cancel, "Save")

            if mfa_method:
                try:
                    add_mfa_method(password, mfa_method)
                    alert("Your two-factor authentication configuration has been reset.")
                    return True
                except AuthenticationFailed as e:
                    error = e.args[0]
                except Exception as e:
                    error = str(e)
            else:
                return None
