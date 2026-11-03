export function StatusBadge({ status, label }: { status: string; label: string }) {
  const icon = status === "good" ? "✓" : status === "critical" ? "✕" : "!";
  return (
    <span className={`badge status-${status}`}>
      <span className="dot" aria-hidden />
      <span aria-hidden>{icon}</span>
      {label}
    </span>
  );
}
