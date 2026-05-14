interface ViewingTimePillProps {
  time?: Date | null;
  fallbackLabel?: string;
}

export function ViewingTimePill({ time, fallbackLabel }: ViewingTimePillProps) {
  if (!time && !fallbackLabel) return null;

  return (
    <span className="viewing-time-pill">
      {time
        ? time.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : fallbackLabel}
    </span>
  );
}

export default ViewingTimePill;
