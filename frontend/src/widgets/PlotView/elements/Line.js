export default {
  x_unit: "s",
  y_unit: "V",
  parameters: {
    color: { type: "string", default: "blue" },
    scale: { type: "number", default: 1 },
    dataset: { type: "string" }
  },
  render: ({ params, dataset }) => ({
    x: dataset.x,
    y: dataset.y.map(v => v * params.scale),
    type: "scatter",
    mode: "lines",
    name: params.dataset,
    line: { color: params.color }
  })
};
