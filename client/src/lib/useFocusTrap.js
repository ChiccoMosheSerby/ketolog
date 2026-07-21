import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Keyboard focus trap for dialogs/drawers. Attach the returned ref to the
// dialog container (give it tabIndex={-1} as a focus fallback). While `active`:
// focus moves into the dialog (an element marked data-autofocus wins, else the
// first focusable), Tab/Shift+Tab cycle inside it, and on close focus returns
// to the element that opened it.
export function useFocusTrap(active = true) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!active || !node) return;
    const prev = document.activeElement;

    // getClientRects filters elements hidden via display:none (e.g. collapsed sections)
    const focusables = () =>
      Array.from(node.querySelectorAll(FOCUSABLE)).filter(
        (el) => el.getClientRects().length > 0,
      );

    const preferred = node.querySelector('[data-autofocus]');
    (preferred || focusables()[0] || node).focus();

    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (!els.length) {
        e.preventDefault();
        return;
      }
      const first = els[0];
      const last = els[els.length - 1];
      // wrap at the edges; also pull focus back in if it escaped the dialog
      if (e.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
      if (prev && typeof prev.focus === 'function') prev.focus();
    };
  }, [active]);

  return ref;
}
