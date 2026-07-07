class UserError(Exception):
    """A failure caused by the end user. The message is shown directly in the UI
    and is not treated as a software fault."""
    pass
