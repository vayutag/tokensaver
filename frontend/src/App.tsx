/**
 * Root application component.
 *
 * Wires the whole frontend together:
 * - Wraps the app in {@link ToastProvider} so any component can surface
 *   error/success notifications via `useToast` (Requirements 10.1-10.6).
 * - Defines client-side routes inside the shared {@link Layout} (nav header
 *   + footer): the landing page (`/`), the converter (`/convert`), and the
 *   documentation viewer (`/docs`), with a catch-all 404.
 *
 * Performance: the page components are loaded lazily with `React.lazy` and
 * rendered inside a `Suspense` boundary (with a {@link Spinner} fallback).
 * This splits the heavy markdown-rendering / syntax-highlighting vendor code
 * out of the initial bundle so it is only fetched on the routes that need it
 * (the converter and documentation pages), improving first-load time
 * (Requirements 12.1, 17.5).
 *
 * Routing is provided by the `BrowserRouter` set up in `main.tsx`.
 *
 * Task 19.1 / 19.2 - Final integration, landing page, and navigation.
 * Task 15.3 / 16.1 - Lazy route loading, code splitting, loading indicators.
 * Requirements: 1.1 through 17.5, 9.1, 17.1, 12.1, 17.5
 */

import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';

import { Layout } from '@/components/Layout';
import { Spinner } from '@/components/Spinner';
import { ToastProvider } from '@/components/Toast';

// Lazily-loaded route components. Each becomes its own bundle chunk so the
// markdown/syntax-highlighter vendor code only downloads on the routes that
// render it (the converter and documentation pages).
const HomePage = lazy(() => import('@/pages/HomePage'));
const ConverterPage = lazy(() => import('@/pages/ConverterPage'));
const DocsPage = lazy(() => import('@/pages/DocsPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route
            path="/"
            element={
              <Suspense fallback={<Spinner fullPage label="Loading page…" />}>
                <HomePage />
              </Suspense>
            }
          />
          <Route
            path="/convert"
            element={
              <Suspense fallback={<Spinner fullPage label="Loading converter…" />}>
                <ConverterPage />
              </Suspense>
            }
          />
          <Route
            path="/docs"
            element={
              <Suspense fallback={<Spinner fullPage label="Loading documentation…" />}>
                <DocsPage />
              </Suspense>
            }
          />
          <Route
            path="*"
            element={
              <Suspense fallback={<Spinner fullPage label="Loading…" />}>
                <NotFoundPage />
              </Suspense>
            }
          />
        </Route>
      </Routes>
    </ToastProvider>
  );
}

export default App;
