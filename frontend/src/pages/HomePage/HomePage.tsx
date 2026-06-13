/**
 * HomePage.
 *
 * The marketing landing page. Presents a hero with the primary call to
 * action (start converting), a grid of feature highlights, a list of
 * supported formats, and a closing call to action. All internal links use
 * react-router so navigation stays client-side (Requirements 9.1, 17.1).
 *
 * Task 19.2 - Create landing page and navigation.
 * Requirements: 9.1, 17.1
 */

import { Link } from 'react-router-dom';

import { SUPPORTED_FORMAT_LABELS } from '@/constants/index';

import styles from './HomePage.module.css';

/** Feature highlights shown in the landing page grid. */
const FEATURES: ReadonlyArray<{
  icon: string;
  title: string;
  description: string;
}> = [
  {
    icon: '⚡',
    title: 'Fast, in-browser conversion',
    description:
      'Drag and drop a file and get clean Markdown back in seconds. No installs, no sign-up.',
  },
  {
    icon: '📦',
    title: 'Batch processing',
    description:
      'Convert several files at once and download them all together as a single archive.',
  },
  {
    icon: '🧩',
    title: 'Broad format support',
    description:
      'PDF, Word, PowerPoint, Excel, images, audio, and HTML — all converted to GitHub Flavored Markdown.',
  },
  {
    icon: '✨',
    title: 'Cloud-enhanced quality',
    description:
      'Opt into Azure AI services for higher-fidelity extraction on complex or scanned documents.',
  },
  {
    icon: '🔒',
    title: 'Private by design',
    description:
      'Files are deleted right after conversion and results expire within an hour. Contents are never logged.',
  },
  {
    icon: '🤖',
    title: 'LLM-ready output',
    description:
      'Token-efficient Markdown that preserves structure — ideal for prompts and text pipelines.',
  },
];

export function HomePage(): JSX.Element {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Documents → Markdown</p>
        <h1 className={styles.heroTitle}>
          Turn any document into clean{' '}
          <span className={styles.heroHighlight}>Markdown</span>
        </h1>
        <p className={styles.heroSubtitle}>
          TokenSaver converts PDFs, Office files, images, audio, and HTML into
          lightweight, LLM-ready Markdown — straight from your browser.
        </p>
        <div className={styles.heroActions}>
          <Link to="/convert" className={styles.primaryCta}>
            Start converting
          </Link>
          <Link to="/docs" className={styles.secondaryCta}>
            Read the docs
          </Link>
        </div>
      </section>

      <section className={styles.features} aria-label="Features">
        <div className={styles.featureGrid}>
          {FEATURES.map((feature) => (
            <article key={feature.title} className={styles.featureCard}>
              <span className={styles.featureIcon} aria-hidden="true">
                {feature.icon}
              </span>
              <h2 className={styles.featureTitle}>{feature.title}</h2>
              <p className={styles.featureText}>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.formats} aria-label="Supported formats">
        <h2 className={styles.formatsTitle}>Supported formats</h2>
        <ul className={styles.formatList}>
          {SUPPORTED_FORMAT_LABELS.map((label) => (
            <li key={label} className={styles.formatChip}>
              {label}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.closing}>
        <h2 className={styles.closingTitle}>Ready to convert?</h2>
        <p className={styles.closingText}>
          Upload your first file and see the Markdown in seconds.
        </p>
        <Link to="/convert" className={styles.primaryCta}>
          Open the converter
        </Link>
      </section>
    </div>
  );
}

export default HomePage;
