/**
 * Type definitions for the Toast notification system.
 *
 * The Toast system surfaces transient, user-facing feedback for the
 * MarkItDown Website: validation failures, conversion errors, network
 * problems, timeouts, and success confirmations. Notifications support
 * multiple severities, auto-dismiss, manual dismiss, and an optional
 * action button (e.g. "Retry") wired to a callback.
 *
 * Task 12.1 - Error notification system (frontend).
 * Requirements: 10.1, 10.2, 10.3, 10.5, 10.6
 */

/**
 * Visual/semantic severity of a notification. Drives colour, icon, and
 * the default auto-dismiss duration.
 */
export type ToastSeverity = 'error' | 'warning' | 'info' | 'success';

/**
 * An optional action rendered as a button within a toast, used to offer
 * a retry of a failed operation (Requirement 10.6) or any other callback.
 */
export interface ToastAction {
  /** Button label, e.g. "Retry". */
  label: string;
  /**
   * Invoked when the action button is clicked. May be async; while a
   * returned promise is pending the button is disabled. The toast is
   * dismissed automatically once the action settles unless
   * {@link keepOpenOnAction} is set.
   */
  onClick: () => void | Promise<void>;
  /** When true, the toast remains visible after the action runs. */
  keepOpenOnAction?: boolean;
}

/**
 * A fully-resolved notification held in the provider's state.
 */
export interface Toast {
  /** Unique identifier used for dismissal and React keys. */
  id: string;
  /** Severity controlling appearance and default behaviour. */
  severity: ToastSeverity;
  /** Primary message shown to the user. */
  message: string;
  /** Optional bold heading shown above the message. */
  title?: string;
  /**
   * Optional supplementary guidance shown beneath the message, e.g. a
   * suggestion to try a smaller file after a timeout (Requirement 10.5).
   */
  suggestion?: string;
  /** Optional action button (e.g. retry). */
  action?: ToastAction;
  /**
   * Auto-dismiss delay in milliseconds. A value of 0 disables
   * auto-dismiss so the toast stays until dismissed manually.
   */
  duration: number;
  /** Creation timestamp (ms epoch), used for ordering. */
  createdAt: number;
}

/**
 * Options accepted when enqueuing a notification. All fields are
 * optional; sensible defaults are applied per severity.
 */
export interface ToastOptions {
  /** Optional bold heading. */
  title?: string;
  /** Optional supplementary guidance shown beneath the message. */
  suggestion?: string;
  /** Optional action button (e.g. retry). */
  action?: ToastAction;
  /**
   * Override the auto-dismiss delay in milliseconds. Pass 0 to require
   * manual dismissal (the default for errors).
   */
  duration?: number;
}

/**
 * Public API exposed by {@link useToast}.
 */
export interface ToastContextValue {
  /** Currently visible toasts, oldest first. */
  toasts: Toast[];
  /**
   * Enqueue a notification with an explicit severity. Returns the
   * generated toast id so callers can dismiss it programmatically.
   */
  addToast: (
    severity: ToastSeverity,
    message: string,
    options?: ToastOptions,
  ) => string;
  /** Convenience wrapper for an `error` severity toast. */
  showError: (message: string, options?: ToastOptions) => string;
  /** Convenience wrapper for a `warning` severity toast. */
  showWarning: (message: string, options?: ToastOptions) => string;
  /** Convenience wrapper for an `info` severity toast. */
  showInfo: (message: string, options?: ToastOptions) => string;
  /** Convenience wrapper for a `success` severity toast. */
  showSuccess: (message: string, options?: ToastOptions) => string;
  /**
   * Enqueue an error toast from a thrown value, mapping {@link ApiError}
   * kinds onto user-friendly messages and suggestions
   * (Requirements 10.1, 10.2, 10.3, 10.5).
   */
  showApiError: (error: unknown, options?: ToastOptions) => string;
  /** Dismiss a single toast by id. */
  dismissToast: (id: string) => void;
  /** Dismiss every visible and queued toast. */
  clearToasts: () => void;
}
