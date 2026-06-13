/**
 * React context backing the Toast notification system.
 *
 * Kept in its own module (separate from the provider component and the
 * hook) so consumers can import the context value type without pulling in
 * the provider, and to keep React Fast Refresh boundaries clean.
 *
 * Task 12.1 - Error notification system (frontend).
 * Requirements: 10.1, 10.2, 10.3, 10.5, 10.6
 */

import { createContext } from 'react';

import type { ToastContextValue } from './types';

/**
 * Context holding the toast API. Defaults to `null` so {@link useToast}
 * can detect usage outside of a {@link ToastProvider} and fail loudly.
 */
export const ToastContext = createContext<ToastContextValue | null>(null);
