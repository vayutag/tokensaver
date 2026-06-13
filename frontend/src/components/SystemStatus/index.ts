/**
 * Public entry point for the SystemStatus component.
 *
 * Usage:
 *   import { SystemStatus } from '@/components/SystemStatus';
 *
 *   // Self-managed (polls the backend health endpoint):
 *   <SystemStatus />
 *
 *   // Controlled (parent owns the health state):
 *   <SystemStatus status={status} loading={loading} error={error} />
 *
 * Task 18.1 - Add frontend status monitoring.
 * Requirements: 15.5, 15.6
 */

export { SystemStatus } from './SystemStatus';
export type { SystemStatusProps } from './SystemStatus';
