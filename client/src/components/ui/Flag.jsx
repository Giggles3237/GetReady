export default function Flag({ label, muted = false, tone = "default" }) {
  return <span className={`flag flag-${tone} ${muted ? "muted" : ""}`.trim()}>{label}</span>;
}
