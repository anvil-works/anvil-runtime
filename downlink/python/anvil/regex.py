import re

def replace(val, pattern, newval):
    return re.sub(pattern, newval, val)
