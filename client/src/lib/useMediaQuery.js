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

// Single breakpoint for the whole app: at or below this width = mobile.
export const MOBILE_QUERY = '(max-width: 700px)';
