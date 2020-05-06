__author__ = 'meredydd'

import random, string

import anvil
from . import _server



def _gen_id():
    return ''.join(random.SystemRandom().choice(string.ascii_letters + string.digits) for _ in range(10))


# requestId->_IncomingRequest
_incoming_requests = {}


class StreamingMedia(anvil.Media):
    def __init__(self, content_type, name):
        self._content_type = content_type
        self._content = b''
        self._incoming_content = []
        self._complete = False
        self._name = name

    def add_content(self, data, last_chunk=False):
        self._incoming_content.append(data)
        if last_chunk:
            self._content = b''.join(self._incoming_content)
            self._incoming_content = []
            self._complete = True

    def is_complete(self):
        return self._complete

    def get_content_type(self):
        return self._content_type

    def get_bytes(self):
        return self._content

    def get_url(self):
        raise None

    def get_name(self):
        return self._name


class IncomingReqResp:
    def __init__(self, json):
        self.media = {}
        self.capabilities = []

        def reconstruct_data_media(d):
            reconstructed = StreamingMedia(d['mime-type'], d.get("name", None))
            self.media[d['id']] = reconstructed
            return reconstructed

        self.json = _server._reconstruct_objects(json, reconstruct_data_media,
                                                 hold_back_value_types=True, collect_capabilities=self.capabilities)

        _incoming_requests[self.json["id"]] = self
        self.maybe_execute()

    def reconstruct_remaining_data(self):
        """Call this when you're ready to execute user code"""

        def assert_no_media(_):
            raise Exception("We shouldn't have any Media left by this point")

        self.json = _server._reconstruct_objects(self.json, assert_no_media)

    def add_binary_data(self, json, data):
        self.media[json['mediaId']].add_content(data, json['lastChunk'])
        if json['lastChunk']:
            self.maybe_execute()

    def is_ready(self):
        for id in self.media:
            if not self.media[id].is_complete():
                return False

        if holding_reqresps:
            return False

        return True

    def maybe_execute(self):
        if not self.is_ready():
            return

        del _incoming_requests[self.json["id"]]

        self.execute()



_next_hdr = None


def process_blob_header(hdr):
    global _next_hdr
    _next_hdr = hdr


def process_blob(blob):
    global _next_hdr
    _incoming_requests[_next_hdr['requestId']].add_binary_data(_next_hdr, blob)
    _next_hdr = None


# Machinery to suspend execution of all reqresps until an external event (app loading)
holding_reqresps = False


def release_reqresps():
    global holding_reqresps
    holding_reqresps = False
    for reqresp in list(_incoming_requests.values()):
        reqresp.maybe_execute()


def serialise(reqresp, do_send, collect_capabilities=None):
    media = []

    def enqueue_media(m):
        media_id = _gen_id()
        media.append((media_id, m))
        return {"id": media_id}

    reqresp = _server.fill_out_media(reqresp, enqueue_media, collect_capabilities=collect_capabilities)

    do_send(reqresp)

    for (id,m) in media:
        data = m.get_bytes()
        l = len(data)
        i = 0
        n = 0
        sent_once = False
        while i < l or not sent_once:
            chunk_len = min(l - i, 65536)

            do_send({'type': 'CHUNK_HEADER', 'requestId': reqresp['id'], 'mediaId': id,
                     'chunkIndex': n, 'lastChunk': (i + chunk_len == l)},
                    data[i:(i+chunk_len)])

            i += chunk_len
            n += 1
            sent_once = True
