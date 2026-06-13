/**
 * SystemStatus component.
 *
 * Displays a compact, colour-coded indicator of the backend system status
 * driven by the health endpoint. It shows a coloured dot plus a label
 * (Healthy / Degraded / Unavailable / Checking) and, when the backend
 * reports a degraded or unavailable state, surfaces a warning message so
 * users understand that conversions may be slower or fail
 * (Requirements 15.5, 15.6).
 *
 * By default the component manages its own polling via
 * {@link useHealthCheck} (a check on mount plus periodic re-checks). For
 * testing or when a parent already owns the health state, the status,
 * loading flag, and error can be supplied via props instead.
 *
 * Task 18.1 - Add frontend status monitoring.
 * Requirements:
 *   15.5 - Display a status indicator based on the health endpoint response.
 *   15.6 - Warn the user when the backend reports a degraded state.
 */

import {
  useHealthCheck,
  type SystemStatus as SystemStatusValue,
} from '@/hooks/useHealthCheck';
import styles from './SystemStatus.module.css';

export interface SystemStatusProps {
  /**
   * Controlled status. When provided, the component renders this value and
   * does NOT run its own health check. Omit to let the component poll the
   * backend itself.
   */
  status?: SystemStatusValue;
  /** Controlled loading flag, used alongside a controlled {@link status}. */
  loading?: boolean;
  /** Controlled error message, used alongside a controlled {@link status}. */
  error?: string | null;
  /**
   * Polling interval (ms) forwarded to {@link useHealthCheck} when the
   * component manages its own state. Ignored when {@link status} is given.
   */
  pollIntervalMs?: number;
}

/** Presentation metadata for each status value. */
interface StatusMeta {
  label: string;
  /** Short description shown next to/under the label. */
  description: string;
  /** Whether this status warrants a user-facing warning. */
  warn: boolean;
}

const STATUS_META: Record<SystemStatusValue, StatusMeta> = {
  healthy: {
    label: 'All systems operational',
    description: 'The conversion service is running normally.',
    warn: false,
  },
  degraded: {
    label: 'Degraded performance',
    description:
      'The service is under heavy load or low on resources. Conversions may be slower than usual.',
    warn: true,
  },
  unavailable: {
    label: 'Service unavailable',
    description:
      'The conversion service cannot be reached right now. Please try again shortly.',
    warn: true,
  },
  unknown: {
    label: 'Checking status…',
    description: 'Determining the current system status.',
    warn: false,
  },
};

/** Map a status value onto its dot CSS modifier class. */
function dotClass(status: SystemStatusValue): string {
  switch (status) {
    case 'healthy':
      return styles.dotHealthy;
    case 'degraded':
      return styles.dotDegraded;
    case 'unavailable':
      return styles.dotUnavailable;
    case 'unknown':
    default:
      return styles.dotUnknown;
  }
}

export function SystemStatus({
  status: statusProp,
  loading: loadingProp,
  error: errorProp,
  pollIntervalMs,
}: SystemStatusProps = {}) {
  const isControlled = statusProp !== undefined;

  // Always call the hook to satisfy the rules of hooks; disable its own
  // work when the component is operating in controlled mode.
  const internal = useHealthCheck({
    pollIntervalMs,
    checkOnMount: !isControlled,
  });

  const status: SystemStatusValue = isControlled ? statusProp : internal.status;
  const loading = isControlled ? Boolean(loadingProp) : internal.loading;
  const error = isControlled ? (errorProp ?? null) : internal.error;

  const meta = STATUS_META[status];
  const showSpinner = loading && status === 'unknown';

  return (
    <div className={styles.container}>
      <div
        className={styles.indicator}
        role="status"
        aria-live="polite"
        data-status={status}
      >
        <span
          className={`${styles.dot} ${dotClass(status)} ${
            showSpinner ? styles.dotPulsing : ''
          }`}
          aria-hidden="true"
        />
        <span className={styles.label}>{meta.label}</span>
        <span className={styles.srOnly}>{`System status: ${meta.label}.`}</span>
      </div>

      {meta.warn && (
        <div
          className={`${styles.warning} ${
            status === 'unavailable'
              ? styles.warningUnavailable
              : styles.warningDegraded
          }`}
          role="alert"
          data-testid="system-status-warning"
        >
          <span className={styles.warningIcon} aria-hidden="true">
            ⚠️
          </span>
          <span className={styles.warningText}>
            {meta.description}
            {error ? ` (${error})` : ''}
          </span>
        </div>
      )}
    </div>
  );
}

export default SystemStatus;
