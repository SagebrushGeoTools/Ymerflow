import React, { useState } from 'react'

TestFrontendWidget.title = 'Test Frontend Widget'

export default function TestFrontendWidget() {
  const [count, setCount] = useState(0)
  return (
    <div style={{ padding: '1rem' }}>
      <h5>Test Frontend Plugin Widget</h5>
      <p>Hello from the test frontend plugin!</p>
      <p>Button clicks: <strong>{count}</strong></p>
      <button onClick={() => setCount(c => c + 1)}>
        Click me
      </button>
    </div>
  )
}
