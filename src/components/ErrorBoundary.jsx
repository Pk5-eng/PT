import { Component } from 'react';

/**
 * Last line of defence. Without this, any error thrown while rendering
 * unmounts the tree and leaves a blank white page, which tells the person
 * looking at it nothing at all.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled error:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="state">
        <p><strong>Something broke</strong></p>
        <p style={{ maxWidth: 520, margin: '0 auto' }}>{String(this.state.error.message ?? this.state.error)}</p>
        <p><button className="clear" onClick={() => window.location.reload()}>Reload</button></p>
      </div>
    );
  }
}
