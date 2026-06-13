/**
 * NavHeader component.
 *
 * The application's primary navigation bar. Renders the site brand plus
 * links to the three top-level pages (Home, Converter, Docs) using
 * react-router `NavLink`s so the active route is highlighted. The compact
 * {@link SystemStatus} indicator is surfaced here so users can see backend
 * health at a glance from any page (Requirements 15.5, 15.6).
 *
 * The header is responsive: on narrow viewports the navigation collapses
 * behind a toggle button (Requirements 17.1, 17.2).
 *
 * Task 19.2 - Create landing page and navigation.
 * Requirements: 9.1, 17.1
 */

import { useCallback, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';

import { SystemStatus } from '@/components/SystemStatus';

import styles from './NavHeader.module.css';

/** The top-level navigation destinations. */
const NAV_LINKS: ReadonlyArray<{ to: string; label: string; end?: boolean }> = [
  { to: '/', label: 'Home', end: true },
  { to: '/convert', label: 'Converter' },
  { to: '/docs', label: 'Docs' },
];

export function NavHeader(): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const toggleMenu = useCallback(() => setMenuOpen((open) => !open), []);

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link to="/" className={styles.brand} onClick={closeMenu}>
          <span className={styles.brandMark} aria-hidden="true">
            ⬇
          </span>
          <span className={styles.brandText}>TokenSaver</span>
        </Link>

        <button
          type="button"
          className={styles.menuToggle}
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          aria-label="Toggle navigation menu"
          onClick={toggleMenu}
        >
          <span className={styles.menuIcon} aria-hidden="true">
            {menuOpen ? '✕' : '☰'}
          </span>
        </button>

        <nav
          id="primary-navigation"
          className={`${styles.nav} ${menuOpen ? styles.navOpen : ''}`}
          aria-label="Primary"
        >
          <ul className={styles.navList}>
            {NAV_LINKS.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
                  }
                  onClick={closeMenu}
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <div className={styles.status}>
            <SystemStatus />
          </div>
        </nav>
      </div>
    </header>
  );
}

export default NavHeader;
