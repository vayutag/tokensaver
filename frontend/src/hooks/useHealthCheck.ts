/**
 * System health monitoring hook for the MarkItDown Website frontend.
 *
 * `useHealthCheck` queries the backend health endpoint
 * ({@link getHealth}) once on mount and then re-checks it on a fixed
 * interval so the UI can surface the current system status and warn the
 * user when the backend reports a degraded or unavailable state
 * (Requirements 15.5, 15.6).
 *
 * The hook is UI-agnostic: it exposes the latest {@link HealthResponse},
 * a derived {@link SystemStatus}, loading/error flags, and an imperative
 * `refresh` action, leaving presentation to consumers (e.g. SystemStatus).
 *
 * Network failures are surfaced as the `unavailable` status rather than
 * thrown, so the indicator can keep reflecting reality across connectivity
 * blips. The underlying {@link getHealth} call already retries transient
 * failures with backoff.
 *
 * Task 18.1 - Add frontend status monitoring.
 * Requirements: 15.5, 15.6
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, getHealth } from '@/services/api';
import { HEALTH_CHECK_POLL_INTERVAL_MS } from '@/constants/index';
import type { HealthResponse } from '@/types/index';

/**
 * The system status as understood by the frontend indicator.
 *
 * Mirrors {@link HealthResponse.status} but adds `unknown`, used before
 * the first successful check completes.
 */
export type SystemStatus =
  | 'healthy'
  | 'degraded'
  | 'unavailable'
  | 'unknown';

/** Configuration accepted by {@link useHealthCheck}. */
export interface UseHealthCheckOptions {
  /**
   * Interval (ms) between automatic health checks. Defaults to
   * {@link HEALTH_CHECK_POLL_INTERVAL_MS}. A value `<= 0` disables polling
   * (a single check still runs on mount).
   */
  pollIntervalMs?: number;
  /**
   * Whether to run an immediate check on mount. Defaults to `true`.
   */
  checkOnMount?: boolean;
}

/** Public surface returned by {@link useHealthCheck}. */
export interface UseHealthCheckResult {
  /** The latest successful health response, or `null` before one arrives. */
  health: HealthResponse | null;
  /** Derived status used by the indicator (`unknown` until first result). */
  status: SystemStatus;
  /** True while a check is in flight and no result has arrived yet. */
  loading: boolean;
  /** Error message from the most recent failed check, when applicable. */
  error: string | null;
  /** True when the backend reports a degraded or unavailable state. */
  isDegraded: boolean;
  /** Imperatively trigger a health check (e.g. a manual "retry"). */
  refresh: () => void;
}

/** Build a user-facing message from an unknown thrown value. */
function toErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unable to determine system status.';
}

/**
 * Poll the backend health endpoint and expose the current system status.
 */
export function useHealthCheck(
  options: UseHealthCheckOptions = {},
): UseHealthCheckResult {
  const {
    pollIntervalMs = HEALTH_CHECK_POLL_INTERVAL_MS,
    checkOnMount = true,
  } = options;

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [status, setStatus] = useState<SystemStatus>('unknown');
  const [loading, setLoading] = useState<boolean>(checkOnMount);
  const [error, setError] = useState<string | null>(null);

  // Guard against state updates after unmount and overlapping checks.
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  const check = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    setLoading(true);

    try {
      const result = await getHealth();
      if (!mountedRef.current) {
        return;
      }
      setHealth(result);
      setStatus(result.status);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) {
        return;
      }
      // A failed health check means we cannot reach the backend; treat the
      // system as unavailable so the indicator reflects reality (15.6).
      setStatus('unavailable');
      setError(toErrorMessage(err));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
      inFlightRef.current = false;
    }
  }, []);

  const refresh = useCallback(() => {
    void check();
  }, [check]);

  useEffect(() => {
    mountedRef.current = true;

    if (checkOnMount) {
      void check();
    }

    let intervalId: ReturnType<typeof setInterval> | undefined;
    if (pollIntervalMs > 0) {
      intervalId = setInterval(() => {
        void check();
      }, pollIntervalMs);
    }

    return () => {
      mountedRef.current = false;
      if (intervalId !== undefined) {
        clearInterval(intervalId);
      }
    };
  }, [check, checkOnMount, pollIntervalMs]);

  const isDegraded = status === 'degraded' || status === 'unavailable';

  return {
    health,
    status,
    loading,
    error,
    isDegraded,
    refresh,
  };
}

export default useHealthCheck;
