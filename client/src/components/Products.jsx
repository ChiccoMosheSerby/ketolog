import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { fmt } from '../lib/helpers.js';
import { toThumbnail, dataUrl } from '../lib/image.js';
import './Products.scss';

// Scanner pulls in ZXing (large) — load it only when the user opens the camera.
const BarcodeScanner = lazy(() => import('./BarcodeScanner.jsx'));
const CameraCapture = lazy(() => import('./CameraCapture.jsx'));

export default function Products({ products, onAdd, onRename, onDelete, compact }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState(null); // product being renamed inline
  const [editName, setEditName] = useState('');
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
      toast(t('products.nameProduct'));
      return;
    }
    await onAdd({
      key: form.key.trim(),
      label: form.label.trim() || form.key.trim(),
      unit: form.unit.trim() || t('products.defaultUnit'),
      carbs: Number(form.carb) || 0,
      fat: Number(form.fat) || 0,
      protein: Number(form.prot) || 0,
      image: form.image || '',
    });
    setForm({ key: '', label: '', unit: '', perPack: '', carb: '', fat: '', prot: '', image: '' });
    setNote(null);
    toast(t('products.productAdded'));
  }

  function startEdit(p) {
    setEditId(p._id);
    setEditName(p.key);
  }
  async function saveEdit(id) {
    const name = editName.trim();
    if (!name) {
      toast(t('products.nameProduct'));
      return;
    }
    await onRename(id, name);
    setEditId(null);
    setEditName('');
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
      toast(t('products.unsupportedFormat'));
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
        unit: typedUnit || r.unit || t('products.defaultUnitSingle'),
        perPack: !form.perPack && per > 1 ? String(per) : form.perPack,
        carb: isNaN(c) ? '' : fmt(c),
        fat: isNaN(f) ? '' : fmt(f),
        prot: isNaN(p) ? '' : fmt(p),
      };
      // keep the thumbnail captured above (its setState may race this one)
      setForm((prev) => ({ ...next, image: prev.image }));
      const src = userPP > 0 ? t('products.srcByQuantity') : modelPP > 0 ? t('products.srcAutoEstimate') : t('products.srcFullPack');
      setNote({
        name: r.name || t('products.defaultProductName'),
        line: t('products.estimateLine', {
          unit: next.unit,
          per: fmt(per),
          src,
          carb: next.carb || '?',
          fat: next.fat || '?',
          prot: next.prot || '?',
        }),
        breakdown: r.breakdown,
      });
    } catch {
      setNote({ error: t('products.imageError') });
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
    setNote({ loading: true, loadingText: t('products.searchingBarcode', { code }) });
    try {
      const r = await api.scanBarcode(code, typedUnit);
      const c = Number(r.net_carbs),
        f = Number(r.fat),
        p = Number(r.protein);
      const next = {
        ...form,
        key: r.name || form.key,
        label: r.label || r.name || form.label,
        unit: typedUnit || r.unit || t('products.default100g'),
        carb: isNaN(c) ? '' : fmt(c),
        fat: isNaN(f) ? '' : fmt(f),
        prot: isNaN(p) ? '' : fmt(p),
      };
      setForm(next);
      const src =
        r.source === 'off'
          ? t('products.srcDatabase')
          : r.source === 'off+ai'
          ? t('products.srcDatabaseAi')
          : t('products.srcEstimate');
      setNote({
        name: r.name || t('products.defaultProductName'),
        line: t('products.barcodeLine', {
          unit: next.unit,
          src,
          carb: next.carb || '?',
          fat: next.fat || '?',
          prot: next.prot || '?',
        }),
        breakdown: r.breakdown,
      });
    } catch (err) {
      const msg = err?.message && err.message !== t('common.error') ? err.message : t('products.scanFailed');
      setNote({ error: t('products.scanError', { msg }) });
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
      <h2>{t('products.title')}</h2>
      <div className="phelp" style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '-8px 0 12px' }}>
        {t('products.help')}
      </div>

      <div className="prod-actions">
        <div className="prod-dd" ref={ddRef}>
          <button className={'prod-toggle' + (open ? ' open' : '')} onClick={() => setOpen(!open)}>
            <span className="chev"></span>
            <span>{open ? t('products.hideList') : t('products.showList')}</span>
            <span className="pcount">{products.length}</span>
          </button>
          {open && (
            <div id="prodList">
              {products.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', padding: '6px 0' }}>
                  {t('products.emptyList')}
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
                      {editId === p._id ? (
                        <input
                          className="pname-edit"
                          value={editName}
                          autoFocus
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(p._id);
                            if (e.key === 'Escape') setEditId(null);
                          }}
                        />
                      ) : (
                        <div className="pname">
                          {p.key} — <span style={{ fontWeight: 300 }}>{p.label}</span>
                        </div>
                      )}
                      <div className="pmeta">
                        {t('products.productMeta', {
                          unit: p.unit,
                          carbs: fmt(p.carbs),
                          fat: fmt(p.fat),
                          protein: fmt(p.protein),
                        })}
                      </div>
                    </div>
                    {editId === p._id ? (
                      <>
                        <button className="pedit" title={t('common.save')} onClick={() => saveEdit(p._id)}>
                          ✓
                        </button>
                        <button className="pdel" title={t('common.cancel')} onClick={() => setEditId(null)}>
                          ✕
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="pedit" title={t('products.editName')} onClick={() => startEdit(p)}>
                          ✎
                        </button>
                        <button className="pdel" title={t('common.delete')} onClick={() => onDelete(p._id)}>
                          ✕
                        </button>
                      </>
                    )}
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
            {barBusy ? t('products.searching') : t('products.barcode')}
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => setCapturing(true)}>
            {imgBusy ? t('products.recognizing') : t('products.photo')}
          </button>
          <button className="btn ghost" disabled={busy} onClick={pickImage}>
            {imgBusy ? t('products.recognizing') : t('products.image')}
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
                (note.unit ? t('products.recognizingUnit', { unit: note.unit }) : t('products.recognizingImage')))}
            {note.error}
            {note.name && (
              <>
                <strong>{t('products.recognized', { name: note.name })}</strong>
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
            <img src={form.image} alt={t('products.imagePreviewAlt')} />
            <div className="pip-text">
              <strong>{t('products.productImage')}</strong>
              <span>{t('products.imageWillBeSaved')}</span>
            </div>
            <button
              type="button"
              className="pip-x"
              title={t('products.removeImage')}
              onClick={() => setForm((f) => ({ ...f, image: '' }))}
            >
              ✕
            </button>
          </div>
        )}

        <div className="row prod-fields">
          <div className="fld" style={{ flex: 2 }}>
            <label>{t('products.nameLabel')}</label>
            <input placeholder={t('products.namePlaceholder')} value={form.key} onChange={set('key')} />
          </div>
          <div className="fld" style={{ flex: 3 }}>
            <label>{t('products.descriptionLabel')}</label>
            <input placeholder={t('products.descriptionPlaceholder')} value={form.label} onChange={set('label')} />
          </div>
          <div className="fld">
            <label>{t('products.unitLabel')}</label>
            <input placeholder={t('products.unitPlaceholder')} value={form.unit} onChange={set('unit')} />
          </div>
          <div className="fld">
            <label>{t('products.perPackLabel')}</label>
            <input type="number" step="1" min="1" placeholder="6" value={form.perPack} onChange={set('perPack')} />
          </div>
          <div className="fld">
            <label>{t('products.netCarbsLabel')}</label>
            <input type="number" step="0.1" placeholder="0" value={form.carb} onChange={set('carb')} />
          </div>
          <div className="fld">
            <label>{t('products.fatLabel')}</label>
            <input type="number" step="0.1" placeholder="0" value={form.fat} onChange={set('fat')} />
          </div>
          <div className="fld">
            <label>{t('products.proteinLabel')}</label>
            <input type="number" step="0.1" placeholder="0" value={form.prot} onChange={set('prot')} />
          </div>
          <button className="btn" onClick={submit}>
            {t('products.addProduct')}
          </button>
        </div>
      </div>
    </div>
  );
}
