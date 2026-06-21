"""Pre-computed statistics for AEM datasets."""

import numpy as np

STATS_MIME = "application/vnd.nagelfluh.stats+json"


def _skewness(a):
    n = len(a)
    if n < 3:
        return None
    mean = np.mean(a)
    std = np.std(a, ddof=0)
    if std == 0:
        return 0.0
    return float(np.mean(((a - mean) / std) ** 3))


def _kurtosis(a):
    n = len(a)
    if n < 4:
        return None
    mean = np.mean(a)
    std = np.std(a, ddof=0)
    if std == 0:
        return 0.0
    return float(np.mean(((a - mean) / std) ** 4) - 3.0)


def compute_column_stats(arr):
    """Compute statistics for a numeric array, ignoring NaN values."""
    a = np.asarray(arr, dtype=np.float64).ravel()
    finite = a[np.isfinite(a)]
    if len(finite) == 0:
        return {"count": 0}

    std = float(np.std(finite, ddof=1)) if len(finite) > 1 else 0.0
    positive = finite[finite > 0]
    geometric_mean = float(np.exp(np.mean(np.log(positive)))) if len(positive) > 0 else None

    return {
        "count": int(len(finite)),
        "min": float(np.min(finite)),
        "max": float(np.max(finite)),
        "mean": float(np.mean(finite)),
        "geometric_mean": geometric_mean,
        "std": std,
        "p5": float(np.percentile(finite, 5)),
        "p25": float(np.percentile(finite, 25)),
        "p50": float(np.percentile(finite, 50)),
        "p75": float(np.percentile(finite, 75)),
        "p95": float(np.percentile(finite, 95)),
        "skewness": _skewness(finite),
        "kurtosis": _kurtosis(finite),
    }


def compute_xyz_stats(xyz):
    """Compute statistics for an XYZ/AEM dataset."""
    fl = xyz.flightlines
    ld = xyz.layer_data if hasattr(xyz, "layer_data") and xyz.layer_data else {}

    stats = {
        "flightline_count": len(fl),
        "total_soundings": len(fl),
    }

    if hasattr(xyz, "model_info") and xyz.model_info:
        crs = xyz.model_info.get("projection")
        if crs is not None:
            stats["crs"] = crs

    flightlines_stats = {}
    for col in fl.columns:
        try:
            s = fl[col]
            if hasattr(s, "dtype") and s.dtype.kind in ("f", "i", "u"):
                flightlines_stats[col] = compute_column_stats(s.values)
        except Exception:
            pass
    stats["flightlines"] = flightlines_stats

    layer_data_stats = {}
    for channel, df in ld.items():
        try:
            channel_stats = {"all": compute_column_stats(df.values.ravel())}
            for i, layer_col in enumerate(df.columns):
                channel_stats[str(i)] = compute_column_stats(df[layer_col].values)
            layer_data_stats[channel] = channel_stats
        except Exception:
            pass
    stats["layer_data"] = layer_data_stats

    return stats


def compute_grid_stats(ds):
    """Compute statistics for an xarray grid Dataset."""
    stats = {}

    if "epsg_code" in ds.attrs:
        stats["crs"] = f"EPSG:{ds.attrs['epsg_code']}"
    if "z_crs" in ds.attrs:
        stats["z_crs"] = ds.attrs["z_crs"]

    stats["dims"] = {dim: int(size) for dim, size in ds.dims.items()}

    coords_out = {}
    for name, coord in ds.coords.items():
        vals = coord.values
        coords_out[name] = vals.tolist() if vals.size <= 1000 else None
    stats["coords"] = coords_out

    variables_stats = {}
    for var_name in ds.data_vars:
        arr = np.asarray(ds[var_name].values, dtype=np.float64)
        var_stats = {"all": compute_column_stats(arr.ravel())}
        if arr.ndim >= 3:
            for i in range(arr.shape[-1]):
                var_stats[str(i)] = compute_column_stats(arr[..., i].ravel())
        variables_stats[var_name] = var_stats
    stats["variables"] = variables_stats

    return stats
