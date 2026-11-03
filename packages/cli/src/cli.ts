#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  findRegressions,
  ReliabilityRunner,
  requiredRuns,
  toConsole,
  toJSON,
  toJUnit,
  toMarkdown,
  type RunLensConfig,
  type SuiteReport,
  type ToolMode,
} from "@runlens/core";
import { Command, InvalidArgumentError } from "commander";
import { createJiti } from "jiti";

const CONFIG_NAMES = ["runlens.config.ts", "runlens.config.mts", "runlens.config.js", "runlens.config.mjs"];

function int(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) throw new InvalidArgumentError("must be a positive integer");
  return n;
}

function float(value: string): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n <= 0 || n >= 1) throw new InvalidArgumentError("must be between 0 and 1");
  return n;
}

async function loadConfig(path?: string): Promise<{ config: RunLensConfig; file: string }> {
  const file = path ? resolve(path) : CONFIG_NAMES.map((n) => resolve(n)).find((p) => existsSync(p));
  if (!file || !existsSync(file)) {
    throw new Error(`No config found. Pass --config or create one of: ${CONFIG_NAMES.join(", ")}`);
  }
  const jiti = createJiti(import.meta.url);
  const mod = (await jiti.import(file)) as { default?: RunLensConfig } & RunLensConfig;
  return { config: mod.default ?? mod, file };
}

async function readReport(path: string): Promise<SuiteReport> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as SuiteReport;
}

function gitInfo(): SuiteReport["git"] | undefined {
  const sha = process.env.GITHUB_SHA ?? tryExec("git rev-parse HEAD");
  const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || tryExec("git rev-parse --abbrev-ref HEAD");
  return sha || branch ? { ...(sha ? { sha } : {}), ...(branch ? { branch } : {}) } : undefined;
}

function tryExec(cmd: string): string | undefined {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

const program = new Command()
  .name("runlens")
  .description("Statistical reliability testing for AI agents.")
  .version("0.1.0");

program
  .command("run")
  .description("Run every scenario against every agent N times and write reports.")
  .option("-c, --config <path>", "config file (default: runlens.config.ts)")
  .option("-n, --runs <n>", "executions per scenario", int)
  .option("--concurrency <n>", "executions in flight at once", int)
  .option("--tool-mode <mode>", "live | frozen")
  .option("-b, --baseline <report.json>", "compare against a previous report and flag significant regressions")
  .option("-o, --out <dir>", "output directory")
  .option("--no-gate", "never exit non-zero because of the gate")
  .action(async (opts) => {
    const { config } = await loadConfig(opts.config);
    const toolMode = (opts.toolMode ?? config.toolMode) as ToolMode | undefined;
    if (toolMode && toolMode !== "live" && toolMode !== "frozen") throw new Error("--tool-mode must be live or frozen");
    const baseline = opts.baseline ? await readReport(opts.baseline) : undefined;

    const total = (opts.runs ?? config.runs ?? 20) * config.agents.length * config.scenarios.length;
    let done = 0;
    const tty = process.stderr.isTTY;
    const runner = new ReliabilityRunner({
      ...config,
      runs: opts.runs ?? config.runs,
      concurrency: opts.concurrency ?? config.concurrency,
      toolMode,
      onRun: (e) => {
        done++;
        const line = `[${done}/${total}] ${e.agent} / ${e.scenarioId} run ${e.run.index + 1}: ${e.run.status}`;
        if (tty) process.stderr.write(`\r\x1b[K${line}`);
        else if (done === total || done % 25 === 0) process.stderr.write(`${line}\n`);
      },
    });

    const suite = await runner.runSuite({
      name: config.name,
      agents: config.agents,
      scenarios: config.scenarios,
      gate: config.gate,
      baseline,
      git: gitInfo(),
    });
    if (tty) process.stderr.write("\r\x1b[K");

    const outRoot = resolve(opts.out ?? config.outDir ?? ".runlens");
    const dir = join(outRoot, suite.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "report.json"), toJSON(suite));
    await writeFile(join(dir, "junit.xml"), toJUnit(suite));
    await writeFile(join(dir, "summary.md"), toMarkdown(suite));
    await writeFile(join(outRoot, "latest.json"), toJSON(suite));
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, toMarkdown(suite));

    console.log(toConsole(suite));
    console.log(`\nReports written to ${dir}`);
    if (opts.gate && suite.gate && !suite.gate.passed) process.exitCode = 1;
  });

program
  .command("compare")
  .description("Compare two reports and flag statistically significant regressions.")
  .argument("<baseline>", "baseline report.json")
  .argument("<current>", "current report.json")
  .option("--alpha <p>", "significance level", float, 0.05)
  .action(async (basePath: string, curPath: string, opts: { alpha: number }) => {
    const [baseline, current] = await Promise.all([readReport(basePath), readReport(curPath)]);
    const regressions = findRegressions(current, baseline, opts.alpha);
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    for (const r of regressions) {
      const flag = r.significant ? "REGRESSION" : r.currentPassRate < r.baselinePassRate ? "within noise" : "ok";
      console.log(
        `${flag.padEnd(12)} ${r.agent} / ${r.scenarioId}: ${pct(r.baselinePassRate)} → ${pct(r.currentPassRate)} (p=${r.pValue.toFixed(3)})`,
      );
    }
    if (regressions.some((r) => r.significant)) process.exitCode = 1;
  });

program
  .command("sample-size")
  .description("How many runs you need to estimate a pass rate to a given margin.")
  .option("-m, --margin <x>", "half-width of the interval, e.g. 0.05 for +/-5 points", float, 0.05)
  .option("-p, --rate <x>", "expected pass rate (default: worst case 0.5)", float, 0.5)
  .option("--confidence <x>", "0.9, 0.95 or 0.99", float, 0.95)
  .action((opts: { margin: number; rate: number; confidence: number }) => {
    const n = requiredRuns(opts.margin, opts.rate, opts.confidence);
    console.log(
      `${n} runs to estimate a ~${(opts.rate * 100).toFixed(0)}% pass rate within ±${(opts.margin * 100).toFixed(1)} points at ${opts.confidence * 100}% confidence.`,
    );
  });

program.parseAsync().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
