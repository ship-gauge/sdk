#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { fetchBaseline, fetchBudgetStatus, uploadEvalRun, uploadGateCheck } from "./api.js";
import { loadConfig, getConfigDir } from "./config.js";
import { runDoctor, runInit } from "./commands.js";
import {
  checkGate,
  formatGateReport,
  formatPrComment,
  loadBaseline,
  loadGateConfig,
  resolveGitRef,
  resolveSuiteName,
  postPrComment,
  upsertPrComment,
  postGitHubCheckRun,
  postGitHubCheckRunSimple,
} from "./gate.js";
import { findAndRunSuite, formatReport } from "./runner.js";

function printUsage(): void {
  console.log(`shipgauge — Pre-ship eval CLI for ShipGauge

Usage:
  shipgauge init                     Create .shipgauge/config.yml + smoke suite
  shipgauge doctor                   Validate local configuration
  shipgauge eval --suite <name>      Run eval suite (exit 0 = pass, 1 = fail)
  shipgauge gate check               Run eval + compare to baseline (CI gate)
  shipgauge budget status            Show budget rules and spend (alias: budgets)

Options:
  --suite <name>       Suite name (default: smoke)
  --no-upload          Skip uploading results to ShipGauge API
  --github-summary     Write report to GITHUB_STEP_SUMMARY
  --pr-comment         Post gate result as PR comment (needs GITHUB_TOKEN)
  --status-check       Create GitHub check run (needs GITHUB_TOKEN)
  --git-sha <sha>      Git commit SHA for this run
  --pr-number <n>      Pull request number
  --baseline <ref>     Compare against baseline (main | local | branch name)
  --help               Show this help
`);
}

function parsePrNumber(): number | undefined {
  if (!process.env.GITHUB_EVENT_PATH) return undefined;
  try {
    const event = JSON.parse(
      readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"),
    ) as { pull_request?: { number?: number } };
    return event.pull_request?.number;
  } catch {
    return undefined;
  }
}

function hasBypassLabel(label: string): boolean {
  if (!process.env.GITHUB_EVENT_PATH) return false;
  try {
    const event = JSON.parse(
      readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"),
    ) as { pull_request?: { labels?: Array<{ name: string }> } };
    return event.pull_request?.labels?.some((l) => l.name === label) ?? false;
  } catch {
    return false;
  }
}

function parseArgs(argv: string[]): {
  command: string;
  subcommand?: string;
  suite: string;
  noUpload: boolean;
  githubSummary: boolean;
  prComment: boolean;
  statusCheck: boolean;
  gitSha?: string;
  prNumber?: number;
  baseline?: string;
} {
  const args = argv.slice(2);
  const command = args[0] ?? "help";
  const subcommand =
    command === "gate" || command === "budget" || command === "budgets"
      ? args[1]
      : undefined;
  let suite = "smoke";
  let noUpload = false;
  let githubSummary = false;
  let prComment = false;
  let statusCheck = false;
  let gitSha: string | undefined;
  let prNumber: number | undefined;
  let baseline: string | undefined;

  const startIdx =
    command === "gate" || command === "budget" || command === "budgets" ? 2 : 1;
  for (let i = startIdx; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--suite" && args[i + 1]) {
      suite = args[++i];
    } else if (arg === "--no-upload") {
      noUpload = true;
    } else if (arg === "--github-summary") {
      githubSummary = true;
    } else if (arg === "--pr-comment") {
      prComment = true;
    } else if (arg === "--status-check") {
      statusCheck = true;
    } else if (arg === "--git-sha" && args[i + 1]) {
      gitSha = args[++i];
    } else if (arg === "--pr-number" && args[i + 1]) {
      prNumber = Number(args[++i]);
    } else if (arg === "--baseline" && args[i + 1]) {
      baseline = args[++i];
    }
  }

  return {
    command,
    subcommand,
    suite,
    noUpload,
    githubSummary,
    prComment,
    statusCheck,
    gitSha: gitSha ?? process.env.GITHUB_SHA,
    prNumber: prNumber ?? parsePrNumber(),
    baseline,
  };
}

async function runGateCheck(options: {
  suite: string;
  noUpload: boolean;
  githubSummary: boolean;
  prComment: boolean;
  statusCheck: boolean;
  gitSha?: string;
  gitRef?: string;
  prNumber?: number;
  baseline?: string;
}): Promise<number> {
  const config = loadConfig();
  const configDir = getConfigDir();
  const gateConfig = loadGateConfig(configDir);
  const suiteName =
    options.suite ||
    resolveSuiteName(gateConfig, process.env.SHIPGAUGE_ENV ?? process.env.VERCEL_ENV);
  const suitesDir = config.suites_dir ?? "suites";

  let baseline =
    (options.baseline === "local" ? loadBaseline(configDir, suiteName) : null) ??
  (options.baseline && options.baseline !== "local"
      ? await fetchBaseline(config, suiteName, options.baseline).catch(() => null)
      : null) ??
    loadBaseline(configDir, suiteName) ??
    (await fetchBaseline(config, suiteName, options.gitRef ?? resolveGitRef()).catch(
      () => null,
    ));

  const current = await findAndRunSuite({
    suiteName,
    suitesDir,
    cwd: configDir,
    gitSha: options.gitSha,
    gitRef: options.gitRef ?? resolveGitRef(),
    prNumber: options.prNumber,
  });

  console.log(formatReport(current));
  console.log("");

  if (!baseline) {
    console.log("No baseline found — saving current run as baseline.");
    const baselineDir = join(configDir, ".shipgauge", "baselines");
    if (!existsSync(baselineDir)) mkdirSync(baselineDir, { recursive: true });
    writeFileSync(
      join(baselineDir, `${suiteName}.json`),
      JSON.stringify(current, null, 2),
    );

    if (!options.noUpload) {
      try {
        await uploadEvalRun(config, current, process.env.CI ? "ci" : "manual");
      } catch (error) {
        console.warn(
          `Warning: could not upload eval run: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    if (options.statusCheck) {
      try {
        await postGitHubCheckRunSimple({
          passed: true,
          title: "ShipGauge Gate passed (baseline established)",
          summary: `First run for suite **${suiteName}** — baseline saved.\n\nPass rate: ${(current.pass_rate * 100).toFixed(0)}%`,
        });
        console.log("\nCreated GitHub check run");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\nFailed to create required check run: ${message}`);
        return 1;
      }
    }

    console.log("✅ Gate passed (first run, baseline established)");
    return 0;
  }

  const gateResult = checkGate(baseline, current, gateConfig);
  const report = formatGateReport(gateResult);
  console.log(report);

  const bypassLabel = gateConfig.bypass_label ?? "shipgauge-skip";
  const bypassed = hasBypassLabel(bypassLabel);
  const passed = gateResult.passed || bypassed;

  if (bypassed && !gateResult.passed) {
    console.log(`\n⚠️  Gate bypassed via ${bypassLabel} label`);
  }

  if (options.githubSummary && process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## ShipGauge Gate\n\n${formatPrComment(gateResult, bypassLabel)}\n`,
    );
  }

  if (options.prComment) {
    try {
      const action = await upsertPrComment(formatPrComment(gateResult, bypassLabel));
      console.log(`\n${action === "updated" ? "Updated" : "Posted"} PR comment`);
    } catch (error) {
      console.warn(
        `Warning: could not post PR comment: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  if (options.statusCheck) {
    try {
      await postGitHubCheckRun(gateResult, bypassed, { bypassLabel });
      console.log("\nCreated GitHub check run");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\nFailed to create required check run: ${message}`);
      return 1;
    }
  }

  if (!options.noUpload) {
    try {
      await uploadEvalRun(config, current, process.env.CI ? "ci" : "manual");
      await uploadGateCheck(config, {
        suite_name: suiteName,
        passed: gateResult.passed,
        bypassed,
        git_sha: options.gitSha,
        pr_number: options.prNumber,
        report: gateResult as unknown as Record<string, unknown>,
      });
    } catch (error) {
      console.warn(
        `Warning: could not upload results: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  if (passed && gateResult.passed) {
    writeFileSync(
      join(configDir, ".shipgauge", "baselines", `${suiteName}.json`),
      JSON.stringify(current, null, 2),
    );
  }

  return passed ? 0 : 1;
}

function formatBudgetStatus(
  status: Awaited<ReturnType<typeof fetchBudgetStatus>>,
): string {
  const lines = [
    `Project: ${status.project_id}`,
    "",
    "| Scope | Period | Limit | Spent | Used |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const rule of status.rules) {
    const scope =
      rule.scope === "feature" && rule.scope_id
        ? `feature:${rule.scope_id}`
        : rule.scope;
    lines.push(
      `| ${scope} | ${rule.period} | $${rule.limit_usd.toFixed(2)} | $${rule.spent_usd.toFixed(4)} | ${rule.used_pct.toFixed(1)}% |`,
    );
  }

  if (status.override) {
    lines.push(
      "",
      `Override: ${status.override.limit_multiplier}x until ${status.override.expires_at}`,
    );
  }

  return lines.join("\n");
}

async function runBudgetStatus(): Promise<number> {
  const config = loadConfig();
  const status = await fetchBudgetStatus(config);
  console.log(formatBudgetStatus(status));
  return 0;
}

async function main(): Promise<void> {
  const {
    command,
    subcommand,
    suite,
    noUpload,
    githubSummary,
    prComment,
    statusCheck,
    gitSha,
    prNumber,
    baseline,
  } = parseArgs(process.argv);

  if (command === "help" || command === "--help" || !command) {
    printUsage();
    process.exit(0);
  }

  if (command === "init") {
    runInit();
    return;
  }

  if (command === "doctor") {
    process.exit(runDoctor());
  }

  if (command === "gate" && subcommand === "check") {
    process.exit(
      await runGateCheck({
        suite,
        noUpload,
        githubSummary,
        prComment,
        statusCheck,
        gitSha,
        gitRef: resolveGitRef(),
        prNumber,
        baseline,
      }),
    );
  }

  if ((command === "budget" || command === "budgets") && subcommand === "status") {
    try {
      process.exit(await runBudgetStatus());
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }

  if (command === "eval") {
    const config = loadConfig();
    const configDir = getConfigDir();
    const suitesDir = config.suites_dir ?? "suites";
    const gateConfig = loadGateConfig(configDir);
    const gitRef = resolveGitRef();

    const result = await findAndRunSuite({
      suiteName: suite,
      suitesDir,
      cwd: configDir,
      gitSha,
      gitRef,
      prNumber,
    });

    const report = formatReport(result);
    console.log(report);

    if (baseline) {
      const baselineRun =
        baseline === "local"
          ? loadBaseline(configDir, suite)
          : await fetchBaseline(config, suite, baseline).catch(() => null);

      if (baselineRun) {
        const gateResult = checkGate(baselineRun, result, gateConfig);
        console.log("");
        console.log(formatGateReport(gateResult));
        if (!gateResult.passed) {
          process.exit(1);
        }
      } else {
        console.warn(`\nWarning: no baseline found for ref "${baseline}"`);
      }
    }

    if (githubSummary && process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `## ShipGauge Eval\n\n\`\`\`\n${report}\n\`\`\`\n`,
      );
    }

    if (!noUpload) {
      try {
        const { run_id } = await uploadEvalRun(
          config,
          result,
          process.env.CI ? "ci" : "manual",
        );
        console.log(`\nUploaded run: ${run_id}`);
      } catch (error) {
        console.warn(
          `\nWarning: could not upload results: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    if (!baseline) {
      const baselineDir = join(configDir, ".shipgauge", "baselines");
      if (!existsSync(baselineDir)) {
        mkdirSync(baselineDir, { recursive: true });
      }
      writeFileSync(
        join(baselineDir, `${suite}.json`),
        JSON.stringify(result, null, 2),
      );
    }

    process.exit(result.passed_cases === result.total_cases ? 0 : 1);
  }

  console.error(`Unknown command: ${command}${subcommand ? ` ${subcommand}` : ""}`);
  printUsage();
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
