// Downscale an image to a small square-ish JPEG thumbnail (data URL) suitable
// for inlining on a product document. Keeps DB rows tiny — a product photo the
// user snaps for macro estimation is reused as the dropdown thumbnail.
export function toThumbnail(src, { max = 160, quality = 0.7 } = {}) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(''); // tainted canvas / decode failure — skip the thumbnail
      }
    };
    img.onerror = () => resolve('');
    img.src = src;
  });
}

// A base64 payload (no prefix) + media type -> full data URL.
export function dataUrl(b64, mediaType = 'image/jpeg') {
  return `data:${mediaType};base64,${b64}`;
}

// Read a picked File and downscale it to a JPEG data URL bounded by `max` px on
// the long edge — big enough for a readable bug-report screenshot, small enough
// to inline in JSON. Resolves '' on decode failure (caller skips the file).
export function fileToJpegDataUrl(file, { max = 1280, quality = 0.8 } = {}) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve('');
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch {
          resolve('');
        }
      };
      img.onerror = () => resolve('');
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
