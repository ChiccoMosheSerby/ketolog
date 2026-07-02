import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { fmt } from '../lib/helpers.js';
import { toThumbnail, dataUrl } from '../lib/image.js';
import './Products.scss';

// Scanner pulls in ZXing (large) — load it only when the user opens the camera.
const BarcodeScanner = lazy(() => import('./BarcodeScanner.jsx'));
const CameraCapture = lazy(() => import('./CameraCapture.jsx'));

export default function Products({ products, onAdd, onDelete, compact }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    key: '', label: '', unit: '', perPack: '', carb: '', fat: '', prot: '', image: '',
  });
  const [note, setNote] = useState(null);
  const [imgBusy, setImgBusy] = useState(false);
  const [barBusy, setBarBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [capturing, setCapturing] = useState(false); // live camera photo modal
  const fileRef = useRef(null); // gallery / file upload
  const ddRef = useRef(null); // product-list dropdown, for outside-click close

  // Close the floating product list when clicking outside it (regular dropdown).
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ddRef.current && !ddRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    if (!form.key.trim()) {
      toast('תן/י שם למוצר');
      return;
    }
    await onAdd({
      key: form.key.trim(),
      label: form.label.trim() || form.key.trim(),
      unit: form.unit.trim() || 'מנה',
      carbs: Number(form.carb) || 0,
      fat: Number(form.fat) || 0,
      protein: Number(form.prot) || 0,
      image: form.image || '',
    });
    setForm({ key: '', label: '', unit: '', perPack: '', carb: '', fat: '', prot: '', image: '' });
    setNote(null);
    toast('המוצר נוסף');
  }

  function pickImage() {
    fileRef.current?.click();
  }

  // A frame captured from the live camera — same pipeline as an uploaded file.
  function onCapture(b64, mt) {
    setCapturing(false);
    runImage(b64, mt);
  }

  function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const mt = file.type || 'image/jpeg';
    if (!/^image\/(jpeg|png|gif|webp)$/.test(mt)) {
      toast('פורמט נתמך: JPG, PNG, GIF, WEBP');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => runImage(reader.result.split(',')[1], mt);
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  async function runImage(b64, mt) {
    const typedUnit = form.unit.trim();
    setImgBusy(true);
    setNote({ loading: true, unit: typedUnit });
    // Keep the photo as the product's thumbnail regardless of whether the AI
    // estimate below succeeds — it'll show in the saved-products dropdown.
    toThumbnail(dataUrl(b64, mt)).then((thumb) => {
      if (thumb) setForm((f) => ({ ...f, image: thumb }));
    });
    try {
      const r = await api.estimateImage(b64, mt, typedUnit);
      const userPP = Number(form.perPack);
      const modelPP = Number(r.units_per_pack);
      const per = userPP > 0 ? userPP : modelPP > 0 ? modelPP : 1;
      const div = (v) => (v != null && !isNaN(Number(v)) ? Number(v) / per : NaN);
      const c = div(r.pack_net_carbs),
        f = div(r.pack_fat),
        p = div(r.pack_protein);
      const next = {
        key: r.name || form.key,
        label: r.label || r.name || form.label,
        unit: typedUnit || r.unit || 'יחידה',
        perPack: !form.perPack && per > 1 ? String(per) : form.perPack,
        carb: isNaN(c) ? '' : fmt(c),
        fat: isNaN(f) ? '' : fmt(f),
        prot: isNaN(p) ? '' : fmt(p),
      };
      // keep the thumbnail captured above (its setState may race this one)
      setForm((prev) => ({ ...next, image: prev.image }));
      const src = userPP > 0 ? 'לפי הכמות שציינת' : modelPP > 0 ? 'הערכה אוטומטית' : 'אריזה שלמה';
      setNote({
        name: r.name || 'מוצר',
        line: `ל${next.unit} (מתוך ${fmt(per)} באריזה · ${src}): ${next.carb || '?'} פחמ' · ${
          next.fat || '?'
        } שומן · ${next.prot || '?'} חלבון`,
        breakdown: r.breakdown,
      });
    } catch {
      setNote({ error: 'לא הצלחתי לזהות מהתמונה — נסה תמונה ברורה יותר או הזן ידנית.' });
    } finally {
      setImgBusy(false);
    }
  }

  // Barcode -> Open Food Facts lookup -> keto net carbs. Returns per-unit values
  // already (Claude divided), so we fill the form fields directly — no per-pack
  // division like the image flow needs.
  async function runBarcode(code) {
    setScanning(false);
    if (!code) return;
    const typedUnit = form.unit.trim();
    setBarBusy(true);
    setNote({ loading: true, loadingText: `מחפש ברקוד ${code} במסד הנתונים…` });
    try {
      const r = await api.scanBarcode(code, typedUnit);
      const c = Number(r.net_carbs),
        f = Number(r.fat),
        p = Number(r.protein);
      const next = {
        ...form,
        key: r.name || form.key,
        label: r.label || r.name || form.label,
        unit: typedUnit || r.unit || '100 גרם',
        carb: isNaN(c) ? '' : fmt(c),
        fat: isNaN(f) ? '' : fmt(f),
        prot: isNaN(p) ? '' : fmt(p),
      };
      setForm(next);
      const src =
        r.source === 'off'
          ? 'ממסד הנתונים'
          : r.source === 'off+ai'
          ? 'מסד נתונים + השלמת AI (סיבים חסרו)'
          : 'הערכה';
      setNote({
        name: r.name || 'מוצר',
        line: `ל${next.unit} (${src}): ${next.carb || '?'} פחמ' · ${next.fat || '?'} שומן · ${
          next.prot || '?'
        } חלבון`,
        breakdown: r.breakdown,
      });
    } catch (err) {
      const msg = err?.message && err.message !== 'שגיאה' ? err.message : 'הסריקה נכשלה';
      setNote({ error: `${msg} — אפשר לצלם את האריזה או להזין ידנית.` });
    } finally {
      setBarBusy(false);
    }
  }

  const busy = imgBusy || barBusy;

  return (
    <div className={'panel' + (compact ? ' compact' : '')} data-tour="products">
      {scanning && (
        <Suspense fallback={null}>
          <BarcodeScanner onResult={runBarcode} onClose={() => setScanning(false)} />
        </Suspense>
      )}
      {capturing && (
        <Suspense fallback={null}>
          <CameraCapture
            onCapture={onCapture}
            onClose={() => setCapturing(false)}
            onUpload={pickImage}
          />
        </Suspense>
      )}
      <h2>המוצרים שלי</h2>
      <div className="phelp" style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '-8px 0 12px' }}>
        מוצרים קבועים שלך. הם מופיעים כתגיות מתחת לתיבת הפירוט — קליק מוסיף אותם לתיאור הארוחה, ואז
        מחשבים ורושמים. גם כשתכתוב אותם בפירוט, החישוב יזהה אותם.
      </div>

      <div className="prod-actions">
        <div className="prod-dd" ref={ddRef}>
          <button className={'prod-toggle' + (open ? ' open' : '')} onClick={() => setOpen(!open)}>
            <span className="chev"></span>
            <span>{open ? 'הסתר את רשימת המוצרים' : 'הצג את רשימת המוצרים'}</span>
            <span className="pcount">{products.length}</span>
          </button>
          {open && (
            <div id="prodList">
              {products.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', padding: '6px 0' }}>
                  אין מוצרים שמורים עדיין.
                </div>
              ) : (
                products.map((p) => (
                  <div className="prod" key={p._id}>
                    {p.image ? (
                      <img className="pthumb" src={p.image} alt="" loading="lazy" />
                    ) : (
                      <span className="pthumb pthumb-ph" aria-hidden="true">🍽️</span>
                    )}
                    <div className="pinfo">
                      <div className="pname">
                        {p.key} — <span style={{ fontWeight: 300 }}>{p.label}</span>
                      </div>
                      <div className="pmeta">
                        ל{p.unit}: {fmt(p.carbs)} פחמ' · {fmt(p.fat)} שומן · {fmt(p.protein)} חלבון
                      </div>
                    </div>
                    <button className="pdel" title="מחק" onClick={() => onDelete(p._id)}>
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <div className="capture">
          <button
            className="btn ghost"
            disabled={busy}
            data-tour="barcode"
            onClick={() => setScanning(true)}
          >
            {barBusy ? 'מחפש…' : 'ברקוד'}
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => setCapturing(true)}>
            {imgBusy ? 'מזהה…' : '📷 צילום'}
          </button>
          <button className="btn ghost" disabled={busy} onClick={pickImage}>
            {imgBusy ? 'מזהה…' : '🖼️ תמונה'}
          </button>
          <input
            type="file"
            ref={fileRef}
            accept="image/*"
            style={{ display: 'none' }}
            onChange={onFile}
          />
        </div>
      </div>

      <div className="prod-add">
        {note && (
          <div className="calc-note">
            {note.loading &&
              (note.loadingText ||
                (note.unit ? `מזהה ומחשב ל"${note.unit}"…` : 'מזהה את המוצר בתמונה…'))}
            {note.error}
            {note.name && (
              <>
                <strong>זוהה: {note.name}</strong>
                <span className="bd">
                  <br />
                  {note.line}
                </span>
                {note.breakdown && (
                  <span className="bd">
                    <br />
                    {note.breakdown}
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {form.image && (
          <div className="prod-img-preview">
            <img src={form.image} alt="תצוגה מקדימה של המוצר" />
            <div className="pip-text">
              <strong>תמונת המוצר</strong>
              <span>תישמר ותוצג ברשימת המוצרים</span>
            </div>
            <button
              type="button"
              className="pip-x"
              title="הסר תמונה"
              onClick={() => setForm((f) => ({ ...f, image: '' }))}
            >
              ✕
            </button>
          </div>
        )}

        <div className="row prod-fields">
          <div className="fld" style={{ flex: 2 }}>
            <label>שם / כינוי</label>
            <input placeholder="שוקולד" value={form.key} onChange={set('key')} />
          </div>
          <div className="fld" style={{ flex: 3 }}>
            <label>תיאור מלא</label>
            <input placeholder="שוקולד 62% עם אלולוז" value={form.label} onChange={set('label')} />
          </div>
          <div className="fld">
            <label>יחידה</label>
            <input placeholder="שורה" value={form.unit} onChange={set('unit')} />
          </div>
          <div className="fld">
            <label>באריזה</label>
            <input type="number" step="1" min="1" placeholder="6" value={form.perPack} onChange={set('perPack')} />
          </div>
          <div className="fld">
            <label>פחמ' נטו</label>
            <input type="number" step="0.1" placeholder="0" value={form.carb} onChange={set('carb')} />
          </div>
          <div className="fld">
            <label>שומן</label>
            <input type="number" step="0.1" placeholder="0" value={form.fat} onChange={set('fat')} />
          </div>
          <div className="fld">
            <label>חלבון</label>
            <input type="number" step="0.1" placeholder="0" value={form.prot} onChange={set('prot')} />
          </div>
          <button className="btn" onClick={submit}>
            הוסף מוצר
          </button>
        </div>
      </div>
    </div>
  );
}
