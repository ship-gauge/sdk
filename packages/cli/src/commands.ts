import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const DEFAULT_CONFIG = `# ShipGauge project config
api_key: sg_ingest_YOUR_KEY_HERE
project_id: YOUR_PROJECT_UUID
base_url: http://localhost:3000
suites_dir: suites
`;

const DEFAULT_SUITE = `name: smoke
version: 1
defaults:
  model: gpt-4o-mini
  feature_id: chat
  timeout_ms: 30000

cases:
  - id: greeting_en
    invoke:
      type: mock
      output: "Hello! I'm here to help you with any questions."
      latency_ms: 120
      cost_usd: 0.0001
    scorers:
      - type: contains
        value: help
        case_insensitive: true
      - type: regex
        pattern: "assist|help"
        flags: i
      - type: latency_max_ms
        max: 5000
      - type: cost_max_usd
        max: 0.01

  - id: json_extract
    invoke:
      type: mock
      output: '{"amount": 42.5, "currency": "USD"}'
      latency_ms: 80
      cost_usd: 0.0002
    scorers:
      - type: json_schema
        schema:
          type: object
          required: [amount, currency]
          properties:
            amount:
              type: number
            currency:
              type: string
`;

export function runInit(cwd = process.cwd()): void {
  const configDir = join(cwd, ".shipgauge");
  const suitesDir = join(cwd, "suites");

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  if (!existsSync(suitesDir)) {
    mkdirSync(suitesDir, { recursive: true });
  }

  const configPath = join(configDir, "config.yml");
  const suitePath = join(suitesDir, "smoke.yaml");

  if (!existsSync(configPath)) {
    writeFileSync(configPath, DEFAULT_CONFIG);
    console.log(`Created ${configPath}`);
  } else {
    console.log(`Config already exists: ${configPath}`);
  }

  if (!existsSync(suitePath)) {
    writeFileSync(suitePath, DEFAULT_SUITE);
    console.log(`Created ${suitePath}`);
  } else {
    console.log(`Suite already exists: ${suitePath}`);
  }

  const gatePath = join(configDir, "gate.yml");
  if (!existsSync(gatePath)) {
    const templateDir = dirname(fileURLToPath(import.meta.url));
    const templatePath = join(templateDir, "gate-template.yml");
    if (existsSync(templatePath)) {
      writeFileSync(gatePath, readFileSync(templatePath, "utf8"));
    } else {
      writeFileSync(
        gatePath,
        `suite: smoke
rules:
  pass_rate:
    min: 0.95
    max_drop: 0.05
  avg_cost_usd:
    max_increase: 0.20
  fail_on_any_case: true
bypass_label: shipgauge-skip
`,
      );
    }
    console.log(`Created ${gatePath}`);
  }

  console.log("\nNext steps:");
  console.log("  1. Edit .shipgauge/config.yml with your API key and project ID");
  console.log("  2. Run: shipgauge eval --suite smoke");
  console.log("  3. CI: shipgauge gate check --pr-comment");
}

export function runDoctor(cwd = process.cwd()): number {
  const issues: string[] = [];
  const configPath = join(cwd, ".shipgauge", "config.yml");

  if (!existsSync(configPath)) {
    issues.push("Missing .shipgauge/config.yml — run `shipgauge init`");
  } else {
    const raw = readFileSync(configPath, "utf8");
    if (raw.includes("YOUR_KEY_HERE") || raw.includes("YOUR_PROJECT_UUID")) {
      issues.push("config.yml still has placeholder values");
    }
  }

  const smokePath = join(cwd, "suites", "smoke.yaml");
  if (!existsSync(smokePath)) {
    issues.push("Missing suites/smoke.yaml");
  }

  if (issues.length > 0) {
    console.log("❌ ShipGauge doctor found issues:\n");
    for (const issue of issues) {
      console.log(`  • ${issue}`);
    }
    return 1;
  }

  console.log("✅ ShipGauge config looks good");
  return 0;
}
