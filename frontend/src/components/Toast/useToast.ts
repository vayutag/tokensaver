/**
 * `useToast` hook - access the Toast notification API.
 *
 * Must be used within a {@link ToastProvider}. Returns helpers for
 * enqueuing notifications of each severity, mapping API errors onto
 * friendly messages, and dismissing toasts.
 *
 * Task 12.1 - Error notification system (frontend).
 * Requirements: 10.1, 10.2, 10.3, 10.5, 10.6
 */

import { useContext } from 'react';

import { ToastContext } from './ToastContext';
import type { ToastContextValue } from './types';

/**
 * Access the toast API provided by {@link ToastProvider}.
 *
 * @throws {Error} when called outside of a {@link ToastProvider}.
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider.');
  }
  return context;
}
