/**
 * Spinner component for the MarkItDown Website frontend.
 *
 * A small, reusable loading indicator used both as the Suspense fallback for
 * lazy-loaded routes (code splitting, Task 15.3) and inline for async
 * operations. It is purely presentational and has no dependencies beyond CSS.
 *
 * Accessibility: the spinner exposes `role="status"` with an accessible label
 * so screen readers announce loading state (Requirements 16.1, 16.2).
 *
 * Task 15.3 - Implement loading indicators for async operations.
 * Task 16.1 - Frontend performance (Suspense fallback for route code-splitting).
 * Requirements: 12.1, 17.5, 16.1, 16.2
 */

import { memo } from 'react';

import styles from './Spinner.module.css';

export interface SpinnerProps {
  /** Visual size of the spinner. Defaults to `medium`. */
  size?: 'small' | 'medium' | 'large';
  /**
   * Accessible label announced to assistive technology and (when
   * `showLabel` is true) rendered visibly beneath the spinner.
   */
  label?: string;
  /** Render the label text visibly beneath the spinner. Defaults to false. */
  showLabel?: boolean;
  /**
   * Stretch the spinner to fill the routed content area and vertically
   * center it. Used for route-level Suspense fallbacks.
   */
  fullPage?: boolean;
}

/**
 * Render an animated loading indicator with an accessible status role.
 */
function SpinnerComponent({
  size = 'medium',
  label = 'Loading…',
  showLabel = false,
  fullPage = false,
}: SpinnerProps): JSX.Element {
  return (
    <div
      className={`${styles.wrapper} ${fullPage ? styles.fullPage : ''}`}
      role="status"
      aria-live="polite"
    >
      <span
        className={`${styles.spinner} ${styles[size]}`}
        aria-hidden="true"
      />
      {showLabel ? (
        <span className={styles.label}>{label}</span>
      ) : (
        <span className={styles.label} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
          {label}
        </span>
      )}
    </div>
  );
}

export const Spinner = memo(SpinnerComponent);

export default Spinner;
