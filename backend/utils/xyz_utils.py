import io
import os
import libaarhusxyz


def create_mock_xyz(process_type="fft"):
    """Load actual data from files based on process type"""
    # Determine which .xyz file to load based on process type
    data_dir = "data"
    gex_file = os.path.join(data_dir, "20201231_20023_IVF_SkyTEM304_SKB.gex")

    if process_type == "fft":
        xyz_file = os.path.join(data_dir, "aem_processed_data_foothill_central_valley.measured.xyz")
    elif process_type == "inversion":
        xyz_file = os.path.join(data_dir, "aem_processed_data_foothill_central_valley.model.xyz")
    else:
        xyz_file = os.path.join(data_dir, "aem_processed_data_foothill_central_valley.measured.xyz")

    # Load XYZ and GEX
    xyz_obj = libaarhusxyz.XYZ(xyz_file)
    xyz_obj.model_info["projection"] = 32610
    xyz_obj.normalize()

    gex_obj = libaarhusxyz.GEX(gex_file)

    return {"xyz": xyz_obj, "gex": gex_obj}


def xyz_to_msgpack(xyz_data):
    """Convert XYZ to msgpack binary"""
    buffer = io.BytesIO()
    xyz_data["xyz"].to_msgpack(buffer, gex=xyz_data["gex"])
    return buffer.getvalue()


def extract_xyz_part(xyz_data, part_name):
    """Extract rows with a specific title from XYZ data"""
    xyz_obj = xyz_data["xyz"]

    if "title" not in xyz_obj.flightlines.columns:
        return None

    # Convert part_name to float if it looks like a number
    try:
        part_name_converted = float(part_name)
    except ValueError:
        part_name_converted = part_name

    # Filter by title column
    mask = xyz_obj.flightlines["title"] == part_name_converted
    if not mask.any():
        return None

    # Create new XYZ object with filtered data
    filtered_data = xyz_obj.to_dict()
    filtered_data["flightlines"] = xyz_obj.flightlines[mask]

    # Filter layer_data to match filtered flightlines
    for key in filtered_data["layer_data"]:
        filtered_data["layer_data"][key] = filtered_data["layer_data"][key][mask]

    filtered_xyz = libaarhusxyz.XYZ(filtered_data)
    return {"xyz": filtered_xyz, "gex": xyz_data["gex"]}


def xyz_to_geojson(xyz_data, part_path=None):
    """
    Convert XYZ data to GeoJSON

    Args:
        xyz_data: Dict with 'xyz' and 'gex' keys
        part_path: Optional part path to filter by

    Returns:
        GeoJSON FeatureCollection dict
    """
    xyz_obj = xyz_data["xyz"]
    df = xyz_obj.flightlines

    if "x" not in df.columns or "y" not in df.columns:
        return {"type": "FeatureCollection", "features": []}

    features = []
    for i, row in df.iterrows():
        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [float(row["x"]), float(row["y"])]
            },
            "properties": {
                "dataset_id": None,  # To be filled by caller
                "index": i,
                "part": part_path or "all"
            }
        }
        features.append(feature)

    return {
        "type": "FeatureCollection",
        "features": features
    }
