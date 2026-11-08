import { Component, type ReactNode } from 'react';

/** Keeps one broken widget from blanking the whole page: shows `fallback` instead. */
export default class SafeBox extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
