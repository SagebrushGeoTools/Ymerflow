# External Libraries Documentation

This document provides information about external libraries used in this project for handling geophysical data formats.

## MessagePack Libraries

### msgpack-lite (JavaScript)
A JavaScript library for MessagePack serialization - a binary format that's more compact and faster than JSON.

**npm package:** `msgpack-lite`

**Usage:**
```javascript
import msgpack from 'msgpack-lite';

// Encoding
const binary = msgpack.encode(data);

// Decoding
const data = msgpack.decode(binary);
```

### msgpack-numpy (Python)
A Python library that extends msgpack to efficiently serialize/deserialize NumPy arrays while preserving their types, shapes, and byte order.

**pip package:** `msgpack-numpy`

**Usage:**
```python
import msgpack
import msgpack_numpy as m

# Serializing NumPy arrays
data = {'array': np.array([1, 2, 3])}
packed = msgpack.packb(data, default=m.encode)

# Deserializing
unpacked = msgpack.unpackb(packed, object_hook=m.decode)
```

### msgpack-numpy-js (JavaScript)
A JavaScript companion library to msgpack-numpy. It allows serialization and deserialization of the same msgpack extension type and format to/from JavaScript typed arrays.

**npm package:** `msgpack-numpy-js`
**Documentation:** https://github.com/emerald-geomodelling/msgpack-numpy-js

**High-level API:**
```javascript
import { packBinary, unpackBinary } from "msgpack-numpy-js";

// Pack typed array to binary msgpack
var data = new Uint32Array([1, 2, 3]);
var binary = packBinary(data);

// Unpack binary msgpack to typed array
var data2 = unpackBinary(binary);
```

**Lower-level API:**
```javascript
import { packNumpy, unpackNumpy } from "msgpack-numpy-js";
import msgpack from "msgpack-lite";

var data = new Uint32Array([1, 2, 3]);
var binary = msgpack.encode(packNumpy(data), {
    codec: msgpack.createCodec({ usemap: true, binarraybuffer: true }),
});
var data2 = unpackNumpy(msgpack.decode(binary));
```

**Key Features:**
- Handles typed array serialization compatible with Python's msgpack-numpy
- Works across typed array types (Float64Array, Int32Array, Uint32Array, etc.)
- Integrates with msgpack-lite for encoding/decoding operations

**Data Flow:**
```
Python Backend:                    JavaScript Frontend:
NumPy arrays                       Typed arrays
    ↓                                  ↑
msgpack-numpy                      msgpack-numpy-js
    ↓                                  ↑
Binary MessagePack ←────────────→ Binary MessagePack
```

## Geophysical Data Libraries

### libaarhusxyz (Python)
A library to read and write multiple common "XYZ" formats - text formats similar to CSV but with headers, used for interchange of geophysical data, especially AEM (Airborne Electromagnetic Methods).

**pip package:** `libaarhusxyz`
**Documentation:** https://github.com/emerald-geomodelling/libaarhusxyz

**Supported Formats:**
- Aarhus Workbench XYZ formats (all import and export formats)
- SkyTEM XYZ formats
- Export to GeoJSON and VTK

**Data Structure:**
Internally represents data as:
- **Main DataFrame** (`flightlines`): One row per sounding with metadata
  - Columns: lat, lon, timestamp, topography, sensor altitude, line number, etc.
- **Layer Data** (`layer_data`): Dictionary of DataFrames
  - Keys: channel names
  - Values: DataFrames with columns representing sensor series, timeseries, or depth measurements
  - All DataFrames have same length as flightlines

**XYZ Class API:**

```python
import libaarhusxyz

# Load from file
model = libaarhusxyz.XYZ("synthetic_model.xyz")

# Access metadata
model.info  # Returns dict with metadata like {'source': 'synthetic_model.xyz'}
model.info["Modified by"] = "User"  # Can add custom fields

# Access flightline data (main DataFrame)
model.flightlines  # DataFrame with columns: xdist, x, y, interface_depth,
                   # line_no, elevation, tx_alt, etc.

# Access layer data (dict of DataFrames)
model.layer_data.keys()  # Returns dict_keys(['resistivity', 'dep_top', 'dep_bot'])
model.layer_data["resistivity"]  # Returns DataFrame (soundings x layers)

# Modify data
model.layer_data["resistivity"] = np.log10(model.layer_data["resistivity"])

# Save/export
model.dump("output.xyz")  # Save to XYZ file
model.to_vtk("output.vtk")  # Export to VTK format
```

**MessagePack Export Format:**
libaarhusxyz can export data as msgpack with this structure:

```python
{
  "model_info": {"key": "value"},           # Metadata dictionary
  "flightlines": DataFrame,                  # Main data: lat/lon, timestamp, etc.
  "layer_data": {
    "channel_name": DataFrame                # Sensor/timeseries/depth data per channel
  }
}
```

DataFrames are serialized as dictionaries of columns using msgpack-numpy:
```python
{
  "column_name": numpy_array,  # Each column as NumPy array
  "column_name2": numpy_array
}
```

**On JavaScript frontend with msgpack-numpy-js:**
```javascript
{
  model_info: {key: "value"},
  flightlines: {
    lat: Float64Array,
    lon: Float64Array,
    timestamp: Float64Array,
    ...
  },
  layer_data: {
    channel_1: {
      depth: Float64Array,
      values: Float64Array,
      ...
    },
    channel_2: { ... }
  }
}
```

## Related Documentation

For implementation details in this project, see:
- `frontend/src/libaarhusxyz.js` - JavaScript implementation of XYZ class for msgpack format
- `frontend/src/dataset.js` - Dataset classes with caching and part management
