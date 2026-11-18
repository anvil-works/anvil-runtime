"""Helpers for testing code that sends email."""

from __future__ import absolute_import

import contextlib

import anvil.server

#!defModule(anvil.testing.email)!1: "This module contains helpers for testing server code that sends email."


class SentEmail(object):
    """An email the app's code sent inside a `capture_emails()` block.

    Its attributes are the arguments the code passed to `anvil.email.send()`."""

    #!defAttr()!1: {name:"to",description:"The `to` argument the code passed to `anvil.email.send()`: a string, a list of strings, or None."}
    #!defAttr()!1: {name:"cc",description:"The `cc` argument the code passed to `anvil.email.send()`: a string, a list of strings, or None."}
    #!defAttr()!1: {name:"bcc",description:"The `bcc` argument the code passed to `anvil.email.send()`: a string, a list of strings, or None."}
    #!defAttr()!1: {name:"from_address",type:"string",description:"The `from_address` the code passed to `anvil.email.send()`, or None."}
    #!defAttr()!1: {name:"from_name",type:"string",description:"The `from_name` the code passed to `anvil.email.send()`, or None."}
    #!defAttr()!1: {name:"subject",type:"string",description:"The subject line, or None."}
    #!defAttr()!1: {name:"text",type:"string",description:"The plain-text content, or None."}
    #!defAttr()!1: {name:"html",type:"string",description:"The HTML content, or None."}
    #!defAttr()!1: {name:"attachments",pyType:"list(anvil.Media instance)",description:"The attachments."}
    #!defAttr()!1: {name:"inline_attachments",pyType:"dict(string,anvil.Media instance)",description:"The inline attachments, by Content-ID."}
    #!defAttr()!1: {name:"in_reply_to",type:"string",description:"The Message-ID this email replies to, eg when sent with `Message.reply()`, or None."}
    #!defAttr()!1: {name:"references",type:"string",description:"The References header, or None."}
    #!defAttr()!1: {name:"message_id",type:"string",description:"The Message-ID that `anvil.email.send()` returned in its SendReport."}

    def __init__(self, email):
        self.to = email.get("to")
        self.cc = email.get("cc")
        self.bcc = email.get("bcc")
        self.from_address = email.get("from_address")
        self.from_name = email.get("from_name")
        self.subject = email.get("subject")
        self.text = email.get("text")
        self.html = email.get("html")
        self.attachments = email["attachments"]
        self.inline_attachments = email["inline_attachments"]
        self.in_reply_to = email.get("in_reply_to")
        self.references = email.get("references")
        self.message_id = email["message_id"]

    def __repr__(self):
        if self.text is None and self.html is not None:
            body_name, body = "html", self.html
        else:
            body_name, body = "text", self.text
        if body is not None and len(body) > 40:
            body = body[:40] + "..."
        return "<SentEmail to=%r subject=%r %s=%r>" % (self.to, self.subject, body_name, body)

    #!defClassNoConstructor(anvil.testing.email,#%SentEmail)!1: "An email the app's code sent inside a `capture_emails()` block. Its attributes are the arguments the code passed to `anvil.email.send()`."


#!defFunction(anvil.testing.email,%)!2:
# {
#   $doc: "Use in a `with` block to capture the emails the app's code sends, including from background tasks and `Message.reply()`.\n\nYields a list when the block ends, filled with `SentEmail` objects for the emails sent inside the block. Tests never send real email.\nTo check emails sent from background tasks, call `anvil.testing.server.wait_for_background_tasks_to_finish()` inside the block.\n\n```python\nwith capture_emails() as emails:\n    place_order(user, items)\n\n[email] = emails\nassert email.to == [\"Alice <alice@example.com>\"]\n```",
# }["capture_emails"]
@contextlib.contextmanager
def capture_emails():
    """Use in a `with` block to capture the emails the app's code sends, including from background tasks and `Message.reply()`.

    Yields a list when the block ends, filled with `SentEmail` objects for the emails sent inside the block.
    Tests never send real email.
    To check emails sent from background tasks, call `anvil.testing.server.wait_for_background_tasks_to_finish()` inside the block.

    ```python
    with capture_emails() as emails:
        place_order(user, items)

    [email] = emails
    assert email.to == ["Alice <alice@example.com>"]
    ```
    """
    after = anvil.server.call("anvil.private.testing.email.get_last_captured_pid")
    emails = []
    try:
        yield emails
    finally:
        emails.extend(SentEmail(email) for email in
                      anvil.server.call("anvil.private.testing.email.get_captured", after=after))
