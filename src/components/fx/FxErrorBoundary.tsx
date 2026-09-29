"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Key = string | number | null | undefined;
type Props = { children: ReactNode; resetKey?: Key };
type State = { failed: boolean; recorded: boolean; failedKey: Key };

// Decoration must never take the table down: a crash anywhere in the dice or
// cinematic layer hides that layer instead of unmounting the whole session.
// A new `resetKey` (the next roll, the next fight) gives it another try.
export class FxErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, recorded: false, failedKey: undefined };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true, recorded: false };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (!state.failed) return null;
    // Remember which key the crash happened under; retry once it moves on.
    if (!state.recorded) return { recorded: true, failedKey: props.resetKey };
    if (props.resetKey !== state.failedKey) return { failed: false, recorded: false, failedKey: undefined };
    return null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("[fx] overlay crashed and was hidden", error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
