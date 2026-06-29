// File open/save using the File System Access API where available,
// with a graceful <input>/anchor-download fallback.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface OpenedFile {
  buffer: ArrayBuffer;
  name: string;
}

const STL_TYPES = [
  {
    description: 'STL mesh',
    accept: { 'model/stl': ['.stl'], 'application/octet-stream': ['.stl'] },
  },
];

export async function openSTL(): Promise<OpenedFile | null> {
  const w = window as any;
  if (typeof w.showOpenFilePicker === 'function') {
    try {
      const [handle] = await w.showOpenFilePicker({
        types: STL_TYPES,
        multiple: false,
      });
      const file = await handle.getFile();
      return { buffer: await file.arrayBuffer(), name: file.name };
    } catch (e: any) {
      if (e?.name === 'AbortError') return null;
      throw e;
    }
  }
  // Fallback: hidden file input.
  return new Promise<OpenedFile | null>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.stl';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve({ buffer: await file.arrayBuffer(), name: file.name });
      } catch (err) {
        reject(err);
      }
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function saveSTL(blob: Blob, suggestedName: string): Promise<boolean> {
  const w = window as any;
  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName,
        types: STL_TYPES,
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (e: any) {
      if (e?.name === 'AbortError') return false;
      throw e;
    }
  }
  // Fallback: anchor download.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
