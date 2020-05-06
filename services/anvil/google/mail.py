import anvil.server
import sys

string_type = str
if sys.version_info < (3,):
    string_type = basestring

#!defFunction(anvil.google.mail,%,[to=],[subject=None],[text=None],[html=None],[cc=],[bcc=],[from_address=None],[draft=False])!2: "Send an email via GMail. 'to', 'cc' and 'bcc' may be strings (email addresses) or lists of strings (multiple addresses). At least one of 'text' and 'html' need to be provided (both strings). Passing draft=True will create a draft message rather than sending it." ["send"]
def send(to=[], subject=None, text=None, html=None, cc=[], bcc=[], from_address=None, draft=False):
    if not anvil.is_server_side():
        raise Exception("Only server modules can send email")

    def to_list(val):
        return [val] if isinstance(val, string_type) else list(val)

    to = to_list(to)
    cc = to_list(cc)
    bcc = to_list(bcc)

    if from_address is not None and not isinstance(from_address, string_type):
        raise Exception("from_address must be a string (eg 'John Smith <jsmith@example.com>'")

    if len(to + cc + bcc) == 0:
        raise Exception("You must specify at least one recipient (to, cc or bcc)")

    if text is None and html is None:
        raise Exception("You must supply a message body (text or html)")

    return anvil.server.call("anvil.private.google.mail.send", from_address=from_address, to=to, cc=cc, bcc=bcc, subject=subject, text=text, html=html, draft=draft)

