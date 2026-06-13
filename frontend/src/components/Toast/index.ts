/**
 * Public entry point for the Toast notification system.
 *
 * Usage:
 *   import { ToastProvider, useToast } from '@/components/Toast';
 *
 *   // Near the app root:
 *   <ToastProvider><App /></ToastProvider>
 *
 *   // In any descendant:
 *   const { showError, showApiError, showSuccess } = useToast();
 *
 * Task 12.1 - Error notification system (frontend).
 * Requirements: 10.1, 10.2, 10.3, 10.5, 10.6
 */

export { ToastProvider } from './ToastProvider';
export type { ToastProviderProps } from './ToastProvider';
export { useToast } from './useToast';
export { Toast } from './Toast';
export { ToastContainer } from './ToastContainer';
export { getErrorToastContent } from './errorMessages';
export type { ErrorToastContent } from './errorMessages';
export type {
  Toast as ToastModel,
  ToastAction,
  ToastContextValue,
  ToastOptions,
  ToastSeverity,
} from './types';
