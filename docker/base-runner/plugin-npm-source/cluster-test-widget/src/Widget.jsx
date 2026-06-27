import React, { useState } from 'react'

ClusterTestWidget.title = 'Cluster Test Widget'

export default function ClusterTestWidget() {
  const [count, setCount] = useState(0)
  return (
    <div style={{ padding: '1rem' }}>
      <h5>Cluster Test Widget</h5>
      <p>Built in-cluster by the <code>build_frontend_plugin</code> Process from an npm source baked into the runner image.</p>
      <p>Button clicks: <strong>{count}</strong></p>
      <button onClick={() => setCount(c => c + 1)}>Click me</button>
    </div>
  )
}
