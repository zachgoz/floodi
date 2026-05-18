interface ViewingTimePillProps {
  time?: Date | null;
  fallbackLabel?: string;
  onClick?: () => void;
}

export function ViewingTimePill({ time, fallbackLabel, onClick }: ViewingTimePillProps) {
  if (!time && !fallbackLabel) return null;

  const label = time
    ? time.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : fallbackLabel;

  if (onClick) {
    return (
      <button
        type="button"
        className="viewing-time-pill viewing-time-pill-button"
        onClick={onClick}
        aria-label="Open time window settings"
      >
        {label}
      </button>
    );
  }

  return (
    <span className="viewing-time-pill">
      {label}
    </span>
  );
}

export default ViewingTimePill;
