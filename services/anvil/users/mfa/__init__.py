import anvil.server
from anvil import *
from ..exceptions import AuthenticationFailed, MFAException
from ..config import get_client_config
from anvil.js import window


def _replace(s, pattern, replacement):
    return window.String.prototype.replace.call(s, window.RegExp(pattern, "g"), replacement)


class PhoneNumberValidator(object):
    def __init__(self):
        self.box = pluggable_ui['anvil.TextBox'](type="tel")
        self.valid_number = None
        self.box.add_event_handler("focus", self.on_focus)
        self.box.add_event_handler("lost_focus", self.on_blur)
        self.box.add_event_handler("pressed_enter", self.on_blur)

    def on_focus(self, **e):
        if hasattr(self.box, "placeholder"):
            self.box.placeholder = "(123) 456 7890" if window.navigator.language == "en-US" else "+1 000 0..."

    def on_blur(self, **e):
        self.validate()

    def validate(self):
        leadingPlus = self.box.text.startswith("+")
        text = self.box.text = _replace(self.box.text, "[^0-9]", "")
        if leadingPlus:
            if len(text) > 3: # What's a valid minimum length?
                self.box.text = "+" + text
                self.valid_number = text
            else:
                self.valid_number = None
        else:
            if len(text) == 10:
                self.valid_number = "+1" + text
                self.box.text = "(" + text[0:3] + ") " + text[3:6] + " " + text[6:]
            else:
                self.valid_number = None
        


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

    #!defFunction(anvil.users.mfa,_,code)!2: "Get an MFA login object representing a Twilio Verify token. This can be passed to the login_with_email function as the mfa argument." ["get_twilio_mfa_login"]
    def get_twilio_mfa_login(code):
        return {"type": "twilio-verify", "code": code}

    #!defFunction(anvil.users.mfa,_,email_address)!2: "Generate a TOTP secret that can be added as two-factor authentication for the current user." ["generate_totp_secret"]
    def generate_totp_secret(email):
        return anvil.server.call("anvil.private.users.totp.generate_secret", email)

    #!defFunction(anvil.users.mfa,_,mfa_method,code)!2: "Validate the given TOTP code against the given MFA method from a User row." ["validate_totp_code"]
    def validate_totp_code(mfa_method, code):
        return anvil.server.call("anvil.private.users.totp.validate_code", mfa_method, code)

    #!defFunction(anvil.users.mfa,_,phone)!2: "Generate a Twilio MFA method from the provided phone number." ["generate_twilio_mfa_method"]
    def generate_twilio_mfa_method(phone):
        return anvil.server.call("anvil.private.users.twilio.generate_mfa_method", phone)

    #!defFunction(anvil.users.mfa,_, mfa_method, channel)!2: "Send a Twilio Verify token using the given MFA method from a User row." ["send_twilio_token"]
    def send_twilio_token(mfa_method, channel):
        return anvil.server.call("anvil.private.users.twilio.send_verification_token", mfa_method, channel)

    #!defFunction(anvil.users.mfa,_, mfa_method, token)!2: "Validate the given Twilio Verify token against the given MFA method from a User row." ["check_twilio_token"]
    def check_twilio_token(mfa_method, token):
        return anvil.server.call("anvil.private.users.twilio.check_verification_token", mfa_method, token)

    #!defFunction(anvil.users.mfa,_,password,mfa_method,[clear_existing=False])!2: "Add an MFA method to the current user by passing the user's password and the mfa method, optionally clearing all existing methods." ["add_mfa_method"]
    def add_mfa_method(password, method, clear_existing=False):
        return anvil.server.call("anvil.private.users.add_mfa_method", password, method, clear_existing)

    #!defFunction(anvil.users.mfa,_,email_address,password)!2: "Get the available MFA types for the given user by passing their email and password." ["get_available_mfa_types"]
    def get_available_mfa_types(email, password):
        return anvil.server.call("anvil.private.users.get_available_mfa_types", email, password)

    #!defFunction(anvil.users.mfa,_)!2: "Get all the enabled MFA types for this app." ["get_enabled_mfa_types"]
    def get_enabled_mfa_types():
        return anvil.server.call("anvil.private.users.get_enabled_mfa_types")

    def _configure_mfa(email, mfa_error, require_password, allow_cancel, confirm_button_text):
        TextBox = pluggable_ui['anvil.TextBox']
        
        mfa_types = get_enabled_mfa_types()
        selected_mfa_type = None
        mfa_methods = {}
        password_error = None
        password_box = TextBox(placeholder="Current password", align="center", hide_text=True)

        while True:
            mfa_panel = LinearPanel()

            if require_password and not password_box.text:
                password_box.remove_from_parent()
                mfa_panel.add_component(password_box)
                if password_error:
                    mfa_panel.add_component(Label(foreground="red", align="center", spacing_below="none", text=password_error))

            if not selected_mfa_type:

                mfa_panel.add_component(Label(text="This app requires 2-factor authentication to log in."))


                if "fido" in mfa_types:
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

                if "totp" in mfa_types:
                    totp_link = Link(text="Use Authenticator app", icon="fa:qrcode")
                    totp_link.set_event_handler("click", lambda **e: mfa_panel.raise_event("x-close-alert", value='select-totp'))
                    mfa_panel.add_component(totp_link)

                if "twilio-verify" in mfa_types:
                    twilio_link = Link(text="Use phone number", icon="fa:phone")
                    twilio_link.set_event_handler("click", lambda **e: mfa_panel.raise_event("x-close-alert", value='select-twilio'))
                    mfa_panel.add_component(twilio_link)

            else:
                back_link = Link(text="Choose another method", icon="fa:arrow-left")
                back_link.set_event_handler("click", lambda **e: mfa_panel.raise_event("x-close-alert", value='back'))
                mfa_panel.add_component(back_link)

                if selected_mfa_type == "totp":
                    totp_config = generate_totp_secret(email)
                    totp_secret = totp_config['secret']
                    qr_code = totp_config['qr_code']
                    mfa_methods['totp'] = totp_config['mfa_method']

                    mfa_panel.add_component(Label(text="Scan this QR-code with your Authenticator app and then enter the current code below to continue."))
                    mfa_panel.add_component(Image(source=qr_code, display_mode="fill_width"))

                    totp_box = TextBox(placeholder="Enter 6-digit code", align="center", font="monospace")
                    totp_box.set_event_handler("show", lambda **e: totp_box.focus())
                    totp_box.set_event_handler("pressed_enter", lambda **e: mfa_panel.raise_event("x-close-alert"))
                    mfa_panel.add_component(totp_box)

                elif selected_mfa_type == "twilio-verify":
                    if not mfa_methods.get('twilio-verify'):
                        phone_box = PhoneBoxValidator(placeholder="Enter your phone number", align="center")
                        phone_box.box.add_event_handler("pressed_enter", lambda **e: mfa_panel.raise_event("x-close-alert"))
                        #phone_box.box.add_event_handler("lost_focus", lambda **e: print(phone_box.valid_number))
                        #mfa_panel.add_component(Label(text="Enter your phone number", align="center"))
                        mfa_panel.add_component(phone_box.box)
                    else:
                        twilio_box = TextBox(placeholder="Enter 6-digit code", align="center", font="monospace")
                        twilio_box.set_event_handler("pressed_enter", lambda **e: mfa_panel.raise_event("x-close-alert"))
                        twilio_box.set_event_handler("show", lambda **e: twilio_box.focus())
                        mfa_panel.add_component(twilio_box)                            

                        sms_link = Link(text="Resend Text Message", icon="fa:commenting-o")
                        phone_link = Link(text="Call Me instead", icon="fa:phone")
                        sms_link.set_event_handler("click", lambda **e: mfa_panel.raise_event("x-close-alert", value='resend-sms'))
                        phone_link.set_event_handler("click", lambda **e: mfa_panel.raise_event("x-close-alert", value='call'))
                        mfa_panel.add_component(sms_link)
                        mfa_panel.add_component(phone_link)

            if mfa_error:
                mfa_panel.add_component(Label(foreground="red", bold=True, spacing_below="none", text=mfa_error))

            maybe_cancel_button = [("Cancel", 'cancel')] if allow_cancel else []
            m = alert(mfa_panel, title="2-Factor Authentication", buttons=[(confirm_button_text, True, 'success')] + maybe_cancel_button, dismissible=bool(allow_cancel))
            if m == 'cancel':
                return None, ""
            elif require_password and not password_box.text: # TODO: Also validate password
                password_error = "Please enter your password"
            elif m == 'back':
                selected_mfa_type = None
                mfa_error = None
            elif m == 'select-totp':
                mfa_error = None
                mfa_methods['totp'] = None
                selected_mfa_type = 'totp'
            elif m == 'select-twilio':
                mfa_error = None
                mfa_methods['twilio-verify'] = None
                selected_mfa_type = 'twilio-verify'
            elif m == 'fido':
                # fido is a single step process - we're done
                return mfa_methods['fido'], password_box.text

            elif selected_mfa_type == 'totp':
                if validate_totp_code(mfa_methods['totp'], totp_box.text):
                    return mfa_methods['totp'], password_box.text
                else:
                    mfa_error = "Incorrect code entered. Please try again."
            elif selected_mfa_type == 'twilio-verify':
                mfa_error = None
                if m == 'resend-sms':
                    channel = "sms"
                    mfa_methods['twilio-verify'] = None
                    mfa_error = "Text message resent"
                elif m == 'call':
                    channel = "call"
                    mfa_methods['twilio-verify'] = None
                    mfa_error = "Calling you now"
                else:
                    channel = "sms"

                if not mfa_methods.get('twilio-verify'):
                    if phone_box.valid_number:
                        mfa_methods['twilio-verify'] = generate_twilio_mfa_method(phone_box.valid_number)
                        try:
                            send_twilio_token(mfa_methods['twilio-verify'], channel)
                        except MFAException as e:
                            mfa_error = e.message
                    else:
                        mfa_error = "Please enter a valid phone number."
                else:
                    if check_twilio_token(mfa_methods['twilio-verify'], twilio_box.text):
                        return mfa_methods['twilio-verify'], password_box.text
                    else:
                        mfa_error = "Incorrect code entered. Please try again."
            else:
                mfa_error = None


    #!defFunction(anvil.users.mfa,!,email_address, password)!2: "Display a form to collect two-factor authentication credentials from the user currently logging in by passing the function their email and password." ["mfa_login_with_form"]
    def mfa_login_with_form(email, password):
        TextBox = pluggable_ui['anvil.TextBox']

        mfa_panel = LinearPanel()

        mfa_types = get_available_mfa_types(email, password)

        maybe_login_button = []

        error_label = Label(foreground="red", bold=True, spacing_below="none",visible=False)
        mfa_panel.add_component(error_label)
        def error(text):
            error_label.text = text
            error_label.visible = True

        def clear_error():
            error_label.visible = False
            error_label.text = ""
        
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

        if 'twilio-verify' in mfa_types:
            
            def use_phone(**e):
                error("Calling you now")
                try:
                    send_twilio_token(None, "call")
                except MFAException as e:
                    error(e.message)
            def use_sms(display_sent=True, **e):
                if display_sent:
                    error("Text message resent")
                try:
                    send_twilio_token(None, "sms")
                except MFAException as e:
                    error(e.message)

            use_sms(False)

            twilio_box = TextBox(placeholder="Enter 6-digit code", align="center", font="monospace")
            twilio_box.set_event_handler("pressed_enter", lambda **e: mfa_panel.raise_event('x-close-alert', value=get_twilio_mfa_login(twilio_box.text)))
            twilio_box.set_event_handler("show", lambda **e: twilio_box.focus())
            mfa_panel.add_component(Label(text="Please enter the 6-digit code we sent to the phone number we have on file"))
            mfa_panel.add_component(twilio_box)

            sms_link = Link(text="Resend Text Message", icon="fa:commenting-o")
            phone_link = Link(text="Call Me instead", icon="fa:phone")
            sms_link.set_event_handler("click", use_sms)
            phone_link.set_event_handler("click", use_phone)
            mfa_panel.add_component(sms_link)
            mfa_panel.add_component(phone_link)

            maybe_login_button = [("Log In", 'twilio', 'success')]



        if not mfa_types:
            mfa_panel.add_component(Label(text="No authentication methods available."))

        if not mfa_types or get_client_config().get("allow_mfa_email_reset", False):
            mfa_reset_link = Link(text="Reset 2-factor authentication by email")
            mfa_reset_link.set_event_handler('click', lambda **e: mfa_panel.raise_event('x-close-alert', value='reset_mfa'))
            mfa_panel.add_component(mfa_reset_link)

        r = alert(mfa_panel, title="2-Factor Authentication", buttons=maybe_login_button + [("Cancel", None, 'default')], dismissible=False)

        if r == 'totp':
            return get_totp_mfa_login(totp_box.text)
        elif r == 'twilio':
            return get_twilio_mfa_login(twilio_box.text)
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
