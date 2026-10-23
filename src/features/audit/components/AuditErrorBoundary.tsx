import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert } from "@mantine/core";

export class AuditErrorBoundary extends Component<
  { children: ReactNode; fallback: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Audit view failed", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <Alert color="red" title={this.props.fallback}>
          {this.state.error.message}
        </Alert>
      );
    }
    return this.props.children;
  }
}
