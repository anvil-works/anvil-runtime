import json, struct, threading

try:
    bytes
except NameError:
    bytes = str


class MessagePipe(object):
    def __init__(self, pipe):
        self.pipe = pipe
        self.lock = threading.RLock()

    def send(self, message, bindata=None):
        encoded_message = json.dumps(message).encode()
        self.send_encoded(encoded_message, bindata)

    def send_encoded(self, encoded_message, bindata=None):
        assert(type(encoded_message) is bytes)
        with self.lock:
            l = len(encoded_message)
            assert(l < 2**32)
            if bindata is not None:
                self.pipe.write(struct.pack("=?I", True, l) + encoded_message + struct.pack("I", len(bindata)))
                self.pipe.write(bindata)
            else:
                self.pipe.write(struct.pack("=?I", False, l) + encoded_message)
            self.pipe.flush()

    def _fully_receive(self, l):
        if l == 0:
            return b''
        s = self.pipe.read(l)
        while len(s) < l:
            r = self.pipe.read(l-len(s))
            if len(r) == 0:
                raise EOFError
            s += r
        return s

    def receive(self):
        has_bindata, msg_len = struct.unpack("=?I", self._fully_receive(5))
        message = json.loads(self._fully_receive(msg_len))
        bindata = None
        if has_bindata:
            bindata_len, = struct.unpack("I", self._fully_receive(4))
            bindata = self._fully_receive(bindata_len)

        return message, bindata
