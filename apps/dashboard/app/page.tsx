import Link from "next/link";
import { StatusBadge } from "@/components/Badge";
import { formatDate, pct } from "@/lib/format";
import { listReports, REPORTS_DIR } from "@/lib/reports";

export const dynamic = "force-dynamic";

export default async function Home() {
  const reports = await listReports();
  return (
    <div className="stack">
      <div>
        <h1>Reliability reports</h1>
        <p className="sub">
          Each report runs every scenario many times per agent. Reading from{" "}
          <code title={REPORTS_DIR}>…/{REPORTS_DIR.split(/[\\/]/).slice(-2).join("/")}</code>
        </p>
      </div>
      {reports.length === 0 ? (
        <div className="card empty">
          No reports yet. Run <code>pnpm example</code> from the repo root, or point <code>RUNLENS_REPORTS_DIR</code> at a
          directory written by <code>runlens run</code>.
        </div>
      ) : (
        <div className="list">
          {reports.map((r) => {
            const total = r.scenarios.reduce((n, s) => n + s.stats.runs, 0);
            const passed = r.scenarios.reduce((n, s) => n + s.stats.passed, 0);
            const agents = new Set(r.scenarios.map((s) => s.agent)).size;
            const flaky = r.scenarios.filter((s) => s.stats.stability === "flaky").length;
            return (
              <Link key={r.id} href={`/r/${r.id}`} className="card report-row" style={{ color: "inherit" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    {formatDate(r.createdAt)} · {agents} agent{agents === 1 ? "" : "s"} ·{" "}
                    {new Set(r.scenarios.map((s) => s.scenarioId)).size} scenarios · {total} runs · {pct(passed / Math.max(1, total))}{" "}
                    passed · {flaky} flaky · tools {r.toolMode}
                    {r.git?.sha ? ` · ${r.git.sha.slice(0, 7)}` : ""}
                  </div>
                </div>
                {r.gate ? (
                  <StatusBadge status={r.gate.passed ? "good" : "critical"} label={r.gate.passed ? "Gate passed" : "Gate failed"} />
                ) : (
                  <span className="badge">No gate</span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
