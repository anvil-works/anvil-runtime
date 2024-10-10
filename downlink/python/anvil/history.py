import random
import string
from urllib.parse import parse_qs, urlparse

import anvil.server

__all__ = ["Location", "history", "hash_history"]

_chars = string.digits + string.ascii_letters


def _create_key():
    return "".join(random.choices(_chars, k=7))


def _decode_search_params(url):
    query = urlparse(url).query
    params = parse_qs(query)
    decoded_params = {k: v[0] for k, v in params.items()}
    return decoded_params


def _clean_location_parts(to):
    path = to.get("path")
    if not path.startswith("/") and not path.startswith("."):
        path = "/" + path
    search = to.get("search")
    if search is None:
        search = ""
    elif search and not search.startswith("?"):
        search = "?" + search
    hash = to.get("hash")
    if hash is None:
        hash = ""
    elif hash and not hash.startswith("#"):
        hash = "#" + hash
    return {"path": path, "search": search, "hash": hash}


_base_href = None
_base_path = None


def _get_base_href():
    global _base_href
    if _base_href is None:
        _base_href = anvil.server.get_app_origin()
    return _base_href


def _get_base_path():
    global _base_path
    if _base_path is not None:
        return _base_path
    _base_path = urlparse(_get_base_href()).path
    if _base_path.endswith("/"):
        _base_path = _base_path[:-1]
    return _base_path


@anvil.server.portable_class
class Location(dict):
    def __init__(self, path="", search="", hash="", state=None, key=None):
        key = key or _create_key()
        partial_path = _clean_location_parts(
            {"path": path, "search": search, "hash": hash}
        )
        super().__init__(**partial_path, state=state, key=key)
        self.__dict__ = self

    @property
    def search_params(self):
        return _decode_search_params(self.get("search", ""))

    def __repr__(self):
        return "<Location:%s>" % dict.__repr__(self)

    def __str__(self):
        return self.get("path", "") + self.get("search", "") + self.get("hash", "")

    def get_url(self, full=False):
        url = str(self)
        if full:
            # a location on the server is always relative to the app origin
            url = _get_base_href() + url.lstrip(".")
        return url

    def __serialize__(self, gd):
        return dict(self)

    @classmethod
    def from_url(cls, url, state=None, key=None):
        parsed = urlparse(url)
        path = parsed.path
        base_path = _get_base_path()

        if base_path and path.startswith(base_path):
            path = path[len(base_path) :]
            if not path:
                path = "/"

        return cls(
            path=path,
            search=parsed.query,
            hash=parsed.fragment,
            key=key,
            state=state,
        )


class History(object):
    def __getattr__(self, name):
        raise RuntimeError("History is only available on the client")


history = History()
hash_history = History()
