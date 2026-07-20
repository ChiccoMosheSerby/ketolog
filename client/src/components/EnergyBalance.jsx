import { useMemo } from 'react';
import {
  energyBalance,
  balanceStatus,
  KCAL_PER_KG,
  DEFAULT_LOSS_TARGET,
} from '../lib/energyBalance.js';
import { dayKcal, fmt, heDate } from '../lib/helpers.js';
import { useMediaQuery, MOBILE_QUERY } from '../lib/useMediaQuery.js';
import './EnergyBalance.scss';

// One place that maps a day's balance grade to its color + Hebrew label, used
// by the today-chip, the recent-days strip and the legend alike.
const STATUS_META = {
  goal: { label: 'גרעון בקצב היעד', color: 'var(--olive-dark)' },
  deficit: { label: 'גרעון חלקי', color: 'var(--olive)' },
  even: { label: 'מאוזן', color: 'var(--amber)' },
  surplus: { label: 'חריגה', color: 'var(--red)' },
};

// Tiny min–max-scaled weight sparkline (a 0-based axis like TrendChart's would
// flatten an 80→78 kg story into a straight line).
function WeightSpark({ weights }) {
  // Wider viewBox on desktop so the width-scaled svg keeps the same rendered
  // height as on mobile instead of blowing up ~3× (see TrendChart).
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const W = isMobile ? 340 : 680;
  const H = 56;
  const pad = 6;
  const first = weights[0];
  const last = weights[weights.length - 1];
  const t0 = Date.parse(first.date);
  const t1 = Math.max(Date.parse(last.date), t0 + 1);
  const kgs = weights.map((p) => p.kg);
  const lo = Math.min(...kgs);
  const hi = Math.max(...kgs);
  const range = Math.max(hi - lo, 0.5);
  const x = (p) => pad + ((Date.parse(p.date) - t0) / (t1 - t0)) * (W - pad * 2);
  const y = (p) => pad + (1 - (p.kg - lo) / range) * (H - pad * 2);
  const path = weights
    .map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)} ${y(p).toFixed(1)}`)
    .join(' ');
  return (
    <div className="eb-spark">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="מגמת המשקל">
        <path d={path} fill="none" stroke="var(--olive-dark)" strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {weights.map((p) => (
          <circle key={p.date} cx={x(p)} cy={y(p)} r="2.4" fill="var(--olive)"
                  stroke="var(--paper)" strokeWidth="1" vectorEffect="non-scaling-stroke">
            <title>{`${heDate(p.date)} · ${fmt(p.kg)} ק"ג`}</title>
          </circle>
        ))}
      </svg>
      <div className="eb-spark-axis">
        <span>{fmt(first.kg)} ק"ג · {heDate(first.date)}</span>
        <span>{fmt(last.kg)} ק"ג · {heDate(last.date)}</span>
      </div>
    </div>
  );
}

// A "collected / needed" progress row for the not-ready state.
function NeedRow({ label, have, need }) {
  const pct = Math.min((have / need) * 100, 100);
  const done = have >= need;
  return (
    <div className={'eb-need' + (done ? ' done' : '')}>
      <span className="eb-need-lab">{label}</span>
      <span className="eb-need-track"><i style={{ width: pct + '%' }} /></span>
      <span className="eb-need-num">{done ? '✓' : `${have}/${need}`}</span>
    </div>
  );
}

// Today's intake graded against a burn estimate — the colored chip + running
// text. Shared by the measured state and the provisional (formula) state, so
// the current day gets its surplus/even/deficit color from day one.
function TodayChip({ todayKcal, tdee, recommendedIntake }) {
  if (todayKcal == null) return null;
  const meta = STATUS_META[balanceStatus(todayKcal, tdee, recommendedIntake)];
  const left = recommendedIntake - todayKcal;
  return (
    <div className="eb-today" style={{ borderColor: meta.color }}>
      <span className="eb-chip" style={{ background: meta.color }}>
        היום: {meta.label}
      </span>
      <span className="eb-today-txt">
        נאכלו ~{todayKcal.toLocaleString()} קק"ל ·{' '}
        {left >= 0
          ? `נשארו ${Math.round(left).toLocaleString()} קק"ל עד גבול קצב היעד (${recommendedIntake.toLocaleString()})`
          : todayKcal <= tdee
            ? `מעל גבול קצב היעד (${recommendedIntake.toLocaleString()}), עדיין מתחת לשריפה (${tdee.toLocaleString()})`
            : `${Math.round(todayKcal - tdee).toLocaleString()} קק"ל מעל השריפה שלך (${tdee.toLocaleString()})`}
      </span>
    </div>
  );
}

// Energy balance: the user's measured daily burn (TDEE), derived from weigh-ins
// vs. logged calories, the calculation itself spelled out, and a
// surplus / even / deficit grade for today and for recent days — against a
// monthly weight-loss goal. Only closed days feed the math; the in-progress day
// is graded live but never enters the formula. Until enough weigh-ins exist, a
// provisional formula-based estimate (from height / birth year / gender in the
// profile) stands in, and sharpens into the measured number over time.
export default function EnergyBalance({ days, today, lossTarget = DEFAULT_LOSS_TARGET, profile }) {
  const eb = useMemo(
    () => energyBalance(days, { lossTarget, today, profile }),
    [days, lossTarget, today, profile]
  );

  const todayDoc = (days || []).find((d) => d.date === today);
  const todayKcal = todayDoc ? dayKcal(todayDoc) : null;

  if (!eb.ready) {
    const p = eb.progress;
    const pv = eb.provisional;
    return (
      <div className="energy-balance">
        {pv && (
          <>
            <div className="kcal-hero">
              <span className="kcal-num">~{pv.tdee.toLocaleString()}</span>
              <span className="kcal-lab">
                קק"ל ליום — הערכה ראשונית של השריפה שלך, לפי גובה, גיל, מין והשקילה
                האחרונה. ככל שיצטברו שקילות ותיעוד, היא תוחלף בחישוב מדויק מהנתונים שלך.
              </span>
            </div>
            <TodayChip todayKcal={todayKcal} tdee={pv.tdee} recommendedIntake={pv.recommendedIntake} />
            <div className="eb-goal">
              יעד: ירידה של <b>{fmt(eb.lossTarget)} ק"ג בחודש</b> ⇐ גרעון יומי של ~
              <b>{pv.requiredDeficit.toLocaleString()} קק"ל</b> ⇐ לאכול עד ~
              <b>{pv.recommendedIntake.toLocaleString()} קק"ל ביום</b>
            </div>
            {/* pace implied by the food log, against the provisional burn */}
            {pv.projectedKgPerMonth != null && (
              <div className={'eb-pace ' + (pv.projectedKgPerMonth >= eb.lossTarget ? 'good' : 'warn')}>
                לפי התיעוד ({pv.recentDays} ימים אחרונים, {pv.recentBalance <= 0 ? 'גרעון' : 'עודף'} ממוצע
                של {Math.abs(pv.recentBalance).toLocaleString()} קק"ל/יום מול ההערכה) —{' '}
                {pv.projectedKgPerMonth > 0
                  ? `ירידה צפויה של ~${fmt(pv.projectedKgPerMonth)} ק"ג בחודש`
                  : pv.projectedKgPerMonth < 0
                    ? `עלייה צפויה של ~${fmt(-pv.projectedKgPerMonth)} ק"ג בחודש`
                    : 'משקל יציב'}
                {pv.projectedKgPerMonth >= eb.lossTarget
                  ? ' · בקצב היעד 🎯'
                  : ` · מתחת לקצב היעד (${fmt(eb.lossTarget)} ק"ג/חודש)`}
              </div>
            )}
          </>
        )}
        {/* the weight change actually measured between the weigh-ins so far */}
        {eb.trend && (
          <div className={'eb-pace ' + (eb.trend.deltaKg < 0 ? 'good' : 'warn')}>
            בפועל, בין השקילות: <b>{eb.trend.deltaKg > 0 ? '+' : ''}{fmt(eb.trend.deltaKg)} ק"ג</b>{' '}
            ב-{eb.trend.spanDays} ימים
            {eb.trend.kgPerMonth != null && (
              <> · בקצב הזה ≈ <b>{eb.trend.kgPerMonth > 0 ? '+' : ''}{fmt(eb.trend.kgPerMonth)} ק"ג בחודש</b></>
            )}
          </div>
        )}
        <div className="d-note" style={pv ? undefined : { marginTop: 0 }}>
          תעד/י משקל בכרטיס <b>"שקילה"</b> שבהגדרות (⚙️) — מומלץ פעמיים בשבוע, באותו בוקר.
          אחרי כשבועיים — שלוש שקילות ותיעוד אוכל רציף — נחשב מהנתונים שלך את
          שריפת הקלוריות היומית האמיתית שלך (TDEE), ומשם לדעת בכל יום אם אתה בחריגה, מאוזן
          או בגרעון.
        </div>
        {!pv && (
          <div className="d-note">
            רוצה הערכה ראשונית כבר עכשיו? הוסף/י בהגדרות <b>גובה</b> ו<b>שנת לידה</b> (ומין)
            ותעד/י שקילה אחת — ונציג כאן אומדן שריפה לפי נוסחת Mifflin-St Jeor עד שיצטברו נתונים.
          </div>
        )}
        <div className="eb-needs">
          <NeedRow label="שקילות שתועדו" have={p.weighIns} need={p.needWeighIns} />
          <NeedRow label="ימים בין השקילה הראשונה לאחרונה" have={p.spanDays} need={p.needSpanDays} />
          <NeedRow label="ימי תזונה מלאים בתקופה" have={p.kcalDays} need={p.needKcalDays} />
        </div>
        {eb.weights.length >= 2 && <WeightSpark weights={eb.weights} />}
      </div>
    );
  }

  const onPace = eb.projectedKgPerMonth != null && eb.projectedKgPerMonth >= eb.lossTarget;
  const losing = eb.deltaKg < 0;

  return (
    <div className="energy-balance">
      {/* the headline number: measured daily burn */}
      <div className="kcal-hero">
        <span className="kcal-num">~{eb.tdee.toLocaleString()}</span>
        <span className="kcal-lab">
          קק"ל ליום — שריפת הקלוריות היומית שלך (TDEE), מחושבת מהמשקל והתיעוד שלך
        </span>
      </div>

      {/* the calculation, spelled out */}
      <div className="eb-calc">
        <div className="eb-calc-row">
          <span>ממוצע צריכה יומי</span>
          <b>{eb.avgIntake.toLocaleString()} קק"ל</b>
          <small>מתוך {eb.intakeDays} ימים מתועדים</small>
        </div>
        <div className="eb-calc-row">
          <span>מגמת המשקל</span>
          <b className={losing ? 'good' : 'bad'}>
            {eb.deltaKg > 0 ? '+' : ''}{fmt(eb.deltaKg)} ק"ג
          </b>
          <small>
            ב-{eb.spanDays} ימים ({eb.slopeKgPerWeek > 0 ? '+' : ''}{fmt(eb.slopeKgPerWeek)} ק"ג/שבוע
            ≈ {eb.slopeKgPerMonth > 0 ? '+' : ''}{fmt(eb.slopeKgPerMonth)} ק"ג/חודש)
          </small>
        </div>
        <div className="eb-calc-row">
          <span>אנרגיה בק"ג שומן</span>
          <b>{KCAL_PER_KG.toLocaleString()} קק"ל</b>
          <small>קבוע פיזיולוגי</small>
        </div>
        <div className="eb-formula mono">
          TDEE = {eb.avgIntake.toLocaleString()} − ({fmt(eb.deltaKg)} × 7,700 ÷ {eb.spanDays}) ≈ <b>{eb.tdee.toLocaleString()}</b>
        </div>
      </div>

      {/* today, against the burn */}
      <TodayChip todayKcal={todayKcal} tdee={eb.tdee} recommendedIntake={eb.recommendedIntake} />

      {/* the goal and what it demands */}
      <div className="eb-goal">
        יעד: ירידה של <b>{fmt(eb.lossTarget)} ק"ג בחודש</b> ⇐ גרעון יומי של ~
        <b>{eb.requiredDeficit.toLocaleString()} קק"ל</b> ⇐ לאכול עד ~
        <b>{eb.recommendedIntake.toLocaleString()} קק"ל ביום</b>
      </div>

      {/* actual pace lately */}
      {eb.projectedKgPerMonth != null && (
        <div className={'eb-pace ' + (onPace ? 'good' : 'warn')}>
          בקצב של הימים האחרונים ({eb.recentBalance <= 0 ? 'גרעון' : 'עודף'} ממוצע של{' '}
          {Math.abs(eb.recentBalance).toLocaleString()} קק"ל/יום) —{' '}
          {eb.projectedKgPerMonth > 0
            ? `ירידה צפויה של ~${fmt(eb.projectedKgPerMonth)} ק"ג בחודש`
            : eb.projectedKgPerMonth < 0
              ? `עלייה צפויה של ~${fmt(-eb.projectedKgPerMonth)} ק"ג בחודש`
              : 'משקל יציב'}
          {onPace ? ' · בקצב היעד 🎯' : ` · מתחת לקצב היעד (${fmt(eb.lossTarget)} ק"ג/חודש)`}
        </div>
      )}

      {/* recent days, graded */}
      {eb.graded.length > 0 && (
        <>
          <div className="eb-strip">
            {eb.graded.map((g) => (
              <span
                key={g.date}
                className="eb-cell"
                style={{ background: STATUS_META[g.status].color }}
                title={`${heDate(g.date)} · ~${g.kcal.toLocaleString()} קק"ל · ${
                  STATUS_META[g.status].label
                } (${g.balance > 0 ? '+' : ''}${g.balance.toLocaleString()} מול השריפה)`}
              />
            ))}
          </div>
          <div className="strip-legend">
            {['goal', 'deficit', 'even', 'surplus'].map((s) => (
              <span className="it" key={s}>
                <span className="sw" style={{ background: STATUS_META[s].color }} /> {STATUS_META[s].label}
              </span>
            ))}
          </div>
        </>
      )}

      <WeightSpark weights={eb.weights} />

      {eb.coverage < 0.8 && (
        <div className="d-note">
          שים/י לב: רק {Math.round(eb.coverage * 100)}% מהימים בתקופה תועדו במלואם — ימים חסרים
          מטים את ההערכה כלפי מטה. ככל שהתיעוד מלא יותר, החישוב מדויק יותר.
        </div>
      )}
      <div className="d-note">
        יעד הקלוריות היומי ({eb.recommendedIntake.toLocaleString()} קק"ל) מוחל אוטומטית על כל
        היומן — כרטיסי הימים וגרף הקלוריות נצבעים לפיו, והוא מתעדכן מעצמו עם כל שקילה.
      </div>
    </div>
  );
}
