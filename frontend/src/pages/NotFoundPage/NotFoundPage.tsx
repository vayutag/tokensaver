/**
 * NotFoundPage.
 *
 * Fallback page rendered for any route that does not match a known path.
 * Offers a clear way back to the home page.
 *
 * Task 19.2 - Create landing page and navigation.
 * Requirements: 17.1
 */

import { Link } from 'react-router-dom';

import styles from './NotFoundPage.module.css';

export function NotFoundPage(): JSX.Element {
  return (
    <div className={styles.page}>
      <p className={styles.code}>404</p>
      <h1 className={styles.title}>Page not found</h1>
      <p className={styles.text}>
        The page you're looking for doesn't exist or has moved.
      </p>
      <Link to="/" className={styles.cta}>
        Back to home
      </Link>
    </div>
  );
}

export default NotFoundPage;
