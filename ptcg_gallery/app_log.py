"""应用日志模块 —— 简单的结构化日志。"""

from __future__ import annotations

import logging
import sys
from datetime import datetime, timezone

_logger = logging.getLogger("ptcg_gallery")
_logger.setLevel(logging.DEBUG)

_handler = logging.StreamHandler(sys.stdout)
_handler.setLevel(logging.DEBUG)
_handler.setFormatter(
    logging.Formatter(
        "[%(asctime)s] %(levelname)-6s %(message)s",
        datefmt="%H:%M:%S",
    )
)
_logger.addHandler(_handler)


def info(msg: str, **kwargs: object):
    _logger.info(_format(msg, **kwargs))


def warning(msg: str, **kwargs: object):
    _logger.warning(_format(msg, **kwargs))


def error(msg: str, **kwargs: object):
    _logger.error(_format(msg, **kwargs))


def debug(msg: str, **kwargs: object):
    _logger.debug(_format(msg, **kwargs))


def _format(msg: str, **kwargs: object) -> str:
    if not kwargs:
        return msg
    parts = [f"{k}={v!r}" for k, v in kwargs.items()]
    return f"{msg}  ({'  '.join(parts)})"
