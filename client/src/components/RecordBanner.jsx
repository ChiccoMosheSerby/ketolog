import { useEffect, useMemo, useState } from "react";
import { buildAnalytics } from "../lib/analytics.js";
import { fmt, heDate } from "../lib/helpers.js";
import "./RecordBanner.scss";

// One-time record banners on the main ("היום") screen. Watches the three
// dashboard records — longest in-target streak (רצף ימים), cleanest day
// (היום הנקי ביותר) and highest day (היום הגבוה ביותר) — against the last
// values this device celebrated (localStorage, per user). When a record moves,
// a banner pops once: a congratulation for the two good records, a gentler
// "not a good record" note for the highest day. Dismissing it (or just
// reloading) never brings that break back — the stored baseline is advanced
// the moment the break is detected.
//
// First run on a device seeds the baseline silently, so nobody gets showered
// with "records" for their whole history on a new phone.
const storeKey = (email) => `ketolog:records:${email || "anon"}`;

function readBaseline(email) {
  try {
    const raw = localStorage.getItem(storeKey(email));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function RecordBanner({ days, target, today, email }) {
  // Same analytics the insights tab renders, so the celebrated numbers always
  // match the שיאים panel exactly (records only count completed days).
  const a = useMemo(
    () => buildAnalytics(days, target, { today }),
    [days, target, today],
  );
  const [broken, setBroken] = useState([]); // banners still on screen

  useEffect(() => {
    if (!a.hasData) return; // days not loaded yet / empty log — don't touch the baseline
    const cur = {
      streak: a.longestStreak,
      best: a.best ? a.best.total : null,
      worst: a.worst ? a.worst.total : null,
    };
    const prev = readBaseline(email);
    if (!prev) {
      localStorage.setItem(storeKey(email), JSON.stringify(cur));
      return;
    }

    const msgs = [];
    // A one-day "streak" isn't a streak yet — start celebrating from 2 days.
    if (cur.streak > (prev.streak ?? 0) && cur.streak >= 2) {
      msgs.push({
        id: "streak",
        tone: "good",
        icon: "🏆",
        title: "שיא חדש — רצף ימים!",
        text: `${cur.streak} ימים רצופים ביעד — הרצף הארוך ביותר שלך עד כה. כל הכבוד, ממשיכים!`,
      });
    }
    if (prev.best != null && cur.best != null && cur.best < prev.best) {
      msgs.push({
        id: "best",
        tone: "good",
        icon: "🌟",
        title: "שיא חדש — היום הנקי ביותר!",
        text: `רק ${fmt(cur.best)} ג' פחמימות נטו ב${heDate(a.best.date)}. היום הנקי ביותר שלך עד כה — מרשים!`,
      });
    }
    if (prev.worst != null && cur.worst != null && cur.worst > prev.worst) {
      msgs.push({
        id: "worst",
        tone: "bad",
        icon: "⚠️",
        title: "שיא שלילי — היום הגבוה ביותר",
        text: `${fmt(cur.worst)} ג' פחמימות נטו ב${heDate(a.worst.date)} — הגבוה ביותר שנרשם. קורה לכולם; היום זו הזדמנות לחזור ליעד.`,
      });
    }

    // Advance the baseline even when nothing broke visibly (e.g. streak grew
    // to 1), so every comparison is always against the true all-time record.
    const next = {
      streak: Math.max(prev.streak ?? 0, cur.streak),
      best:
        prev.best == null
          ? cur.best
          : Math.min(prev.best, cur.best ?? prev.best),
      worst:
        prev.worst == null
          ? cur.worst
          : Math.max(prev.worst, cur.worst ?? prev.worst),
    };
    localStorage.setItem(storeKey(email), JSON.stringify(next));

    if (msgs.length) {
      setBroken((b) => [
        ...b,
        ...msgs.filter((m) => !b.some((x) => x.id === m.id)),
      ]);
    }
  }, [a, email]);

  if (!broken.length) return null;

  const dismiss = (id) => setBroken((b) => b.filter((m) => m.id !== id));

  return (
    <div className="record-banners">
      {broken.map((m) => (
        <div key={m.id} className={`record-banner ${m.tone}`} role="status">
          <span className="rb-icon" aria-hidden="true">
            {m.icon}
          </span>
          <span className="rb-text">
            <b className="rb-title">{m.title}</b>
            <span className="rb-msg">{m.text}</span>
          </span>
          <button
            className="rb-close"
            aria-label="סגירה"
            onClick={() => dismiss(m.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
