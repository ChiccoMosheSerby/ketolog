import "./Skeleton.scss";

// Shimmering placeholders shown while data loads, shaped like the content
// they stand in for (card header, carb meter, meal rows) so nothing jumps.

export function SkeletonCard() {
  return (
    <div className="skel-card" aria-hidden="true">
      <div className="skel-row">
        <div className="skel-line w40"></div>
        <div className="skel-line w15"></div>
      </div>
      <div className="skel-line skel-meter"></div>
      <div className="skel-line w80"></div>
      <div className="skel-line w60"></div>
    </div>
  );
}

// Full-page stand-in while the session loads: header stats + composer + day card.
export function AppSkeleton() {
  return (
    <div className="skel-page" aria-hidden="true">
      <div className="skel-stats">
        <div className="skel-line w25"></div>
        <div className="skel-line w25"></div>
        <div className="skel-line w25"></div>
      </div>
      <div className="skel-card skel-slim">
        <div className="skel-line w80"></div>
      </div>
      <SkeletonCard />
    </div>
  );
}
