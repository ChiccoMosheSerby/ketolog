import { useEffect, useReducer } from 'react';
import { api } from './api.js';
import { todayISO } from './helpers.js';

// Single module-scoped cache for insight reports, shared by the SmartInsights
// panel and the "new report" badge on the תובנות nav tab. It survives tab
// switches (the panel unmounts on desktop when another tab is active) so both
// consumers read one fetch instead of each hitting the endpoint on their own.

export const FRESH_MS = 5 * 60 * 1000; // reuse cached data for 5 min before revalidating

let cache = null; // { key, reports, generating, aiOff, enoughData, at }
let inflight = null; // coalesce concurrent loads (panel + badge on cold start)

// Report ids the user has acknowledged by opening the תובנות tab this session.
// A newly-generated report gets a fresh id, so it re-shows the badge even after
// an earlier visit.
let dismissed = new Set();
let dismissedKey = null;
// The user opened the tab before the cache loaded: acknowledge whatever the
// first fetch turns up so the badge doesn't pop in after the visit.
let pendingVisit = false;

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
    enoughData,
    at: Date.now(),
  };
  if (pendingVisit) {
    pendingVisit = false;
    markVisited(key);
    return cache;
  }
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

// Populate the cache for the badge if it's missing/stale, without disturbing a
// fresh cache the panel may already own.
export async function ensureLoaded(key) {
  if (!key || isFresh(key)) return;
  try {
    await loadInsights(key);
  } catch {
    /* ignore — a failed load just means no badge */
  }
}

// The user opened the תובנות tab: acknowledge every currently-unseen report so
// the badge clears until a genuinely new report arrives.
export function markVisited(key) {
  if (!key) return;
  if (dismissedKey !== key) {
    dismissed = new Set();
    dismissedKey = key;
  }
  if (cache && cache.key === key) {
    cache.reports.forEach((r) => {
      if (!r.seen) dismissed.add(r.id);
    });
  } else {
    // No data yet — acknowledge whatever the first fetch for this user returns.
    pendingVisit = true;
  }
  emit();
}

// Badge shows when there's an unseen report the user hasn't acknowledged by
// opening the tab this session.
export function hasBadge(key) {
  if (!cache || cache.key !== key) return false;
  const ack = dismissedKey === key ? dismissed : null;
  return cache.reports.some((r) => !r.seen && !(ack && ack.has(r.id)));
}

// Reactive badge flag for the nav tab. Loads the cache on mount and re-renders
// whenever the shared store changes (fetch, seen-mark, or tab visit).
export function useInsightsBadge(key) {
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => subscribe(bump), []);
  useEffect(() => {
    ensureLoaded(key);
  }, [key]);
  return hasBadge(key);
}
