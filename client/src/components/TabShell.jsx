import { useCallback, useEffect, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { useMediaQuery, MOBILE_QUERY } from '../lib/useMediaQuery.js';
import './TabShell.scss';

// tabs: [{ id, label, content, badge? }]  — badge renders a "new" dot on the tab.
// onTabChange(id): fired when the active tab changes (used to clear a badge).
// Desktop renders a tab bar + only the active panel.
// Mobile mounts an Embla carousel with all panels + synced dots.
// One `active` index is shared, so switching breakpoints keeps your place.
export default function TabShell({ tabs, onTabChange }) {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [active, setActive] = useState(0);
  // The tab list can shrink across breakpoints (products is desktop-header-only),
  // so clamp to avoid indexing past the end.
  const idx = Math.min(active, tabs.length - 1);

  // Single funnel for tab changes so the badge-clear fires from every entry
  // point (desktop click, mobile dot click, mobile swipe).
  const change = useCallback(
    (i) => {
      setActive(i);
      if (tabs[i]) onTabChange?.(tabs[i].id);
    },
    [tabs, onTabChange],
  );

  if (isMobile) {
    return <Carousel tabs={tabs} active={idx} change={change} />;
  }

  return (
    <div className="tabshell">
      <div className="tabbar" role="tablist" data-tour="tabs">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={i === idx}
            data-tour-tab={t.id}
            className={'tabbtn' + (i === idx ? ' active' : '')}
            onClick={() => change(i)}
          >
            {t.label}
            {t.badge && <span className="tab-badge" aria-label="חדש" />}
          </button>
        ))}
      </div>
      <div className="tabpanel" role="tabpanel">
        {tabs[idx].content}
      </div>
    </div>
  );
}

function Carousel({ tabs, active, change }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ direction: 'rtl', align: 'start' });

  // Bind once per api: jump to the shared `active` on mount, then mirror swipes back out.
  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.scrollTo(active, true);
    const onSelect = () => change(emblaApi.selectedScrollSnap());
    emblaApi.on('select', onSelect);
    return () => emblaApi.off('select', onSelect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emblaApi]);

  const goTo = useCallback((i) => emblaApi && emblaApi.scrollTo(i), [emblaApi]);

  return (
    <div className="carousel">
      <div className="dots" role="tablist" data-tour="tabs">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={i === active}
            data-tour-tab={t.id}
            className={'dot' + (i === active ? ' active' : '')}
            onClick={() => goTo(i)}
          >
            {t.label}
            {t.badge && <span className="tab-badge" aria-label="חדש" />}
          </button>
        ))}
      </div>
      <div className="embla" ref={emblaRef}>
        <div className="embla-track">
          {tabs.map((t) => (
            <section className="embla-slide" key={t.id}>
              {t.content}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
