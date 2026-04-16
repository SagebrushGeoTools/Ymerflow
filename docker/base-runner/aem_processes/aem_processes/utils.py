"""Utility functions for AEM processes."""

import contextlib
import os
import re
import tempfile
import fsspec
import importlib
import importlib.metadata
import yaml

# Channel-specific columns (Current_Ch01, Gate_Ch01, InUse_Ch01, STD_Ch01, …)
# are NOT remapped by the ALC normalizer — downstream code expects them exactly
# as written. Everything else gets lowercased so that camelCase variants like
# AngleX, TxRoll, TxPitch, TxAltitude are found by libaarhusxyz's normalizer
# (which checks lower/upper/title but not camelCase).
_CHANNEL_COL_RE = re.compile(r'.+_Ch\d+', re.IGNORECASE)


def normalize_column_case(xyz):
    """Lowercase flightlines column names before ALC normalization.

    libaarhusxyz._case_variants generates lower/upper/title variants but misses
    camelCase (e.g. AngleX → anglex, TxRoll → txroll). Lowercasing first makes
    the normalizer effectively case-insensitive without requiring an ALC file for
    common column naming variations.

    Channel-specific columns (Current_Ch01, Gate_Ch01, InUse_Ch01, STD_Ch01)
    are preserved as-is since they are not remapped by the ALC normalizer and
    downstream pipeline code depends on their exact form.
    """
    xyz.flightlines.columns = [
        col if _CHANNEL_COL_RE.match(col) else col.lower()
        for col in xyz.flightlines.columns
    ]


def load_fn(name):
    """Load a function/class by its fully qualified name.

    Args:
        name: String like "module.submodule.ClassName"

    Returns:
        The loaded class or function
    """
    mod, fn = name.rsplit(".", 1)
    return getattr(importlib.import_module(mod), fn)


def get_entry_points(group):
    """Get all entry points for a given group.

    Args:
        group: Entry point group name

    Returns:
        Dict mapping entry point names to EntryPoint objects
    """
    try:
        return {entry.name: entry for entry in importlib.metadata.entry_points()[group]}
    except KeyError:
        return {}


@contextlib.contextmanager
def localize_urls(config, storage_kwargs):
    """Download remote files referenced in config to local temp files.

    Args:
        config: Nested dict/list structure containing URLs
        storage_kwargs: fsspec storage arguments

    Yields:
        Modified config with URLs replaced by local paths
    """
    temp_files = []

    def localize(value):
        if isinstance(value, dict):
            return {k: localize(v) for k, v in value.items()}
        elif isinstance(value, (list, tuple)):
            return [localize(v) for v in value]
        elif isinstance(value, str) and "://" in value:
            if value.startswith("file://"):
                return value.split("file://", 1)[1]
            else:
                # Download to temp file
                # Preserve file extension for format detection (e.g., .msgpack vs .xyz)
                _, ext = os.path.splitext(value)
                temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
                temp_files.append(temp_file.name)

                with fsspec.open(value, 'rb', **storage_kwargs) as src:
                    temp_file.write(src.read())
                temp_file.close()

                return temp_file.name
        return value

    try:
        yield localize(config)
    finally:
        # Cleanup temp files
        for path in temp_files:
            try:
                os.unlink(path)
            except:
                pass


def load_system_from_base(base, system):
    """Create a system class by setting attributes on a base class.

    Args:
        base: Base system class
        system: Dict with 'args' containing attribute overrides

    Returns:
        Modified system class
    """
    class System(base):
        pass

    for key, value in system.get("args", {}).items():
        setattr(System, key, value)

    return System


@contextlib.contextmanager
def load_system(system, storage_kwargs):
    """Load an inversion system from entry points or YAML file.

    Supports recursive loading from YAML files.

    Args:
        system: Dict with 'name' and 'args'
        storage_kwargs: fsspec storage arguments

    Yields:
        System class
    """
    systems = get_entry_points("simpeg.static_instrument")

    if system["name"].startswith("/") or "://" in system["name"]:
        # Load from file (local or remote)
        if system["name"].startswith("/"):
            with open(system["name"]) as f:
                system_description = yaml.load(f, Loader=yaml.SafeLoader)
        else:
            with fsspec.open(system["name"], 'r', **storage_kwargs) as f:
                system_description = yaml.load(f, Loader=yaml.SafeLoader)

        with localize_urls(system_description, storage_kwargs) as system_description:
            with load_system(system_description, storage_kwargs) as base:
                yield load_system_from_base(base, system)
    else:
        # Load from entry point
        if system["name"] not in systems:
            raise ValueError(f"Unknown inversion system: {system['name']}")

        base = systems[system["name"]].load()
        yield load_system_from_base(base, system)
