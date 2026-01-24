export default {
  x_unit: "s",
  y_unit: "V",
  parameters: {
    color: { type: "string", default: "red" },
    dataset: { type: "string" }
  },
  render: ({ params, dataset }) => ({
    x: dataset.x,
    y: dataset.y,
    type: "scatter",
    mode: "markers",
    name: params.dataset,
    marker: { color: params.color }
  })
};
