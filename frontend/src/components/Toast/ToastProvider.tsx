/**
 * ToastProvider - owns the notification queue and exposes the toast API.
 *
 * Maintains an ordered queue of notifications. Up to {@link maxVisible}
 * toasts are shown at once; additional notifications wait in the queue and
 * are promoted automatically as visible toasts are dismissed. Each visible
 * toast with a positive duration is auto-dismissed via a timer; a duration
 * of 0 keeps it until dismissed manually (the default for errors and for
 * any toast carrying an action such as "Retry").
 *
 * Task 12.1 - Error notification system (frontend).
 * Requirements: 10.1, 10.2, 10.3, 10.5, 10.6
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ToastContext } from './ToastContext';
import { ToastContainer } from './ToastContainer';
import { getErrorToastContent } from './errorMessages';
import type {
  Toast,
  ToastContextValue,
  ToastOptions,
  ToastSeverity,
} from './types';

/** Default auto-dismiss durations (ms) per severity. */
const DEFAULT_DURATIONS: Record<ToastSeverity, number> = {
  // Errors stay until dismissed so the user can read and act on them.
  error: 0,
  warning: 8000,
  info: 6000,
  success: 4000,
};

export interface ToastProviderProps {
  children: ReactNode;
  /** Maximum number of toasts visible simultaneously (default 4). */
  maxVisible?: number;
}

/** Generate a reasonably unique toast id, with a fallback for older runtimes. */
function generateId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Provides the toast context to descendants and renders the toast
 * container overlay. Wrap the application (or the relevant subtree) in
 * this provider and consume it via {@link useToast}.
 */
export function ToastProvider({
  children,
  maxVisible = 4,
}: ToastProviderProps): ReactNode {
  // The full ordered queue: the first `maxVisible` entries are shown.
  const [items, setItems] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  const visible = useMemo(
    () => items.slice(0, maxVisible),
    [items, maxVisible],
  );

  const dismissToast = useCallback((id: string) => {
    const handle = timersRef.current.get(id);
    if (handle !== undefined) {
      window.clearTimeout(handle);
      timersRef.current.delete(id);
    }
    setItems((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const clearToasts = useCallback(() => {
    timersRef.current.forEach((handle) => window.clearTimeout(handle));
    timersRef.current.clear();
    setItems([]);
  }, []);

  const addToast = useCallback(
    (
      severity: ToastSeverity,
      message: string,
      options: ToastOptions = {},
    ): string => {
      const id = generateId();
      const hasAction = Boolean(options.action);
      // Toasts with an action default to sticky so the user can act on them.
      const duration =
        options.duration ??
        (hasAction ? 0 : DEFAULT_DURATIONS[severity]);

      const toast: Toast = {
        id,
        severity,
        message,
        title: options.title,
        suggestion: options.suggestion,
        action: options.action,
        duration,
        createdAt: Date.now(),
      };

      setItems((prev) => [...prev, toast]);
      return id;
    },
    [],
  );

  const showError = useCallback(
    (message: string, options?: ToastOptions) =>
      addToast('error', message, options),
    [addToast],
  );

  const showWarning = useCallback(
    (message: string, options?: ToastOptions) =>
      addToast('warning', message, options),
    [addToast],
  );

  const showInfo = useCallback(
    (message: string, options?: ToastOptions) =>
      addToast('info', message, options),
    [addToast],
  );

  const showSuccess = useCallback(
    (message: string, options?: ToastOptions) =>
      addToast('success', message, options),
    [addToast],
  );

  const showApiError = useCallback(
    (error: unknown, options: ToastOptions = {}): string => {
      const content = getErrorToastContent(error);
      return addToast('error', content.message, {
        title: options.title ?? content.title,
        suggestion: options.suggestion ?? content.suggestion,
        action: options.action,
        duration: options.duration,
      });
    },
    [addToast],
  );

  // Schedule auto-dismiss timers for visible toasts and tear down timers
  // for toasts that are no longer visible (dismissed or pushed back into
  // the queue beyond `maxVisible`).
  useEffect(() => {
    const currentlyVisible = items.slice(0, maxVisible);
    const visibleIds = new Set(currentlyVisible.map((toast) => toast.id));

    currentlyVisible.forEach((toast) => {
      if (toast.duration > 0 && !timersRef.current.has(toast.id)) {
        const handle = window.setTimeout(() => {
          timersRef.current.delete(toast.id);
          setItems((prev) => prev.filter((t) => t.id !== toast.id));
        }, toast.duration);
        timersRef.current.set(toast.id, handle);
      }
    });

    timersRef.current.forEach((handle, id) => {
      if (!visibleIds.has(id)) {
        window.clearTimeout(handle);
        timersRef.current.delete(id);
      }
    });
  }, [items, maxVisible]);

  // Clear all timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((handle) => window.clearTimeout(handle));
      timers.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts: visible,
      addToast,
      showError,
      showWarning,
      showInfo,
      showSuccess,
      showApiError,
      dismissToast,
      clearToasts,
    }),
    [
      visible,
      addToast,
      showError,
      showWarning,
      showInfo,
      showSuccess,
      showApiError,
      dismissToast,
      clearToasts,
    ],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={visible} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}
