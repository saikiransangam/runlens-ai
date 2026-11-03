import type { RunnerOptions } from "./runner.js";
import type { AgentDefinition, GateConfig, Scenario } from "./types.js";

/** Shape of `runlens.config.ts`, consumed by the `runlens` CLI. */
export interface RunLensConfig extends Omit<RunnerOptions, "onRun"> {
  name: string;
  agents: AgentDefinition[];
  scenarios: Scenario[];
  gate?: GateConfig;
  /** Directory for report output. Default ".runlens". */
  outDir?: string;
}

export function defineConfig(config: RunLensConfig): RunLensConfig {
  return config;
}
