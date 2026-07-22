import { useEffect, useReducer } from 'react';
import { api } from './api.js';
import { todayISO } from './helpers.js';

// Single module-scoped cache for insight reports, shared by the SmartInsights
// panel and the "new report" badge on the תובנות nav tab. It survives tab
// switches (the panel unmounts on desktop when another tab is active) so both
// consumers read one fetch instead of each hitting the endpoint on their own.

export const FRESH_MS = 5 * 60 * 1000; // reuse cached data for 5 min before revalidating

let cache = null; // { key, reports, generating, aiOff, keyError, enoughData, at }
let inflight = null; // coalesce concurrent loads (panel + badge on cold start)

const subs = new Set();
function emit() {
  subs.forEach((fn) => fn());
}

export function subscribe(fn) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function getCache() {
  return cache;
}

export function isFresh(key) {
  return !!(cache && cache.key === key && Date.now() - cache.at < FRESH_MS);
}

// Map an /ai/insights response into the shared cache shape and publish it.
export function setFromResponse(key, res) {
  const enoughData = res?.enoughData !== false;
  cache = {
    key,
    reports: enoughData ? res.reports || [] : [],
    generating: enoughData ? res.generating || [] : [],
    aiOff: res?.aiConfigured === false,
    // why background generation is failing ('auth' | 'no_credit' | '') — lets
    // the panel explain a dead/over-budget API key instead of going quiet
    keyError: res?.aiKeyError || '',
    enoughData,
    at: Date.now(),
  };
  emit();
  return cache;
}

// Patch the cached reports in place (e.g. after marking one seen).
export function patchReports(key, updater) {
  if (!cache || cache.key !== key) return;
  cache = { ...cache, reports: updater(cache.reports) };
  emit();
}

// Fetch once, coalescing concurrent callers onto the same request.
export async function loadInsights(key) {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await api.getInsights(todayISO());
      setFromResponse(key, res);
      return res;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// While the server reports it's still generating, revalidate sooner than the
// normal freshness window so the finished report pops the badge promptly.
const GEN_RECHECK_MS = 45 * 1000;

// Populate the cache for the badge if it's missing/stale, without disturbing a
// fresh cache the panel may already own. A fresh cache with pending generation
// still refetches (on the shorter interval) — that's how a report that finishes
// in the background gets picked up.
export async function ensureLoaded(key) {
  if (!key) return;
  const generatingWait =
    cache &&
    cache.key === key &&
    (cache.generating || []).length > 0 &&
    Date.now() - cache.at > GEN_RECHECK_MS;
  if (isFresh(key) && !generatingWait) return;
  try {
    await loadInsights(key);
  } catch {
    /* ignore — a failed load just means no badge */
  }
}

// Badge shows while any report is unseen. `seen` is server-persisted and only
// set after the report was actually displayed to the user (SmartInsights marks
// it on dwell while visible), so the badge survives reloads and tab switches
// until the user really saw the new insights.
export function hasBadge(key) {
  if (!cache || cache.key !== key) return false;
  return cache.reports.some((r) => !r.seen);
}

// How often the badge re-checks for new reports. ensureLoaded no-ops while the
// cache is fresh, so the actual fetch rate is bounded by FRESH_MS.
const RECHECK_MS = 60 * 1000;

// Reactive badge flag for the nav tab. Loads the cache on mount, re-renders on
// every store change (fetch / seen-mark), and keeps revalidating on an interval
// and on app-foreground so a report generated mid-session pops the badge
// without a reload.
export function useInsightsBadge(key) {
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => subscribe(bump), []);
  useEffect(() => {
    if (!key) return;
    const tick = () => ensureLoaded(key);
    tick();
    const iv = setInterval(tick, RECHECK_MS);
    const onVis = () => document.visibilityState === 'visible' && tick();
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(iv);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [key]);
  return hasBadge(key);
}
