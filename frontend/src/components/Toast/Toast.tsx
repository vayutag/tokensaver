/**
 * Toast - presentational component for a single notification.
 *
 * Renders an accessible alert with a severity icon, optional title,
 * message, optional suggestion, an optional action button (e.g. "Retry",
 * Requirement 10.6), and a manual dismiss control. Async actions disable
 * the button while pending and dismiss the toast once they settle (unless
 * the action opts to stay open).
 *
 * Task 12.1 - Error notification system (frontend).
 * Requirements: 10.1, 10.2, 10.3, 10.5, 10.6
 */

import { useState, type ReactNode } from 'react';

import type { Toast as ToastModel, ToastSeverity } from './types';

export interface ToastProps {
  toast: ToastModel;
  /** Invoked to dismiss this toast by id. */
  onDismiss: (id: string) => void;
}

/** Unicode glyphs used as lightweight, dependency-free severity icons. */
const SEVERITY_ICON: Record<ToastSeverity, string> = {
  error: '\u2715', // ✕
  warning: '\u26A0', // ⚠
  info: '\u2139', // ℹ
  success: '\u2713', // ✓
};

/** Screen-reader role/politeness per severity. */
function ariaProps(severity: ToastSeverity): {
  role: 'alert' | 'status';
  'aria-live': 'assertive' | 'polite';
} {
  if (severity === 'error' || severity === 'warning') {
    return { role: 'alert', 'aria-live': 'assertive' };
  }
  return { role: 'status', 'aria-live': 'polite' };
}

export function Toast({ toast, onDismiss }: ToastProps): ReactNode {
  const [isActionRunning, setIsActionRunning] = useState(false);
  const { id, severity, title, message, suggestion, action } = toast;

  const handleAction = async (): Promise<void> => {
    if (!action || isActionRunning) {
      return;
    }
    try {
      setIsActionRunning(true);
      await action.onClick();
      if (!action.keepOpenOnAction) {
        onDismiss(id);
      }
    } finally {
      setIsActionRunning(false);
    }
  };

  return (
    <div
      className={`toast toast--${severity}`}
      {...ariaProps(severity)}
    >
      <span className="toast__icon" aria-hidden="true">
        {SEVERITY_ICON[severity]}
      </span>
      <div className="toast__body">
        {title ? <p className="toast__title">{title}</p> : null}
        <p className="toast__message">{message}</p>
        {suggestion ? (
          <p className="toast__suggestion">{suggestion}</p>
        ) : null}
        {action ? (
          <div className="toast__actions">
            <button
              type="button"
              className="toast__action-button"
              onClick={handleAction}
              disabled={isActionRunning}
            >
              {isActionRunning ? 'Working…' : action.label}
            </button>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="toast__dismiss"
        onClick={() => onDismiss(id)}
        aria-label="Dismiss notification"
      >
        <span aria-hidden="true">{'\u00D7'}</span>
      </button>
    </div>
  );
}
