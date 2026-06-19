import { useCallback, useEffect, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { useMediaQuery, MOBILE_QUERY } from '../lib/useMediaQuery.js';
import './TabShell.scss';

// tabs: [{ id, label, content }]
// Desktop renders a tab bar + only the active panel.
// Mobile mounts an Embla carousel with all panels + synced dots.
// One `active` index is shared, so switching breakpoints keeps your place.
export default function TabShell({ tabs }) {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [active, setActive] = useState(0);

  if (isMobile) {
    return <Carousel tabs={tabs} active={active} setActive={setActive} />;
  }

  return (
    <div className="tabshell">
      <div className="tabbar" role="tablist">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={i === active}
            className={'tabbtn' + (i === active ? ' active' : '')}
            onClick={() => setActive(i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="tabpanel" role="tabpanel">
        {tabs[active].content}
      </div>
    </div>
  );
}

function Carousel({ tabs, active, setActive }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ direction: 'rtl', align: 'start' });

  // Bind once per api: jump to the shared `active` on mount, then mirror swipes back out.
  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.scrollTo(active, true);
    const onSelect = () => setActive(emblaApi.selectedScrollSnap());
    emblaApi.on('select', onSelect);
    return () => emblaApi.off('select', onSelect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emblaApi]);

  const goTo = useCallback((i) => emblaApi && emblaApi.scrollTo(i), [emblaApi]);

  return (
    <div className="carousel">
      <div className="dots" role="tablist">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={i === active}
            className={'dot' + (i === active ? ' active' : '')}
            onClick={() => goTo(i)}
          >
            {t.label}
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
