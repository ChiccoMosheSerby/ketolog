import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useToast } from "../lib/toast.jsx";
import { useFocusTrap } from "../lib/useFocusTrap.js";
import "./NameDialog.scss";

// In-app replacement for window.prompt: a small dialog with a title, one text
// field and save/cancel. Used to name a template/product saved from a logged
// meal. `onSubmit(name)` may be async — the dialog stays open (button shows a
// busy state) and only closes on success; a failure toasts and lets the user
// fix the name / retry.
export default function NameDialog({
  title,
  label = "שם",
  defaultValue = "",
  saveLabel = "שמירה",
  onSubmit,
  onClose,
}) {
  const toast = useToast();
  const [value, setValue] = useState(defaultValue);
  const [busy, setBusy] = useState(false);
  const trapRef = useFocusTrap();

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    const name = value.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onSubmit(name);
      onClose();
    } catch (e) {
      toast(e.message || "השמירה נכשלה — נסו שוב");
      setBusy(false);
    }
  }

  // Portaled to <body> like the other popups — on mobile the day cards live
  // inside the Embla carousel, whose transform would hijack position:fixed.
  return createPortal(
    <div className="namedlg-scrim" onClick={onClose}>
      <form
        className="namedlg"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={trapRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="namedlg-title">{title}</div>
        <label className="namedlg-field">
          <span>{label}</span>
          <input
            type="text"
            value={value}
            maxLength={60}
            data-autofocus
            onFocus={(e) => e.target.select()}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <div className="namedlg-acts">
          <button type="button" className="btn ghost mini" onClick={onClose}>
            ביטול
          </button>
          <button
            type="submit"
            className="btn mini"
            disabled={busy || !value.trim()}
          >
            {busy ? "שומר…" : saveLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
