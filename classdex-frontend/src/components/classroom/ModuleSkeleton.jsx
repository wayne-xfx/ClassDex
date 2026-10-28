import { Card, Skeleton } from "../DesignSystem";

export default function ModuleSkeleton({ "aria-label": ariaLabel = "Loading data", count = 6, className = "" }) {
  return (
    <div className={`scoring-skeleton-list${className ? ` ${className}` : ""}`} aria-label={ariaLabel} role="status">
      {Array.from({ length: count }, (_, index) => (
        <Card key={index} className="scoring-skeleton-row">
          <Skeleton className="scoring-skeleton-avatar" />
          <Skeleton className="scoring-skeleton-name" />
          <Skeleton className="scoring-skeleton-input" />
        </Card>
      ))}
    </div>
  );
}
