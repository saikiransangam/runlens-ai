import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/Badge";
import { ms, pct, sourceStatus, stabilityStatus, usd } from "@/lib/format";
import { getReport } from "@/lib/reports";

export const dynamic = "force-dynamic";

function Bar({ value }: { value: number }) {
  return (
    <div className="bar-track" role="img" aria-label={pct(value)}>
      <div className="bar-fill" style={{ width: `${Math.max(value * 100, 1)}%` }} />
    </div>
  );
}

export default async function ScenarioPage({ params }: { params: Promise<{ id: string; idx: string }> }) {
  const { id, idx } = await params;
  const report = await getReport(id);
  const s = report?.scenarios[Number(idx)];
  if (!report || !s) notFound();

  const st = s.stats;
  const scored = st.passed + st.failed;
  const ks = Object.keys(st.passHatK).sort((a, b) => Number(a) - Number(b));

  return (
    <div className="stack">
      <div className="crumbs">
        <Link href="/">Reports</Link> / <Link href={`/r/${report.id}`}>{report.name}</Link> / {s.scenarioId}
      </div>
      <div className="row-between" style={{ marginBottom: 0 }}>
        <div>
          <h1>{s.scenarioId}</h1>
          <p className="sub">
            {s.agent}
            {s.description ? ` · ${s.description}` : ""}
          </p>
        </div>
        <StatusBadge {...stabilityStatus[st.stability]} />
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="label">Pass rate</div>
          <div className="value">{pct(st.passRate)}</div>
          <div className="note">
            95% CI {pct(st.passRateInterval.low)}–{pct(st.passRateInterval.high)}
          </div>
        </div>
        <div className="tile">
          <div className="label">Runs</div>
          <div className="value">
            {st.passed}/{scored}
          </div>
          <div className="note">
            {st.failed} failed · {st.errors} errors
          </div>
        </div>
        <div className="tile">
          <div className="label">pass^5 (all 5 succeed)</div>
          <div className="value">{st.passHatK["5"] !== undefined ? pct(st.passHatK["5"]) : "–"}</div>
          <div className="note">pass@5 {st.passAtK["5"] !== undefined ? pct(st.passAtK["5"]) : "–"}</div>
        </div>
        <div className="tile">
          <div className="label">Runs for ±5 pts</div>
          <div className="value">{st.runsFor5ptMargin}</div>
          <div className="note">at this pass rate, 95% confidence</div>
        </div>
        <div className="tile">
          <div className="label">Latency</div>
          <div className="value">{ms(st.latencyMs.p50)}</div>
          <div className="note">p95 {ms(st.latencyMs.p95)}</div>
        </div>
        {st.totalCostUsd !== undefined && (
          <div className="tile">
            <div className="label">Cost</div>
            <div className="value">{usd(st.totalCostUsd)}</div>
            <div className="note">{usd(st.totalCostUsd / Math.max(1, st.runs))} per run</div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Every run</h2>
        <div className="run-grid" aria-label="Run outcomes">
          {s.runs.map((r) => (
            <span
              key={r.index}
              className={`run-cell ${r.status}`}
              title={`Run ${r.index + 1}: ${r.status}${r.failureSource ? ` (${r.failureSource})` : ""} · ${r.toolPath}`}
            >
              {r.status === "passed" ? "✓" : r.status === "failed" ? "✕" : "!"}
            </span>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
          ✓ passed · ✕ failed · ! error. Hover a cell for its tool path.
        </p>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Consistency as k grows</h2>
          <table>
            <thead>
              <tr>
                <th className="num">k</th>
                <th className="num">pass@k (any succeeds)</th>
                <th className="num">pass^k (all succeed)</th>
              </tr>
            </thead>
            <tbody>
              {ks.map((k) => (
                <tr key={k}>
                  <td className="num">{k}</td>
                  <td className="num">{pct(st.passAtK[k]!)}</td>
                  <td className="num">{pct(st.passHatK[k]!)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
            pass^k is the chance that k separate users all get a correct answer.
          </p>
        </div>

        <div className="card">
          <h2>Tool-call paths</h2>
          <p className="sub" style={{ marginTop: -6, marginBottom: 10, fontSize: 13 }}>
            {s.toolPaths.distinctPaths} distinct path{s.toolPaths.distinctPaths === 1 ? "" : "s"} · entropy{" "}
            {s.toolPaths.entropy.toFixed(2)} bits
          </p>
          <table>
            <thead>
              <tr>
                <th>Path</th>
                <th className="num">Share</th>
                <th className="num">Pass rate</th>
              </tr>
            </thead>
            <tbody>
              {s.toolPaths.groups.map((g) => (
                <tr key={g.path}>
                  <td>
                    <code>{g.path}</code>
                  </td>
                  <td className="num" style={{ minWidth: 120 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                      <Bar value={g.share} />
                      {g.runs}
                    </div>
                  </td>
                  <td className="num">{pct(g.passRate, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Failure clusters</h2>
        {s.failureClusters.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No failures.
          </p>
        ) : (
          s.failureClusters.map((c) => (
            <details key={c.id}>
              <summary>
                <StatusBadge {...sourceStatus[c.source]} />
                <strong>×{c.count}</strong>
                <span>{c.label}</span>
                <code className="muted">via {c.toolPath}</code>
              </summary>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6 }}>
                Path <code>{c.toolPath}</code> · runs {c.runIndexes.map((i) => i + 1).join(", ")}
                {c.exampleReason ? <div>Reason: {c.exampleReason}</div> : null}
              </div>
              <pre>{c.exampleOutput || "(no output)"}</pre>
            </details>
          ))
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Response clusters</h2>
          <p className="sub" style={{ marginTop: -6, marginBottom: 10, fontSize: 13 }}>
            Answers grouped by similarity. Many clusters mean the agent phrases or decides things differently from run to run.
          </p>
          {s.responseClusters.map((c) => (
            <details key={c.id}>
              <summary>
                <strong>×{c.size}</strong>
                <span className="muted">
                  {c.passed}/{c.size} passed
                </span>
              </summary>
              <pre>{c.representative}</pre>
            </details>
          ))}
        </div>

        <div className="card">
          <h2>Environment variance</h2>
          {s.environmentVariance.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              {s.toolMode === "frozen"
                ? "Tools were frozen: each (tool, arguments) pair returned the same result in every run."
                : "Every tool returned the same result for the same arguments across runs."}
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Arguments</th>
                  <th className="num">Distinct results</th>
                </tr>
              </thead>
              <tbody>
                {s.environmentVariance.map((v, i) => (
                  <tr key={i}>
                    <td>
                      <code>{v.tool}</code>
                    </td>
                    <td>
                      <code>{JSON.stringify(v.args)}</code>
                    </td>
                    <td className="num">
                      {v.distinctResults} in {v.calls} calls
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Runs</h2>
        {s.runs.map((r) => (
          <details key={r.index}>
            <summary>
              <span className={`run-cell ${r.status}`} aria-hidden>
                {r.status === "passed" ? "✓" : r.status === "failed" ? "✕" : "!"}
              </span>
              <span>Run {r.index + 1}</span>
              <code className="muted">{r.toolPath}</code>
              {r.failureSource && <StatusBadge {...sourceStatus[r.failureSource]} />}
              <span className="muted" style={{ marginLeft: "auto" }}>
                {ms(r.latencyMs)}
              </span>
            </summary>
            {r.error ? <pre>{r.error}</pre> : <pre>{r.output}</pre>}
            {r.criteria.length > 0 && (
              <table style={{ marginTop: 8 }}>
                <tbody>
                  {r.criteria.map((c) => (
                    <tr key={c.id}>
                      <td style={{ width: 28 }}>{c.pass ? "✓" : "✕"}</td>
                      <td>{c.description}</td>
                      <td className="muted">{c.reason ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </details>
        ))}
      </div>
    </div>
  );
}
