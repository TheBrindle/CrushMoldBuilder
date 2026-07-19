import Viewport from './components/Viewport';
import ControlsPanel from './components/ControlsPanel';
import FeedbackModal from './components/FeedbackModal';
import { useStore } from './state/store';
import './App.css';

function BusyOverlay() {
  const busy = useStore((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="busy">
      <div className="busy-card">
        <div className="spinner" />
        <p>{busy.phase}</p>
        {busy.value !== undefined && (
          <div className="bar">
            <div className="bar-fill" style={{ width: `${Math.round(busy.value * 100)}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

function ErrorToast() {
  const error = useStore((s) => s.error);
  const dismiss = useStore((s) => s.dismissError);
  if (!error) return null;
  return (
    <div className="toast" role="alert">
      <strong>Something went wrong</strong>
      <pre>{error}</pre>
      <button onClick={dismiss}>Dismiss</button>
    </div>
  );
}

function EmptyHint() {
  const partGeom = useStore((s) => s.partGeom);
  if (partGeom) return null;
  return (
    <div className="empty">
      <p>Open an egg / part STL to begin.</p>
      <p className="small">Everything runs locally in your browser — nothing is uploaded.</p>
    </div>
  );
}

export default function App() {
  return (
    <div className="app">
      <div className="stage">
        <Viewport />
        <EmptyHint />
        <BusyOverlay />
        <ErrorToast />
      </div>
      <ControlsPanel />
      <FeedbackModal />
    </div>
  );
}
