def _hash_wrapper(*params):
    # this makes query objects cachable as keys of dictionaries
    def _mk_tuple(self):
        return tuple(getattr(self, param) for param in params)

    def __hash__(self):
        return hash(_mk_tuple(self))

    def __eq__(self, other):
        if type(other) is not type(self):
            return NotImplemented
        return _mk_tuple(self) == _mk_tuple(other)

    return __hash__, __eq__
