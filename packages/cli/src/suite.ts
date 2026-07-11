import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { parse as parseYaml } from "yaml";

import type { SuiteCase, SuiteFile } from "./types.js";
import type { ScorerConfig } from "@shipgauge/scorers";

function loadCaseFile(casePath: string): Partial<SuiteCase> {
  const raw = readFileSync(casePath, "utf8");
  return parseYaml(raw) as Partial<SuiteCase>;
}

function mergeScorers(
  ...lists: (ScorerConfig[] | undefined)[]
): ScorerConfig[] {
  const merged: ScorerConfig[] = [];
  for (const list of lists) {
    if (list?.length) merged.push(...list);
  }
  return merged;
}

export function resolveSuitePath(
  suitesDir: string,
  suiteName: string,
  cwd: string,
): string {
  const candidates = [
    join(cwd, suitesDir, `${suiteName}.yaml`),
    join(cwd, suitesDir, `${suiteName}.yml`),
    join(cwd, "examples", "suites", `${suiteName}.yaml`),
    join(cwd, "examples", "suites", `${suiteName}.yml`),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error(
    `Suite "${suiteName}" not found. Looked in ${candidates.join(", ")}`,
  );
}

export function loadSuite(suitePath: string): SuiteFile {
  const raw = readFileSync(suitePath, "utf8");
  const suite = parseYaml(raw) as SuiteFile;
  if (!suite.name || !Array.isArray(suite.cases)) {
    throw new Error(`Invalid suite file: ${suitePath}`);
  }

  const suiteDir = join(suitePath, "..");
  const resolvedCases: SuiteCase[] = suite.cases.map((entry) => {
    if (typeof entry === "string") {
      const casePath = join(suiteDir, "cases", `${entry}.yaml`);
      if (!existsSync(casePath)) {
        throw new Error(`Case file not found: ${casePath}`);
      }
      const caseDef = loadCaseFile(casePath);
      return {
        id: entry,
        ...caseDef,
        scorers: mergeScorers(suite.defaults?.scorers, caseDef.scorers),
      } as SuiteCase;
    }

    const caseEntry = entry as SuiteCase;
    if (caseEntry.id && !caseEntry.invoke && !caseEntry.input) {
      const casePath = join(suiteDir, "cases", `${caseEntry.id}.yaml`);
      if (existsSync(casePath)) {
        const caseDef = loadCaseFile(casePath);
        return {
          ...caseDef,
          ...caseEntry,
          scorers: mergeScorers(
            suite.defaults?.scorers,
            caseDef.scorers,
            caseEntry.scorers,
          ),
        } as SuiteCase;
      }
    }

    return {
      ...caseEntry,
      scorers: mergeScorers(suite.defaults?.scorers, caseEntry.scorers),
    };
  });

  return { ...suite, cases: resolvedCases };
}

export function applyCaseDefaults(
  suite: SuiteFile,
  caseDef: SuiteCase,
): SuiteCase {
  return {
    feature_id: suite.defaults?.feature_id,
    model: suite.defaults?.model,
    timeout_ms: suite.defaults?.timeout_ms,
    ...caseDef,
  };
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

export function resolveMessages(
  caseDef: SuiteCase,
): Array<{ role: string; content: string }> {
  const messages = caseDef.input?.messages ?? [];
  const vars = caseDef.vars ?? {};
  return messages.map((m) => ({
    role: m.role,
    content: interpolate(m.content, vars),
  }));
}

export function resolveInvoke(caseDef: SuiteCase): SuiteCase["invoke"] {
  if (caseDef.invoke) {
    if (caseDef.invoke.type === "template") {
      const vars = caseDef.vars ?? {};
      return {
        type: "template",
        template: interpolate(caseDef.invoke.template, vars),
      };
    }
    return caseDef.invoke;
  }

  const messages = resolveMessages(caseDef);
  if (messages.length > 0) {
    return { type: "openai", messages };
  }

  return {
    type: "mock",
    output: "",
    latency_ms: 0,
    cost_usd: 0,
  };
}
