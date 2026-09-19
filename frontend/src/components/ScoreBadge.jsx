export default function ScoreBadge({ band, value, present, total, size = "compact" }) {
  const thin = present != null && total != null && present < total * 0.5;
  const segments = Array.from({ length: 3 }, (_, i) => {
    const frac = present != null && total ? present / total : 1;
    return i < Math.max(1, Math.min(3, Math.round(frac * 3)));
  });
  return (
    <span className={`badge ${band} ${size} ${thin ? "thin" : ""}`}>
      <span className="word">{band}</span>
      {size === "full" || value != null ? (
        <span className="num">{value != null ? Math.round(value) : "—"}</span>
      ) : null}
      <span className="cov" aria-hidden="true">
        {segments.map((f, i) => (
          <span key={i} className={f ? "filled" : ""} />
        ))}
      </span>
    </span>
  );
}