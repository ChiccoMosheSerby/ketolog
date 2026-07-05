import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import './CameraCapture.scss';

// Live camera capture modal. Uses getUserMedia (works on desktop webcams and
// mobile rear cameras) and grabs a frame to a canvas on "Capture". This is a real
// photo capture — unlike <input capture>, which silently falls back to a file
// picker on desktop. Portaled to <body> to escape the carousel's CSS transform.
export default function CameraCapture({ onCapture, onClose, onUpload }) {
  const { t } = useTranslation();
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
      fail(t('camera.secureContextError'));
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
                ? t('camera.deniedError')
                : t('camera.noCameraError')
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
          <span>{t('camera.title')}</span>
          <button className="cam-x" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>

        <div className="cam-stage">
          <video ref={videoRef} className="cam-video" autoPlay muted playsInline />
          {status === 'starting' && <div className="cam-hint">{t('camera.starting')}</div>}
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
                  🖼️ {t('camera.uploadImage')}
                </button>
              )}
              <button className="btn ghost" onClick={onClose}>
                {t('common.close')}
              </button>
            </>
          ) : (
            <button className="btn" onClick={capture} disabled={status !== 'ready'}>
              📷 {t('camera.capture')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
