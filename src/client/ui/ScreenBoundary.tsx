import { Component, Suspense, type ReactNode } from 'react';

// Old tabs can request a chunk removed by a deployment. Never reload
// automatically: a screen elsewhere in the app may still have an unsaved draft.
export class ScreenBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div role="alert">
          <p>
            This screen couldn’t load. Reload the app to try again. Unsaved
            changes will be lost.
          </p>
          <button type="button" onClick={() => location.reload()}>
            Reload app
          </button>
        </div>
      );
    return (
      <Suspense fallback={<p role="status">Loading screen…</p>}>
        {this.props.children}
      </Suspense>
    );
  }
}
