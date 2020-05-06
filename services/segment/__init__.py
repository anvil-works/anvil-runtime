import anvil.server

def _do_missing():
	anvil.server.call("anvil.private.send_contact", "Segment.io server side", "App attempted to load 'analytics' module from server code")
	raise Exception("Segment.io analytics is only available from client code (ie Forms), using tha analytics.client module.")

identify = _do_missing
track = _do_missing
page = _do_missing
screen = _do_missing
group = _do_missing
alias = _do_missing
