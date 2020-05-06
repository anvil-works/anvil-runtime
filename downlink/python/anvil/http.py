import anvil.server

import json as json_mod

class HttpErrorStatus(Exception):
    "Represents an HTTP error response (eg 404 Not Found)"
    def __init__(self, status, content, message=None):
        self.status = status
        self.content = content
        if message is None:
            message = "HTTP error %s" % status
        Exception.__init__(self, message)
#!defAttr()!1: {name: "status", type: "number", description: "The numeric HTTP status error (eg 404 for \"not found\").\n\nStatus will be 0 for errors that prevent the request completing at all (eg cross-origin policy in the browser)."}
#!defAttr()!1: {name: "content", pyType: "anvil.Media instance", description: "The content returned by the request (eg the body of a 404 response)"}
#!defClass(anvil.http,HttpError)!0:


# Backward compatibility
HttpError = HttpErrorStatus


class HttpRequestFailed(anvil.server.AnvilWrappedError):
    "Represents an HTTP request that failed to complete entirely"
    pass


anvil.server._register_exception_type("anvil.http.HttpRequestFailed", HttpRequestFailed)

#!defFunction(anvil.http,_,url,[method="GET"],[data=None],[json=False],[headers=None],[username=None],[password=None])!2: "Make an HTTP request to the specified URL.\n\nIf json=True, the response is parsed into Python objects (dicts/lists/etc), and 'data' is JSON-encoded before sending.\n\n'headers' can be a dict of strings to set HTTP headers.\nIf specified, 'username' and 'password' will be used to perform HTTP Basic authentication." ["request"]
def request(url, method='GET', data=None, headers=None, username=None, password=None, json=False):
    if headers is None:
        headers = {}
    if json and data is not None:
        data = json_mod.dumps(data)
        headers["content-type"] = "application/json"

    resp = anvil.server.call("anvil.private.http.request",
                             url=url, method=method, data=data, headers=headers, username=username, password=password)
    # Parse JSON if we have it

    if json:
        try:
            b = resp["content"].get_bytes()
            # Ew. microjson barfs if we give it a "unicode" object.
            # We only use microjson in the old 2.7 sandbox, so
            # this can go away soon.
            if not isinstance(b, str):
                b = b.decode()
            resp["content"] = json_mod.loads(b)
        except:
            raise HttpError(resp["status"], resp["content"], "Invalid JSON in response")

    if resp["status"] < 200 or resp["status"] > 299:
        raise HttpError(resp["status"], resp["content"])

    return resp["content"]


#!defFunction(anvil.http,_,string_to_encode)!2: "URL-encode a string" ["url_encode"]
def url_encode(string_to_encode):
    return anvil.server.call("anvil.private.http.url_encode", string_to_encode)

#!defFunction(anvil.http,_,string_to_encode)!2: "URL-decode a string. Raises UrlEncodingError on failure." ["url_decode"]
def url_decode(string_to_decode):
    return anvil.server.call("anvil.private.http.url_decode", string_to_decode)


#!defClass(anvil.http,UrlEncodingError)!0:
class UrlEncodingError(anvil.server.AnvilWrappedError):
    pass


anvil.server._register_exception_type("anvil.http.UrlEncodingError", UrlEncodingError)
