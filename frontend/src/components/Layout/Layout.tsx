/**
 * Layout component.
 *
 * The application shell shared across every route: a sticky navigation
 * header, the routed page content (rendered via react-router's
 * {@link Outlet}), and a site-wide footer. A "skip to content" link is
 * provided for keyboard and screen-reader users (Requirement 16.1).
 *
 * Task 19.1 / 19.2 - Integrate components, create navigation and layout.
 * Requirements: 9.1, 16.1, 17.1
 */

import { Outlet } from 'react-router-dom';

import { Footer } from '@/components/Footer';
import { NavHeader } from '@/components/NavHeader';

import styles from './Layout.module.css';

export function Layout(): JSX.Element {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">
        Skip to main content
      </a>
      <NavHeader />
      <main id="main-content" className={styles.main} tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

export default Layout;
