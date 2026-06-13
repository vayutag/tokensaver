/**
 * Maps thrown errors onto user-friendly toast content.
 *
 * Centralises the translation of {@link ApiError} kinds (and arbitrary
 * thrown values) into concise messages and recovery suggestions so the
 * notification UI presents consistent, non-technical guidance.
 *
 * Task 12.1 - Error notification system (frontend).
 * Requirements: 10.1, 10.2, 10.3, 10.5
 */

import { ApiError } from '@/services/api';

/**
 * The presentational content derived from an error: a title, the primary
 * message, and an optional supplementary suggestion.
 */
export interface ErrorToastContent {
  title?: string;
  message: string;
  suggestion?: string;
}

/**
 * Translate an unknown thrown value into user-facing toast content.
 *
 * - `network` errors yield a friendly connectivity message (Req 10.3).
 * - `timeout` errors yield a message plus a suggestion to try a smaller
 *   file or different format (Req 10.5).
 * - `http` errors (validation/conversion failures) surface the server's
 *   sanitized detail message (Req 10.1, 10.2).
 * - Anything else falls back to a generic message.
 */
export function getErrorToastContent(error: unknown): ErrorToastContent {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case 'network':
        return {
          title: 'Connection problem',
          message:
            'Unable to reach the server. Please check your internet connection and try again.',
        };
      case 'timeout':
        return {
          title: 'Conversion timed out',
          message:
            'The conversion took too long and was stopped.',
          suggestion:
            'Try again with a smaller file or a different format.',
        };
      case 'canceled':
        return {
          title: 'Request canceled',
          message: 'The operation was canceled.',
        };
      case 'http':
        return {
          title:
            error.status === 400
              ? 'Invalid request'
              : 'Conversion failed',
          message:
            error.message ||
            'The server could not process your request.',
        };
      case 'unknown':
      default:
        return {
          title: 'Something went wrong',
          message:
            error.message || 'An unexpected error occurred. Please try again.',
        };
    }
  }

  if (error instanceof Error && error.message) {
    return {
      title: 'Something went wrong',
      message: error.message,
    };
  }

  if (typeof error === 'string' && error.trim()) {
    return { message: error };
  }

  return {
    title: 'Something went wrong',
    message: 'An unexpected error occurred. Please try again.',
  };
}
