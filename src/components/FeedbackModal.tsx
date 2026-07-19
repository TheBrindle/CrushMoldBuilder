import { useState, type MouseEvent } from 'react';
import { useStore } from '../state/store';
import { buildIssueUrl } from '../lib/feedback';
import { renderAnnotated, copyPngToClipboard, type Pin } from '../lib/screenshot';

export default function FeedbackModal() {
  const feedback = useStore((s) => s.feedback);
  const close = useStore((s) => s.closeFeedback);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [pins, setPins] = useState<Pin[]>([]);
  const [phase, setPhase] = useState<'edit' | 'sent'>('edit');
  const [copied, setCopied] = useState(false);
  const [annotatedUrl, setAnnotatedUrl] = useState('');
  const [busy, setBusy] = useState(false);

  if (!feedback) return null;
  const { kind, image } = feedback;
  const isBug = kind === 'bug';

  const addPin = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPins((p) => [
      ...p,
      { nx: (e.clientX - rect.left) / rect.width, ny: (e.clientY - rect.top) / rect.height, note: '' },
    ]);
  };
  const setNote = (i: number, note: string) =>
    setPins((p) => p.map((pin, idx) => (idx === i ? { ...pin, note } : pin)));
  const removePin = (i: number) => setPins((p) => p.filter((_, idx) => idx !== i));

  const submit = async () => {
    setBusy(true);
    let finalImg = image;
    if (image && pins.length) {
      try {
        finalImg = await renderAnnotated(image, pins);
      } catch {
        finalImg = image;
      }
    }
    setAnnotatedUrl(finalImg);
    setCopied(finalImg ? await copyPngToClipboard(finalImg) : false);
    const url = buildIssueUrl({ kind, title, description, annotations: pins.map((p) => p.note) });
    window.open(url, '_blank', 'noopener');
    setPhase('sent');
    setBusy(false);
  };

  return (
    <div className="fb-overlay" onClick={close}>
      <div className="fb-modal" onClick={(e) => e.stopPropagation()}>
        {phase === 'edit' ? (
          <>
            <header className="fb-head">
              <h2>{isBug ? '🐛 Report a bug' : '💡 Send feedback'}</h2>
              <button className="fb-x" onClick={close} aria-label="Close">
                ✕
              </button>
            </header>

            {image ? (
              <>
                <p className="fb-hint">
                  Click the screenshot to point at things — “change this button”, “bad corner
                  here”.
                </p>
                <div className="fb-shot" onClick={addPin}>
                  <img src={image} alt="app screenshot" draggable={false} />
                  {pins.map((p, i) => (
                    <span
                      key={i}
                      className="fb-pin"
                      style={{ left: `${p.nx * 100}%`, top: `${p.ny * 100}%` }}
                    >
                      {i + 1}
                    </span>
                  ))}
                </div>
                {pins.length > 0 && (
                  <ul className="fb-pins">
                    {pins.map((p, i) => (
                      <li key={i}>
                        <span className="fb-pin-n">{i + 1}</span>
                        <input
                          value={p.note}
                          placeholder="what about this spot?"
                          onChange={(e) => setNote(i, e.target.value)}
                        />
                        <button className="fb-x" onClick={() => removePin(i)} aria-label="Remove">
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="fb-hint">Screenshot unavailable — you can still describe it below.</p>
            )}

            <input
              className="fb-title"
              placeholder={isBug ? 'Short summary of the bug' : 'Short summary'}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="fb-desc"
              rows={4}
              placeholder={
                isBug
                  ? 'What happened, what did you expect, steps to reproduce…'
                  : 'What would you like changed or added?'
              }
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />

            <footer className="fb-foot">
              <span className="fb-note">
                Opens a pre-filled GitHub issue — you'll paste the screenshot (one tap).
              </span>
              <div className="fb-actions">
                <button onClick={close}>Cancel</button>
                <button
                  className="fb-submit"
                  disabled={busy || (!title.trim() && !description.trim())}
                  onClick={submit}
                >
                  {busy ? 'Preparing…' : 'Continue to GitHub →'}
                </button>
              </div>
            </footer>
          </>
        ) : (
          <div className="fb-sent">
            <h2>Almost done — one paste!</h2>
            <ol>
              <li>A pre-filled GitHub issue opened in a new tab.</li>
              <li>
                {copied ? (
                  <>
                    Your annotated screenshot is <b>on the clipboard</b> — click the issue's text
                    box and press <b>Ctrl / ⌘ + V</b>.
                  </>
                ) : (
                  <>
                    Attach your screenshot:{' '}
                    <a href={annotatedUrl} download="crush-mold-feedback.png">
                      download it
                    </a>{' '}
                    and drag it into the issue.
                  </>
                )}
              </li>
              <li>Submit the issue. Thanks! 🙏</li>
            </ol>
            <button className="fb-submit" onClick={close}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
