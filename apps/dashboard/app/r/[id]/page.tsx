import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/Badge";
import { ForestPlot, type ForestPoint } from "@/components/ForestPlot";
import { agentColors, formatDate, pct, sourceStatus, stabilityStatus, usd } from "@/lib/format";
import { getReport } from "@/lib/reports";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getReport(id);
  if (!report) notFound();

  const agents = [...new Set(report.scenarios.map((s) => s.agent))];
  const colorMap = agentColors(agents);
  const colors = Object.fromEntries(colorMap);
  const points: ForestPoint[] = report.scenarios.map((s, i) => ({
    agent: s.agent,
    scenarioId: s.scenarioId,
    rate: s.stats.passRate,
    low: s.stats.passRateInterval.low,
    high: s.stats.passRateInterval.high,
    passed: s.stats.passed,
    scored: s.stats.passed + s.stats.failed,
    passHat5: s.stats.passHatK["5"],
    href: `/r/${report.id}/${i}`,
  }));

  const perAgent = agents.map((a) => {
    const rows = report.scenarios.filter((s) => s.agent === a);
    const passed = rows.reduce((n, s) => n + s.stats.passed, 0);
    const scored = rows.reduce((n, s) => n + s.stats.passed + s.stats.failed, 0);
    const errors = rows.reduce((n, s) => n + s.stats.errors, 0);
    const cost = rows.reduce((n, s) => n + (s.stats.totalCostUsd ?? 0), 0);
    const bySource = { model: 0, environment: 0, infrastructure: 0 };
    for (const s of rows) for (const c of s.failureClusters) bySource[c.source] += c.count;
    return { agent: a, passed, scored, errors, cost, bySource, flaky: rows.filter((s) => s.stats.stability === "flaky").length };
  });

  const threshold = report.gate?.config?.minPassRateLowerBound;

  return (
    <div className="stack">
      <div className="crumbs">
        <Link href="/">Reports</Link> / {report.name}
      </div>
      <div className="row-between" style={{ marginBottom: 0 }}>
        <div>
          <h1>{report.name}</h1>
          <p className="sub">
            {formatDate(report.createdAt)} · {report.runsPerScenario} runs per scenario · concurrency {report.concurrency} · tools{" "}
            {report.toolMode}
            {report.git?.branch ? ` · ${report.git.branch}` : ""}
            {report.git?.sha ? `@${report.git.sha.slice(0, 7)}` : ""}
          </p>
        </div>
        {report.gate && (
          <StatusBadge status={report.gate.passed ? "good" : "critical"} label={report.gate.passed ? "Gate passed" : "Gate failed"} />
        )}
      </div>

      {report.gate && !report.gate.passed && (
        <div className="card gate">
          <div>
            <strong>Why the gate failed</strong>
            <ul>
              {report.gate.violations.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="tiles">
        {perAgent.map((a) => (
          <div className="tile" key={a.agent}>
            <div className="label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <i style={{ width: 10, height: 10, borderRadius: "50%", background: colorMap.get(a.agent), display: "inline-block" }} />
              {a.agent}
            </div>
            <div className="value">{pct(a.passed / Math.max(1, a.scored))}</div>
            <div className="note">
              {a.passed}/{a.scored} passed · {a.flaky} flaky scenario{a.flaky === 1 ? "" : "s"}
              {a.cost ? ` · ${usd(a.cost)}` : ""}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Pass rate with 95% confidence interval</h2>
        <p className="sub" style={{ marginTop: -6, marginBottom: 12, fontSize: 13 }}>
          Overlapping intervals mean the difference has not been shown. Click a row for details.
        </p>
        <ForestPlot points={points} agents={agents} colors={colors} threshold={threshold} />
      </div>

      <div className="card">
        <h2>All results</h2>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Scenario</th>
                <th className="num">Passed</th>
                <th className="num">Pass rate</th>
                <th className="num">95% CI</th>
                <th className="num">pass^5</th>
                <th>Stability</th>
                <th className="num">Tool paths</th>
                <th>Top failure</th>
              </tr>
            </thead>
            <tbody>
              {report.scenarios.map((s, i) => {
                const top = s.failureClusters[0];
                const st = stabilityStatus[s.stats.stability];
                return (
                  <tr key={i}>
                    <td>{s.agent}</td>
                    <td>
                      <Link href={`/r/${report.id}/${i}`}>{s.scenarioId}</Link>
                    </td>
                    <td className="num">
                      {s.stats.passed}/{s.stats.passed + s.stats.failed}
                      {s.stats.errors ? <span className="muted"> +{s.stats.errors} err</span> : null}
                    </td>
                    <td className="num">{pct(s.stats.passRate)}</td>
                    <td className="num">
                      {pct(s.stats.passRateInterval.low)}–{pct(s.stats.passRateInterval.high)}
                    </td>
                    <td className="num">{s.stats.passHatK["5"] !== undefined ? pct(s.stats.passHatK["5"]) : "–"}</td>
                    <td>
                      <StatusBadge {...st} />
                    </td>
                    <td className="num">{s.toolPaths.distinctPaths}</td>
                    <td style={{ maxWidth: 280 }}>
                      {top ? (
                        <>
                          <StatusBadge {...sourceStatus[top.source]} /> <span className="muted">×{top.count}</span>
                          <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{top.label}</div>
                        </>
                      ) : (
                        "–"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Where failures came from</h2>
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th className="num">Model</th>
              <th className="num">Environment</th>
              <th className="num">Infrastructure</th>
            </tr>
          </thead>
          <tbody>
            {perAgent.map((a) => (
              <tr key={a.agent}>
                <td>{a.agent}</td>
                <td className="num">{a.bySource.model}</td>
                <td className="num">{a.bySource.environment}</td>
                <td className="num">{a.bySource.infrastructure}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
          Environment: a tool returned something other than its usual result for the same arguments. Infrastructure: the run
          threw or timed out. Model: everything else.
        </p>
      </div>

      {report.gate?.regressions.length ? (
        <div className="card">
          <h2>Compared with baseline</h2>
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Scenario</th>
                <th className="num">Baseline</th>
                <th className="num">Current</th>
                <th className="num">p-value</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {report.gate.regressions.map((r) => (
                <tr key={`${r.agent}-${r.scenarioId}`}>
                  <td>{r.agent}</td>
                  <td>{r.scenarioId}</td>
                  <td className="num">{pct(r.baselinePassRate)}</td>
                  <td className="num">{pct(r.currentPassRate)}</td>
                  <td className="num">{r.pValue.toFixed(3)}</td>
                  <td>
                    {r.significant ? (
                      <StatusBadge status="critical" label="Regression" />
                    ) : r.currentPassRate < r.baselinePassRate ? (
                      <span className="badge">Within noise</span>
                    ) : (
                      <StatusBadge status="good" label="OK" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
