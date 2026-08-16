"""No-op stand-in for OpenSwarm's bundled debugger.

The generated backends only ever call debug(); the real module lives inside
/Applications/OpenSwarm.app and writes state next to itself, which is neither
available nor appropriate on a server.
"""
def debug(*args, **kwargs):
    return None
