"use client";

import { useState } from "react";

export interface ForestPoint {
  agent: string;
  scenarioId: string;
  rate: number;
  low: number;
  high: number;
  passed: number;
  scored: number;
  passHat5?: number;
  href: string;
}

const ROW_PAD = 14;
const DOT_GAP = 16;
const LEFT = 150;
const RIGHT = 16;
const TOP = 8;
const AXIS = 28;
const WIDTH = 760;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/**
 * Pass rate with its 95% confidence interval per (scenario, agent). The
 * interval, not the dot, is the honest answer: two agents whose whiskers
 * overlap have not been shown to differ.
 */
export function ForestPlot({
  points,
  agents,
  colors,
  threshold,
}: {
  points: ForestPoint[];
  agents: string[];
  colors: Record<string, string>;
  threshold?: number;
}) {
  const [hover, setHover] = useState<{ p: ForestPoint; x: number; y: number } | null>(null);
  const scenarios = [...new Set(points.map((p) => p.scenarioId))];
  const rowH = agents.length * DOT_GAP + ROW_PAD * 2;
  const height = TOP + scenarios.length * rowH + AXIS;
  const plotW = WIDTH - LEFT - RIGHT;
  const x = (v: number) => LEFT + v * plotW;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="chart">
      <div className="legend" aria-label="Legend">
        {agents.map((a) => (
          <span key={a}>
            <i style={{ background: colors[a] }} />
            {a}
          </span>
        ))}
        {threshold !== undefined && (
          <span>
            <svg width="16" height="10" aria-hidden>
              <line x1="0" y1="5" x2="16" y2="5" stroke="var(--text-muted)" strokeDasharray="3 3" strokeWidth="1.5" />
            </svg>
            Gate: lower bound ≥ {pct(threshold)}
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        width="100%"
        role="img"
        aria-label="Pass rate with 95% confidence interval for each scenario and agent"
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={TOP} y2={height - AXIS} stroke="var(--grid)" strokeWidth="1" />
            <text x={x(t)} y={height - AXIS + 18} textAnchor="middle" fontSize="11.5" fill="var(--text-muted)">
              {t * 100}%
            </text>
          </g>
        ))}
        {threshold !== undefined && (
          <line
            x1={x(threshold)}
            x2={x(threshold)}
            y1={TOP}
            y2={height - AXIS}
            stroke="var(--text-muted)"
            strokeDasharray="3 3"
            strokeWidth="1.5"
          />
        )}
        {scenarios.map((s, si) => {
          const y0 = TOP + si * rowH;
          return (
            <g key={s}>
              {si > 0 && <line x1={0} x2={WIDTH - RIGHT} y1={y0} y2={y0} stroke="var(--border)" strokeWidth="1" />}
              <text x={0} y={y0 + rowH / 2 + 4} fontSize="12.5" fill="var(--text-primary)">
                {s.length > 22 ? `${s.slice(0, 21)}…` : s}
              </text>
              {agents.map((a, ai) => {
                const p = points.find((pt) => pt.scenarioId === s && pt.agent === a);
                if (!p) return null;
                const cy = y0 + ROW_PAD + ai * DOT_GAP + DOT_GAP / 2;
                return (
                  <a key={a} href={p.href} aria-label={`${a}, ${s}: ${pct(p.rate)} (95% CI ${pct(p.low)} to ${pct(p.high)})`}>
                    <g
                      onMouseMove={(e) => {
                        const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                        setHover({ p, x: e.clientX - box.left, y: e.clientY - box.top });
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <rect x={LEFT} y={cy - DOT_GAP / 2} width={plotW} height={DOT_GAP} fill="transparent" />
                      <line x1={x(p.low)} x2={x(p.high)} y1={cy} y2={cy} stroke={colors[a]} strokeWidth="2" strokeLinecap="round" />
                      <circle cx={x(p.rate)} cy={cy} r="5" fill={colors[a]} stroke="var(--surface-1)" strokeWidth="2" />
                    </g>
                  </a>
                );
              })}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="tooltip" style={{ left: Math.min(hover.x + 12, 520), top: hover.y + 12 }}>
          <strong>
            {hover.p.agent} · {hover.p.scenarioId}
          </strong>
          Pass rate {pct(hover.p.rate)} ({hover.p.passed}/{hover.p.scored})
          <br />
          95% CI {pct(hover.p.low)} – {pct(hover.p.high)}
          {hover.p.passHat5 !== undefined && (
            <>
              <br />
              pass^5 {pct(hover.p.passHat5)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
