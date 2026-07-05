import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';
import './BarcodeScanner.scss';

// Packaged-product barcodes are EAN/UPC. Restricting formats makes the scan
// faster and less prone to misreads than letting ZXing try every symbology.
const FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
];

// Camera barcode scanner in a modal. Uses ZXing (works on iOS Safari, where the
// native BarcodeDetector API is absent). Always offers manual numeric entry as a
// fallback for when the camera is unavailable or the code won't scan.
export default function BarcodeScanner({ onResult, onClose }) {
  const { t } = useTranslation();
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const doneRef = useRef(false); // guard against double-firing onResult
  const [status, setStatus] = useState('starting'); // starting | scanning | error
  const [manual, setManual] = useState('');

  useEffect(() => {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new BrowserMultiFormatReader(hints);
    let cancelled = false;

    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } }, // rear camera on phones
        videoRef.current,
        (result) => {
          if (result && !doneRef.current) finish(result.getText());
        }
      )
      .then((controls) => {
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setStatus('scanning');
      })
      .catch((err) => {
        console.warn('barcode camera failed:', err?.message || err);
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      try {
        controlsRef.current?.stop();
      } catch {
        /* already stopped */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finish(code) {
    if (doneRef.current) return;
    doneRef.current = true;
    try {
      controlsRef.current?.stop();
    } catch {
      /* already stopped */
    }
    onResult(String(code).replace(/\D/g, ''));
  }

  function submitManual() {
    const code = manual.replace(/\D/g, '');
    if (code.length < 6) return;
    finish(code);
  }

  const manualValid = manual.replace(/\D/g, '').length >= 6;

  // Portal to <body> so the fixed overlay escapes the mobile carousel's CSS
  // transform (a transformed ancestor makes position:fixed anchor to it, which
  // would render the modal over the wrong tab).
  return createPortal(
    <div className="bc-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="bc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bc-head">
          <span>{t('barcode.title')}</span>
          <button className="bc-x" onClick={onClose} aria-label={t('barcode.close')}>
            ✕
          </button>
        </div>

        <div className="bc-stage">
          <video ref={videoRef} className="bc-video" muted playsInline />
          {status !== 'error' && <div className="bc-frame" />}
          <div className={'bc-hint' + (status === 'error' ? ' bc-err' : '')}>
            {status === 'starting' && t('barcode.starting')}
            {status === 'scanning' && t('barcode.aimHint')}
            {status === 'error' && t('barcode.noCameraError')}
          </div>
        </div>

        <div className="bc-manual">
          <input
            type="text"
            inputMode="numeric"
            placeholder={t('barcode.manualPlaceholder')}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitManual()}
          />
          <button className="btn" onClick={submitManual} disabled={!manualValid}>
            {t('barcode.search')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
