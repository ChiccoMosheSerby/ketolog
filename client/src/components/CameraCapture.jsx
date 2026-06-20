import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './CameraCapture.scss';

// Live camera capture modal. Uses getUserMedia (works on desktop webcams and
// mobile rear cameras) and grabs a frame to a canvas on "צלם". This is a real
// photo capture — unlike <input capture>, which silently falls back to a file
// picker on desktop. Portaled to <body> to escape the carousel's CSS transform.
export default function CameraCapture({ onCapture, onClose, onUpload }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState('starting'); // starting | ready | error
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    let cancelled = false;

    const fail = (msg) => {
      if (!cancelled) {
        setErrMsg(msg);
        setStatus('error');
      }
    };

    // getUserMedia only exists in a secure context (https or localhost).
    if (!navigator.mediaDevices?.getUserMedia) {
      fail('המצלמה זמינה רק בחיבור מאובטח (https). אפשר להעלות תמונה במקום.');
      return;
    }

    const attach = (stream) => {
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play?.().catch(() => {});
      }
      setStatus('ready');
    };

    // Prefer the rear camera, but fall back to any camera if that's rejected.
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then(attach)
      .catch(() =>
        navigator.mediaDevices
          .getUserMedia({ video: true, audio: false })
          .then(attach)
          .catch((err) => {
            const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
            fail(
              denied
                ? 'אין הרשאה למצלמה. אשר/י גישה בדפדפן, או העלה/י תמונה במקום.'
                : 'לא נמצאה מצלמה זמינה. אפשר להעלות תמונה במקום.'
            );
          })
      );

    return () => {
      cancelled = true;
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {
        /* already stopped */
      }
    };
  }, []);

  function stop() {
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      /* already stopped */
    }
  }

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const b64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
    stop();
    onCapture(b64, 'image/jpeg');
  }

  return createPortal(
    <div className="cam-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="cam-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cam-head">
          <span>צילום מוצר</span>
          <button className="cam-x" onClick={onClose} aria-label="סגור">
            ✕
          </button>
        </div>

        <div className="cam-stage">
          <video ref={videoRef} className="cam-video" autoPlay muted playsInline />
          {status === 'starting' && <div className="cam-hint">מפעיל מצלמה…</div>}
          {status === 'error' && <div className="cam-hint cam-err">{errMsg}</div>}
        </div>

        <div className="cam-actions">
          {status === 'error' ? (
            <>
              {onUpload && (
                <button
                  className="btn"
                  onClick={() => {
                    onClose();
                    onUpload();
                  }}
                >
                  🖼️ העלה תמונה
                </button>
              )}
              <button className="btn ghost" onClick={onClose}>
                סגור
              </button>
            </>
          ) : (
            <button className="btn" onClick={capture} disabled={status !== 'ready'}>
              📷 צלם
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
