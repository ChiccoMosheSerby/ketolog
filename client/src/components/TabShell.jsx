import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { useMediaQuery, MOBILE_QUERY } from "../lib/useMediaQuery.js";
import "./TabShell.scss";

// tabs: [{ id, label, content, badge? }]  — badge renders a "new" dot on the tab.
// onTabChange(id): fired when the active tab changes (used to clear a badge).
// extra: optional node pinned into the tab row itself (desktop tabbar end /
// mobile dots row) — used for the global day calendar.
// Desktop renders a tab bar + only the active panel.
// Mobile mounts an Embla carousel with all panels + synced dots.
// One `active` index is shared, so switching breakpoints keeps your place.
export default function TabShell({ tabs, onTabChange, extra }) {
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

  // Programmatic tab jumps (e.g. closing the day jumps to תובנות) — any code
  // can dispatch `ketolog:gotoTab` with the tab id as the event detail.
  useEffect(() => {
    const onGoto = (e) => {
      const i = tabs.findIndex((t) => t.id === e.detail);
      if (i >= 0) change(i);
    };
    window.addEventListener("ketolog:gotoTab", onGoto);
    return () => window.removeEventListener("ketolog:gotoTab", onGoto);
  }, [tabs, change]);

  if (isMobile) {
    return <Carousel tabs={tabs} active={idx} change={change} extra={extra} />;
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
            className={"tabbtn" + (i === idx ? " active" : "")}
            onClick={() => change(i)}
          >
            {t.label}
            {t.badge && <span className="tab-badge" aria-label="חדש" />}
          </button>
        ))}
        {extra && <div className="tabbar-extra">{extra}</div>}
      </div>
      <div className="tabpanel" role="tabpanel">
        {tabs[idx].content}
      </div>
    </div>
  );
}

function Carousel({ tabs, active, change, extra }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    direction: "rtl",
    align: "start",
  });

  // Bind once per api: jump to the shared `active` on mount, then mirror swipes back out.
  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.scrollTo(active, true);
    const onSelect = () => change(emblaApi.selectedScrollSnap());
    emblaApi.on("select", onSelect);
    return () => emblaApi.off("select", onSelect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emblaApi]);

  // Mirror external `active` changes (programmatic jumps) into the carousel —
  // without this only swipes/dot clicks would move the track.
  useEffect(() => {
    if (emblaApi && emblaApi.selectedScrollSnap() !== active) {
      emblaApi.scrollTo(active);
    }
  }, [emblaApi, active]);

  // Adaptive height: the track is a flex row holding EVERY panel, so left
  // alone the page is always as tall as the tallest tab (e.g. היום scrolls to
  // the dashboard's height even with the journal folded). Clamp the track to
  // the active slide and let .embla's overflow:hidden clip the rest. The
  // ResizeObserver keeps the height live when content inside a slide grows or
  // shrinks (folds opening, data loading in).
  useEffect(() => {
    if (!emblaApi) return;
    const container = emblaApi.containerNode();
    const measure = () => {
      const slide = emblaApi.slideNodes()[emblaApi.selectedScrollSnap()];
      if (slide) container.style.height = slide.offsetHeight + "px";
    };
    measure();
    emblaApi.on("select", measure);
    const ro = new ResizeObserver(measure);
    emblaApi.slideNodes().forEach((s) => ro.observe(s));
    return () => {
      emblaApi.off("select", measure);
      ro.disconnect();
      container.style.height = "";
    };
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
            className={"dot" + (i === active ? " active" : "")}
            onClick={() => goTo(i)}
          >
            {t.label}
            {t.badge && <span className="tab-badge" aria-label="חדש" />}
          </button>
        ))}
        {extra && <div className="tabbar-extra">{extra}</div>}
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
