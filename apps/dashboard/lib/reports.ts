import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SuiteReport } from "@runlens/core";

/** Directory the CLI writes to. Each run is <dir>/<report id>/report.json. */
export const REPORTS_DIR = resolve(process.env.RUNLENS_REPORTS_DIR ?? join(process.cwd(), "../../examples/customer-support/.runlens"));

export async function listReports(): Promise<SuiteReport[]> {
  let entries: string[];
  try {
    entries = await readdir(REPORTS_DIR);
  } catch {
    return [];
  }
  const reports: SuiteReport[] = [];
  for (const name of entries) {
    const file = join(REPORTS_DIR, name, "report.json");
    try {
      if (!(await stat(file)).isFile()) continue;
      reports.push(JSON.parse(await readFile(file, "utf8")) as SuiteReport);
    } catch {
      // skip directories without a readable report
    }
  }
  return reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getReport(id: string): Promise<SuiteReport | undefined> {
  if (!/^[\w.-]+$/.test(id)) return undefined;
  try {
    return JSON.parse(await readFile(join(REPORTS_DIR, id, "report.json"), "utf8")) as SuiteReport;
  } catch {
    return undefined;
  }
}
