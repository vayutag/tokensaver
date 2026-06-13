/**
 * Service worker registration helper.
 *
 * Registers `public/sw.js` (served at `<base>sw.js`) to enable cache-first
 * caching of hashed static assets, improving repeat-visit load performance
 * (Task 16.1, Requirement 12.1).
 *
 * Registration only runs in production builds and when the browser supports
 * service workers. In development the worker is intentionally NOT registered
 * (and any previously-installed worker is removed) so it never interferes
 * with Vite's HMR / dev server.
 */

/** Register the service worker. Safe to call unconditionally. */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  // The worker lives at the app's public base path so it controls the whole
  // deployed scope (works for both root and sub-path deployments).
  const swUrl = `${import.meta.env.BASE_URL}sw.js`;

  if (!import.meta.env.PROD) {
    // Ensure no stale worker from a previous production build lingers while
    // developing locally.
    void unregisterServiceWorkers();
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(swUrl).catch(() => {
      // Registration failures are non-fatal: the app works without the worker.
    });
  });
}

/** Remove any registered service workers (used in development). */
async function unregisterServiceWorkers(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch {
    // Ignore — best-effort cleanup only.
  }
}
