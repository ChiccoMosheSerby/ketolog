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
