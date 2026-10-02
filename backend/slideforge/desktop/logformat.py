"""Log formatting shared by the launcher and Django's LOGGING (one format, always UTC)."""

import logging
import time

FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


class UTCFormatter(logging.Formatter):
    # Django switches the process time zone to TIME_ZONE partway through startup; UTC keeps entries comparable.
    converter = time.gmtime

    def __init__(self, fmt=FORMAT, datefmt="%Y-%m-%dT%H:%M:%SZ", **kwargs):
        super().__init__(fmt, datefmt, **kwargs)
