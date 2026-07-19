// Build links that open a pre-filled GitHub issue form. No backend, no secrets —
// GitHub handles auth in the user's browser and stores the feedback as an issue.
import { APP_VERSION } from '../version';

const REPO = 'TheBrindle/CrushMoldBuilder';

/** Single-line environment string that pre-fills the form's `environment` field. */
function environment(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
  return `Crush Mold Builder v${APP_VERSION} · ${ua}`;
}

function issueUrl(template: 'feedback.yml' | 'bug_report.yml'): string {
  const params = new URLSearchParams({ template, environment: environment() });
  return `https://github.com/${REPO}/issues/new?${params.toString()}`;
}

export const feedbackUrl = () => issueUrl('feedback.yml');
export const bugUrl = () => issueUrl('bug_report.yml');
