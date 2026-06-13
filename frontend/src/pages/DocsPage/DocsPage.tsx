/**
 * DocsPage.
 *
 * Hosts the {@link DocumentationViewer} populated with the project's
 * documentation content ({@link DOCUMENTATION_SECTIONS}). The viewer owns
 * its own navigation, table of contents, search, and hash-based deep
 * linking, so this page simply supplies the content and a page frame.
 *
 * Task 19.1 - Integrate DocumentationViewer with routing.
 * Requirements: 9.1
 */

import { DocumentationViewer } from '@/components/DocumentationViewer';
import { DOCUMENTATION_SECTIONS } from '@/data/documentation';

import styles from './DocsPage.module.css';

export function DocsPage(): JSX.Element {
  return (
    <div className={styles.page}>
      <DocumentationViewer sections={DOCUMENTATION_SECTIONS} />
    </div>
  );
}

export default DocsPage;
