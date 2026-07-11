import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";

import { parse as parseYaml } from "yaml";

import type { ShipGaugeConfig } from "./types.js";

const CONFIG_PATH = ".shipgauge/config.yml";

export function findConfigPath(cwd = process.cwd()): string | null {
  let dir = cwd;
  while (true) {
    const candidate = join(dir, CONFIG_PATH);
    if (existsSync(candidate)) return candidate;
    const parent = join(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadConfig(cwd = process.cwd()): ShipGaugeConfig {
  const path = findConfigPath(cwd);
  if (!path) {
    throw new Error(
      "No .shipgauge/config.yml found. Run `shipgauge init` first.",
    );
  }
  const raw = readFileSync(path, "utf8");
  const config = parseYaml(raw) as ShipGaugeConfig;
  if (!config.api_key || !config.project_id) {
    throw new Error("config.yml must include api_key and project_id");
  }
  return {
    base_url: "http://localhost:3000",
    suites_dir: "suites",
    ...config,
  };
}

export function getConfigDir(cwd = process.cwd()): string {
  const path = findConfigPath(cwd);
  if (!path) {
    throw new Error("No .shipgauge/config.yml found.");
  }
  return dirname(dirname(path));
}
