'use client';

import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback: React.ReactNode;
  onError?: (message: string) => void;
  resetKeys: readonly unknown[];
}
interface State { error: Error | null }

// Remotion catches composition errors internally. Forward its fallback error
// to this boundary so corrected inputs can replace the failed Player too.
export function rethrowPlayerError({ error }: { error: Error }): never {
  throw error;
}

export default class DesignErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    console.error('[RemotionRenderer] ErrorBoundary caught:', error);
    this.props.onError?.(error.message);
  }
  componentDidUpdate(previous: Props, previousState: State) {
    if (this.state.error && previousState.error && (
      previous.resetKeys.length !== this.props.resetKeys.length
      || this.props.resetKeys.some((key, index) => !Object.is(key, previous.resetKeys[index]))
    )) {
      this.setState({ error: null });
    }
  }
  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}
