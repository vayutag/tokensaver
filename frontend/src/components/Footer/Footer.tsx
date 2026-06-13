/**
 * Footer component.
 *
 * Site-wide footer with internal navigation links and a short tagline.
 * External links open in a new tab with `rel="noopener noreferrer"`.
 *
 * Task 19.2 - Create landing page and navigation.
 * Requirements: 9.1, 17.1
 */

import { Link } from 'react-router-dom';

import styles from './Footer.module.css';

export function Footer(): JSX.Element {
  const year = new Date().getFullYear();

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brandColumn}>
          <span className={styles.brand}>TokenSaver</span>
          <p className={styles.tagline}>
            Convert documents to clean, LLM-ready Markdown right from your
            browser.
          </p>
        </div>

        <nav className={styles.column} aria-label="Site">
          <h2 className={styles.columnTitle}>Site</h2>
          <ul className={styles.linkList}>
            <li>
              <Link className={styles.link} to="/">
                Home
              </Link>
            </li>
            <li>
              <Link className={styles.link} to="/convert">
                Converter
              </Link>
            </li>
            <li>
              <Link className={styles.link} to="/docs">
                Documentation
              </Link>
            </li>
          </ul>
        </nav>
      </div>

      <div className={styles.bottom}>
        <p className={styles.copyright}>© {year} TokenSaver</p>
      </div>
    </footer>
  );
}

export default Footer;
