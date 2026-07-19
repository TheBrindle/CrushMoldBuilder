// App screenshot + annotation compositing + clipboard, all client-side.
import { toPng } from 'html-to-image';

/** Promise that rejects after `ms` — guards the DOM-serialization step. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

/**
 * Capture the whole app (3D viewport + side panel) to a PNG data URL.
 * The WebGL canvas is grabbed directly via toDataURL (instant); the small DOM
 * panel is rasterised separately — feeding the whole app (incl. the canvas) to
 * html-to-image is far too heavy and blocks the main thread.
 */
export async function captureApp(): Promise<string> {
  const app = document.querySelector('.app') as HTMLElement | null;
  if (!app) throw new Error('app root not found');
  const rect = app.getBoundingClientRect();

  const out = document.createElement('canvas');
  out.width = Math.round(rect.width) || window.innerWidth || 1280;
  out.height = Math.round(rect.height) || window.innerHeight || 720;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#101216';
  ctx.fillRect(0, 0, out.width, out.height);

  const place = (r: DOMRect) => ({ x: r.left - rect.left, y: r.top - rect.top, w: r.width, h: r.height });

  // 3D viewport — instant, reliable.
  const canvas = document.querySelector('.stage canvas') as HTMLCanvasElement | null;
  if (canvas) {
    try {
      const img = await loadImage(canvas.toDataURL('image/png'));
      const p = place(canvas.getBoundingClientRect());
      ctx.drawImage(img, p.x, p.y, p.w, p.h);
    } catch {
      /* ignore */
    }
  }

  // Side panel — small DOM, rasterised best-effort with a hard timeout.
  const panel = document.querySelector('.panel') as HTMLElement | null;
  if (panel) {
    try {
      const url = await withTimeout(
        // skipFonts avoids html-to-image's slow font-inlining (the main hang).
        toPng(panel, { backgroundColor: '#181b21', pixelRatio: 1, skipFonts: true }),
        1500,
      );
      const img = await loadImage(url);
      const p = place(panel.getBoundingClientRect());
      ctx.drawImage(img, p.x, p.y, p.w, p.h);
    } catch {
      /* panel capture is optional */
    }
  }

  return out.toDataURL('image/png');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export interface Pin {
  nx: number; // 0..1 across width
  ny: number; // 0..1 across height
  note: string;
}

/** Draw numbered markers onto the screenshot; returns a new PNG data URL. */
export async function renderAnnotated(baseUrl: string, pins: Pin[]): Promise<string> {
  const img = await loadImage(baseUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const r = Math.max(12, Math.round(Math.min(w, h) * 0.016));
  ctx.font = `bold ${Math.round(r * 1.2)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  pins.forEach((p, i) => {
    const x = p.nx * w;
    const y = p.ny * h;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#e0564f';
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.18);
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(String(i + 1), x, y + 1);
  });
  return canvas.toDataURL('image/png');
}

/** Copy a PNG data URL to the clipboard. Returns false if unsupported/blocked. */
export async function copyPngToClipboard(dataUrl: string): Promise<boolean> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    // eslint-disable-next-line no-undef
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}
