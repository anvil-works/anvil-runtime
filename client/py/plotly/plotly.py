
def _mk_unimplemented(name):
    def f(*args, **kwargs):
        raise Exception("You don't need %s() on Anvil. Set the 'data' property on a Plot component instead" % name)
    return f

iplot = _mk_unimplemented("iplot")
plot = _mk_unimplemented("plot")
