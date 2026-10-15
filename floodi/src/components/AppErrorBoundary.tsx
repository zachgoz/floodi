import React from 'react';
import { reportClientError } from 'src/lib/errorReporting';
import './AppErrorBoundary.css';

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error) {
    reportClientError('react_render_error', error, { provider: 'app' });
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="app-error-recovery" role="alert">
          <h1>FloodCast couldn’t load</h1>
          <p>Reload to try again.</p>
          <button type="button" onClick={() => window.location.reload()}>Reload FloodCast</button>
        </main>
      );
    }
    return this.props.children;
  }
}
