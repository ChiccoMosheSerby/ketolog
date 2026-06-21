import { useEffect, useState } from 'react';

// Reactive matchMedia. Drives the tabs-vs-carousel and desktop-vs-drawer split
// from one source so we never mount both trees at once.
export function useMediaQuery(query) {
  const get = () => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

// Single breakpoint for the whole app: at or below this width = mobile
// (hamburger drawer + carousel + single 720px column). Above it the desktop
// layout runs — stats + compact products in the header, AddMeal & the current
// day side by side — which needs the extra room, so the switch sits at 960px.
export const MOBILE_QUERY = '(max-width: 960px)';
