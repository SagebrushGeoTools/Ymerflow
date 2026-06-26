import React from 'react'

class HookBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error(`HookBoundary caught error in hook "${this.props.name}"`, error, info)
  }

  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}

export default HookBoundary
