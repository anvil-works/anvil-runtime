import anvil.server

#!defModule(anvil.email)!1: "The `anvil.email` module contains functions for sending and receiving email in your Anvil app."

#!suggestAttr(anvil.email,send)!0:

#!defClass(anvil.email,SendFailure)!:
class SendFailure(anvil.server.AnvilWrappedError):
    pass

anvil.server._register_exception_type("anvil.email.SendFailure", SendFailure)

class DeliveryFailure(Exception):
    #!defMethod(_,message=None,smtp_code=554)!2: 
    # {anvil$helpLink: "/docs/email/sending_and_receiving#rejecting-email", $doc: "While handling an error, you can raise a DeliveryFailure exception to reject email delivery. Optionally, you may specify a message and SMTP error code with the rejection."} ["__init__"]
    def __init__(self, message=None, smtp_code=None):
        if message is None:
            super(DeliveryFailure, self).__init__()
        elif smtp_code is not None:
            message = "{}: {}".format(smtp_code, message)
        super(DeliveryFailure, self).__init__(message)
    #!defClass(anvil.email,DeliveryFailure)!:



#!defFunction(anvil.email,anvil.email.SendReport instance,[to=],[cc=],[bcc=],[from_address="no-reply"],[from_name=],[subject=],[text=],[html=],[attachments=],[inline_attachments=])!2:
# {
#   $doc: "Send an email",
#   anvil$helpLink: "/docs/email",
#   anvil$args: {
#     to: "The email recipient[s] in the 'To' field. Can be a string or list of strings.\n\nEach string can be a bare address (eg 'joe@example.com') or include a display name (eg 'Joe Bloggs <joe@example.com>').",
#     cc: "The email recipient[s] in the 'Cc' field. Can be a string or list of strings.\n\nEach string can be a bare address (eg 'joe@example.com') or include a display name (eg 'Joe Bloggs <joe@example.com>').",
#     bcc: "The email recipient[s] in the 'Bcc' field. Can be a string or list of strings.\n\nEach string can be a bare address (eg 'joe@example.com') or include a display name (eg 'Joe Bloggs <joe@example.com>').",
#     from_address: "The From: address from this email. Can be a bare address (eg 'joe@example.com') or include a display name (eg 'Joe Bloggs <joe@example.com>').\n\nIf no domain is specified, or the specified domain is not a legal sending domain for this app, the address will be replaced with a valid domain. So if you specify 'noreply', the email will come from 'noreply@your-app-domain.anvil.app'.",
#     from_name: "The name associated with the From: address for this email. (Only valid if the from_address is a bare email address.)",
#     subject: "The subject line for this email.",
#     text: "The plain-text (no HTML) content for this email. You must specify at least one of 'text' and 'html'.",
#     html: "The HTML content for this email. You must specify at least one of 'text' and 'html'.",
#     attachments: "A list of Media objects to send as attachments with this email.",
#     inline_attachments: "Inline that can be used in this email's HTML, for example in <img> tags. Must be a dictionary whose keys are IDs and values are Media objects. IDs can then be used in a message's HTML with 'cid:xxx' URIs.",
#   }
# } ["send"]
def send(**kw):
    return anvil.server.call("anvil.private.email.send.v2", **kw)

# NB no defFunction() here; this one is defined in the autocompleter
def handle_message(fn=None, require_dkim=False):
    def wrapper(fn):
        import functools # don't try to import this on the client
        @functools.wraps(fn)
        def handler(msg_dict):
            msg = Message(msg_dict)
            if require_dkim and not msg.dkim.valid_from_sender:
                raise DeliveryFailure("No valid DKIM signature for %s" % msg.envelope.from_address)
            fn(msg)
        return anvil.server.callable("email:handle_message")(handler)
    return wrapper(fn) if fn is not None else wrapper


@anvil.server.portable_class
class Address(object):

    #!defAttr()!1: {name:"address",type:"string",description:"The email address this object represents."}
    #!defAttr()!1: {name:"name",type:"string",description:"The name associated with the address this object represents."}
    #!defAttr()!1: {name:"raw_value",type:"string",description:"The full string value of this address."}
    def __init__(self, address):
        self.address = address['address']
        self.name = address['name']
        self.raw_value = address['raw']

    #!defClass(anvil.email,#Address)!:


@anvil.server.portable_class
class Message(object):
    #!defAttr()!1: {name:"from_address",type:"string",description:"The email address from which this message was sent, according to the SMTP envelope."}
    #!defAttr()!1: {name:"recipient",type:"string",description:"The email address that received this message.\n\nNote that this email address may not appear in any of the headers (eg if the email has been BCCed or blind forwarded)."}
    @anvil.server.portable_class
    class Envelope(object):
        def __init__(self, envelope):
            self.from_address = envelope['from']
            self.recipient = envelope['recipient']
    #!defClass(anvil.email.Message,#Envelope)!:

    #!defAttr()!1: {name:"valid_from_sender",type:"boolean",description:"Was this message signed by the domain in its envelope \"from\" address?"}
    #!defAttr()!1: {name:"domains",type:"list(string)",description:"A list of the DKIM domains that signed this message."}
    @anvil.server.portable_class
    class DKIM(object):
        def __init__(self, dkim):
            self.valid_from_sender = dkim['valid_from_sender']
            self.domains = dkim['domains']
    #!defClass(anvil.email.Message,#DKIM)!:


    #!defAttr()!1: {name:"to_addresses",pyType:"list(anvil.email.Address instance)",description:"The addresses this message was sent to."}
    #!defAttr()!1: {name:"from_address",pyType:"anvil.email.Address instance",description:"The address this message was sent from."}
    #!defAttr()!1: {name:"cc_addresses",pyType:"list(anvil.email.Address instance)",description:"The addresses this message was copied to."}
    @anvil.server.portable_class
    class Addressees(object):
        def __init__(self, addressees):
            self.to_addresses = [Address(a) for a in addressees.get('to',[])]
            self.from_address = Address(addressees['from'][0]) if 'from' in addressees else None
            self.cc_addresses = [Address(a) for a in addressees.get('cc',[])]
    #!defClass(anvil.email.Message,#Addressees)!:


    #!defAttr()!1: {name:"envelope",pyType:"anvil.email.Message.Envelope instance",description:"The sender and receipient of this email, according to the SMTP envelope."}
    #!defAttr()!1: {name:"dkim",pyType:"anvil.email.Message.DKIM instance",description:"Object describing whether this message was signed by the sending domain"}
    #!defAttr()!1: {name:"addressees",pyType:"anvil.email.Message.Addressees instance",description:"The addresses this email was sent from and to, according to the headers."}
    #!defAttr()!1: {name:"headers",type:"list",description:"All the headers in this email, as a list of (name,value) pairs."}
    #!defAttr()!1: {name:"text",type:"string",description:"The plain-text content of this email, or None if there is no plain-text part."}
    #!defAttr()!1: {name:"subject",type:"string",description:"The subject of this email, or None if there is no subject."}
    #!defAttr()!1: {name:"html",type:"string",description:"The HTML content of this email, or None if there is no HTML part."}
    #!defAttr()!1: {name:"attachments",pyType:"list(anvil.Media instance)",description:"A list of this email's attachments."}
    #!defAttr()!1: {name:"inline_attachments",pyType:"dict(string,anvil.Media instance)",description:"A dictionary of this email's inline attachments. Keys are ContentID headers, values are the attachments as Media Objects."}

    def __init__(self, msg_dict):
        self.envelope = Message.Envelope(msg_dict['envelope'])
        self.dkim = Message.DKIM(msg_dict['dkim'])
        self.addressees = Message.Addressees(msg_dict['addressees'])
        self.headers = msg_dict['headers']
        self.subject = msg_dict['subject']
        self.text = msg_dict['text']
        self.html = msg_dict['html']
        self.attachments = msg_dict['attachments']
        self.inline_attachments = msg_dict['inline_attachments']

    #!defMethod(_,header_name,[default=None])!2: "Return the value of the specified header, or default value if it is not present.\n\nCase-insensitive. If the header is specified multiple times, returns the first value." ["get_header"]
    def get_header(self, header_name, default=None):
        header_name = header_name.lower()
        for name,value in self.headers:
            if name.lower() == header_name:
                return value
        return default

    #!defMethod(_,header_name)!2: "Return a list containing every value of the specified header. Case-insensitive." ["list_header"]
    def list_header(self, header_name):
        header_name = header_name.lower()
        return [value for name,value in self.headers
                if name.lower() == header_name]

    #!defMethod(_,[cc=],[bcc=],[from_address=],[from_name=],[text=],[html=],[attachments=])!2: "Reply to this email." ["reply"]
    def reply(self,**kw):
        kw['to'] = kw.get('to', self.get_header("Reply-To", None))
        if kw['to'] is None:
            if self.addressees.from_address is not None:
                kw['to'] = self.addressees.from_address.raw_value
            else:
                kw['to'] = self.envelope.from_address
        if kw['to'] is None:
            raise Exception("Cannot reply to a message with no Reply-To header, From address, or Envelope From address.")

        kw['subject'] = kw.get('subject', self.subject)
        kw['in_reply_to'] = self.get_header("Message-ID")
        if kw['in_reply_to']:
            kw['references'] = self.get_header("References", "") + " " + kw['in_reply_to']
        kw['from_address'] = kw.get('from_address', self.envelope.recipient)
        send(**kw)

    def __str__(self):

        truncated_text = ""
        if self.text:
            truncated_text = self.text.replace("\n", " \\ ")
            (truncated_text[:70] + '...') if len(truncated_text) > 70 else truncated_text,

        return """anvil.email.Message:
    from: %s
    to: %s
    subject: %s
    text: %s
    attachments: %s""" % (
            self.addressees.from_address and self.addressees.from_address.raw_value,
            len(self.addressees.to_addresses) > 0 and self.addressees.to_addresses[0].raw_value,
            self.subject,
            truncated_text,
            ", ".join(["%s (%s bytes)" % (a.name, len(a.get_bytes())) for a in self.attachments]) if len(self.attachments) > 0 else None
        )

    #!defClass(anvil.email,#Message)!:


@anvil.server.portable_class
class SendReport(object):

    #!defAttr()!1: {name: "message_id", type: "string", description: "The Message-ID header given to this outgoing message."}

    def __init__(self):
        raise Exception("Cannot construct a SendReport manually")

    #!defClass(anvil.email,#SendReport)!:
