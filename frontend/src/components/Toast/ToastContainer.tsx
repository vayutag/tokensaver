/**
 * ToastContainer - fixed overlay that stacks visible notifications.
 *
 * Renders the queue of currently visible toasts in a region announced to
 * assistive technology. Returns nothing when there are no toasts so the
 * overlay does not trap pointer events.
 *
 * Task 12.1 - Error notification system (frontend).
 * Requirements: 10.1, 10.2, 10.3, 10.5, 10.6
 */

import type { ReactNode } from 'react';

import { Toast } from './Toast';
import './Toast.css';
import type { Toast as ToastModel } from './types';

export interface ToastContainerProps {
  toasts: ToastModel[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({
  toasts,
  onDismiss,
}: ToastContainerProps): ReactNode {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      className="toast-container"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
