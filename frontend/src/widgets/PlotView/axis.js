// Axis type definitions for PlotView
// Each axis type encapsulates both unit and usage (e.g., distance vs depth)
// and includes all Plotly axis configuration

const AXIS_TYPES = {
  // Distance axis (meters) - used for flightline position
  xdist_m: {
    title: "Distance (m)",
    type: "linear"
  },

  // Longitude axis (degrees)
  lon_deg: {
    title: "Longitude (°)",
    type: "linear"
  },

  // Latitude axis (degrees)
  lat_deg: {
    title: "Latitude (°)",
    type: "linear"
  },

  // Absolute dB/dt values (picoTesla)
  dbdt_abs_pT: {
    title: "|dB/dt| (pT)",
    type: "log"
  }
};

export default AXIS_TYPES;
