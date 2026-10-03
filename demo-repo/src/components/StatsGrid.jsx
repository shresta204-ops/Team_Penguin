export default function StatsGrid({ stats }) {
  return (
    <section className="card stats">
      <h3>This week</h3>
      <ul className="stats-grid">
        {stats.map((s) => (
          <li key={s.label}>
            <span className="stat-value">{s.value.toLocaleString()}</span>
            <span className="stat-label">{s.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
