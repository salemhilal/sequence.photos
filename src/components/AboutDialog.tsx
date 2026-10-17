import { CodeXml, ExternalLink, Mail, Shield } from 'lucide-react';
import { PRIVACY_URL, REPO_URL } from '../config';
import { closeModal } from '../ui';
import { Dialog } from './Dialog';

export function AboutDialog() {
  return (
    <Dialog title="About" label="About Sequence" onClose={closeModal} className="about">
      <div className="about-body">
        <h2 className="wordmark" aria-label="Sequence">
          SEQUENCE
        </h2>
        <p className="about-version data muted">Version {__APP_VERSION__}</p>
        <p className="about-tagline">A tool for playing with photo sequences.</p>
        <div className="about-links">
          <a href="https://salem.io" target="_blank" rel="noopener noreferrer">
            <ExternalLink />
            salem.io
          </a>
          <a href="mailto:hi@sequence.photos">
            <Mail />
            hi@sequence.photos
          </a>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            <CodeXml />
            Source on GitHub
          </a>
          <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
            <Shield />
            Privacy policy
          </a>
        </div>
        <p className="about-copyright data muted">© {new Date().getFullYear()} Salem Hilal</p>
        <p className="about-copyright data muted">Sample photos © Salem Hilal</p>
      </div>
    </Dialog>
  );
}
