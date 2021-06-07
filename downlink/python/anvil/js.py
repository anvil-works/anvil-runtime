import anvil.server

@anvil.server.portable_class
class ProxyType:
    # we only deserialize proxyobjects on the server
    # the only proxyobjects that can be sent to the server are object literals
    # so this method returns a dict
    # serialize happens on the client
    def __new_deserialized__(data, globals):
        return data

