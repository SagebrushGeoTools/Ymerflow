import importlib.metadata
import asyncio


def _load_entry_points(name):
    eps = importlib.metadata.entry_points(group='nagelfluh.hooks')
    return [ep.load() for ep in eps if ep.name == name]


def _run_sync(name, *args, **kwargs):
    fns = _load_entry_points(name)
    results, errors = [], []
    for fn in fns:
        try:
            r = fn(*args, **kwargs)
            if r:
                results.extend(r)
        except Exception as e:
            errors.append(e)
    if errors:
        for later in errors[1:]:
            later.__context__ = errors[0]
        raise errors[-1]
    return results


async def _run_async(name, *args, **kwargs):
    fns = _load_entry_points(name)
    results, errors = [], []
    for fn in fns:
        try:
            r = fn(*args, **kwargs)
            if asyncio.iscoroutine(r):
                r = await r
            if r:
                results.extend(r)
        except Exception as e:
            errors.append(e)
    if errors:
        for later in errors[1:]:
            later.__context__ = errors[0]
        raise errors[-1]
    return results


class _Namespace:
    def __init__(self, impl):
        self._impl = impl

    def __getattr__(self, name):
        if name.startswith('_'):
            raise AttributeError(name)

        def caller(*args, **kwargs):
            return self._impl(name, *args, **kwargs)
        return caller


class _AsyncNamespace:
    def __init__(self):
        pass

    def __getattr__(self, name):
        if name.startswith('_'):
            raise AttributeError(name)

        async def caller(*args, **kwargs):
            return await _run_async(name, *args, **kwargs)
        return caller


class _Hooks:
    run = _Namespace(_run_sync)
    run_async = _AsyncNamespace()


hooks = _Hooks()
