"""Utility functions for mag processes."""

import contextlib
import tempfile
import os

import fsspec


@contextlib.contextmanager
def localize_urls(config, storage_kwargs):
    """Download remote files referenced in config to local temp files.

    Recursively walks dicts and lists, replacing any URL strings with
    paths to downloaded temp files.  ``file://`` URLs are stripped to a
    bare path without downloading.

    Args:
        config: Nested dict/list structure potentially containing URLs
        storage_kwargs: fsspec storage arguments

    Yields:
        Modified config with URLs replaced by local temp file paths
    """
    temp_files = []

    def localize(value):
        if isinstance(value, dict):
            return {k: localize(v) for k, v in value.items()}
        elif isinstance(value, (list, tuple)):
            return type(value)(localize(v) for v in value)
        elif isinstance(value, str) and "://" in value:
            if value.startswith("file://"):
                return value.split("file://", 1)[1]
            temp_file = tempfile.NamedTemporaryFile(delete=False)
            temp_files.append(temp_file.name)
            with fsspec.open(value, 'rb', **storage_kwargs) as src:
                temp_file.write(src.read())
            temp_file.close()
            return temp_file.name
        return value

    try:
        yield localize(config)
    finally:
        for path in temp_files:
            try:
                os.unlink(path)
            except OSError:
                pass
