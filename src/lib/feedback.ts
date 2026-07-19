// Build links that open a pre-filled GitHub issue. No backend, no secrets —
// GitHub handles auth in the user's browser and stores the feedback as an issue.
import { APP_VERSION } from '../version';

const REPO = 'TheBrindle/CrushMoldBuilder';

export type FeedbackKind = 'feedback' | 'bug';

/** Single-line environment string for triage. */
function environment(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
  return `Crush Mold Builder v${APP_VERSION} · ${ua}`;
}

export interface FeedbackData {
  kind: FeedbackKind;
  title: string;
  description: string;
  annotations: string[]; // ordered notes matching the numbered pins
}

/** A fully pre-filled plain-issue URL (title, body, label) for the in-app form. */
export function buildIssueUrl(d: FeedbackData): string {
  const label = d.kind === 'bug' ? 'bug' : 'feedback';
  const prefix = d.kind === 'bug' ? '[Bug]' : '[Feedback]';
  const title = `${prefix} ${d.title.trim() || 'from the app'}`.slice(0, 120);

  const lines: string[] = [];
  if (d.description.trim()) lines.push(d.description.trim(), '');
  if (d.annotations.length) {
    lines.push('**Marked spots:**');
    d.annotations.forEach((a, i) => lines.push(`${i + 1}. ${a.trim() || '(unlabelled)'}`));
    lines.push('');
  }
  lines.push('**Screenshot:** _paste your copied screenshot here → Ctrl/⌘+V_', '');
  lines.push('---', `_${environment()}_`);

  const params = new URLSearchParams({ title, body: lines.join('\n'), labels: label });
  return `https://github.com/${REPO}/issues/new?${params.toString()}`;
}
