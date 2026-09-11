"use client";

import * as React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportError } from "@/lib/error-report";

interface ErrorBoundaryProps {
  /**
   * Render-prop or static node. The boundary renders this; on an uncaught
   * error in the subtree it falls back to the friendly error card.
   */
  children: React.ReactNode;
  /**
   * Optional label surfaced to the user as the failing area (e.g. "Clients
   * view"). Falls back to "this section" when not provided.
   */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * In-app error boundary.
 *
 * Catches unhandled errors anywhere in its subtree, reports the error to
 * Sentry (via `reportError`) and renders a calm, glassmorphic fallback card
 * in place of the failed component. NOT a full-screen overlay — the rest of
 * the layout (header, sidebar, footer) remains visible so the broker can
 * still navigate away.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Forward to console + Sentry (no-op when DSN unset / non-production).
    reportError(error, {
      component: "ErrorBoundary",
      label: this.props.label,
      componentStack: info.componentStack,
    });
  }

  private handleReload = (): void => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  private handleDismiss = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    const { error } = this.state;
    const { label } = this.props;

    if (!error) return this.props.children;

    const area = label ?? "this section";

    return (
      <div className="flex min-h-[40vh] w-full items-center justify-center p-4 sm:p-6">
        <div
          role="alert"
          aria-live="assertive"
          className="glass hover-lift w-full max-w-md rounded-2xl p-6 sm:p-8 text-center"
        >
          {/* Icon badge */}
          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/30">
            <AlertCircle
              className="size-7 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
          </div>

          {/* Calm copy — never alarming */}
          <h2 className="text-lg font-semibold text-foreground">
            Something went wrong
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            We hit an unexpected snag while loading {area}. Our team has been
            notified — you can safely reload to try again.
          </p>

          {/* Truncated, non-technical message for power users */}
          {error.message ? (
            <p
              className="mt-3 break-words rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground"
              title={error.message}
            >
              {error.message.length > 140
                ? `${error.message.slice(0, 140)}…`
                : error.message}
            </p>
          ) : null}

          {/* Actions */}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button
              type="button"
              onClick={this.handleReload}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Reload page
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={this.handleDismiss}
              className="border-border text-foreground hover:bg-accent"
            >
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
