/** Static checks for plgkit/nudges config and message files. */

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const AUDIENCE_LISTS = ["require_all", "require_one_of", "exclude"] as const;
const MSG_PREFIX = /^\d{14}-[a-z0-9-]+$/;

export function validate(
  config: Record<string, unknown>,
  messages: Array<Record<string, unknown>>,
  audienceNames: Set<string>,
): string[] {
  const problems: string[] = [];
  problems.push(...checkLocations(config));
  for (const message of messages) {
    const label = String(message._path ?? message.id ?? "message");
    problems.push(...checkMessageAudience(label, message, audienceNames));
    problems.push(...checkMessageId(label, message));
  }
  return problems;
}

export function loadNudgesDir(
  root: string,
  audiencesFile = "audiences.ts",
): {
  config: Record<string, unknown>;
  messages: Array<Record<string, unknown>>;
  audienceNames: Set<string>;
} {
  const configPath = path.join(root, "config.yml");
  if (!fs.existsSync(configPath)) {
    throw new Error(`${configPath}: config.yml not found`);
  }
  const config = parseYaml(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`${configPath}: config must be a mapping`);
  }

  const messagesDir = path.join(root, "messages");
  if (!fs.statSync(messagesDir).isDirectory()) {
    throw new Error(`${messagesDir}: messages/ not found`);
  }
  const messages: Array<Record<string, unknown>> = [];
  for (const name of fs.readdirSync(messagesDir).sort()) {
    if (!name.endsWith(".yml")) continue;
    const filePath = path.join(messagesDir, name);
    const parsed = parseYaml(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${filePath}: message must be a mapping`);
    }
    messages.push({ ...parsed, id: name.slice(0, -4), _path: `messages/${name}` });
  }

  const audPath = path.join(root, audiencesFile);
  if (!fs.existsSync(audPath)) {
    throw new Error(`${audPath}: ${audiencesFile} not found`);
  }
  const audienceNames = audienceNamesFromTypeScript(fs.readFileSync(audPath, "utf8"));
  return { config, messages, audienceNames };
}

export function audienceNamesFromTypeScript(text: string): Set<string> {
  const start = text.indexOf("export const audiences");
  if (start < 0) {
    throw new Error("no export const audiences = {...} found");
  }
  const slice = text.slice(start);
  const end = slice.indexOf("};");
  const body = end >= 0 ? slice.slice(0, end) : slice;
  const names = new Set<string>();
  for (const m of body.matchAll(/^\s*([a-z][a-z0-9_]*)\s*:/gm)) {
    names.add(m[1]);
  }
  if (names.size === 0) {
    throw new Error("no audience keys found in audiences export");
  }
  return names;
}

function checkLocations(config: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const locations = config.locations;
  if (locations == null) return problems;
  if (!isRecord(locations)) {
    problems.push("config.yml: locations must be a mapping");
    return problems;
  }
  for (const [locName, locValue] of Object.entries(locations)) {
    if (!isRecord(locValue)) {
      problems.push(`config.yml: locations.${locName} must be a mapping`);
      continue;
    }
    const locMax = limit(locValue.max, 1);
    if (locMax === null) {
      problems.push(`config.yml: locations.${locName}.max must be a non-negative integer`);
      continue;
    }
    const surfaces = locValue.surfaces;
    if (surfaces == null) continue;
    if (!isRecord(surfaces)) {
      problems.push(`config.yml: locations.${locName}.surfaces must be a mapping`);
      continue;
    }
    for (const [surfaceName, surfaceValue] of Object.entries(surfaces)) {
      if (!isRecord(surfaceValue)) {
        problems.push(`config.yml: locations.${locName}.surfaces.${surfaceName} must be a mapping`);
        continue;
      }
      const surfaceMax = limit(surfaceValue.max, 1);
      if (surfaceMax === null) {
        problems.push(
          `config.yml: locations.${locName}.surfaces.${surfaceName}.max must be a non-negative integer`,
        );
        continue;
      }
      if (surfaceMax > locMax) {
        problems.push(
          `config.yml: locations.${locName}.surfaces.${surfaceName} max ${surfaceMax} ` +
            `is higher than locations.${locName} max ${locMax}`,
        );
      }
    }
  }
  return problems;
}

function checkMessageAudience(
  label: string,
  message: Record<string, unknown>,
  known: Set<string>,
): string[] {
  const spec = message.audience;
  if (spec == null) return [];
  if (!isRecord(spec)) return [`${label}: audience must be a mapping`];
  const problems: string[] = [];
  for (const key of AUDIENCE_LISTS) {
    const names = spec[key];
    if (names == null) continue;
    if (!Array.isArray(names)) {
      problems.push(`${label}: audience.${key} must be a list of names`);
      continue;
    }
    for (const name of names) {
      if (typeof name !== "string" || name === "") {
        problems.push(`${label}: audience.${key} must be a list of names`);
        break;
      }
      if (!known.has(name)) {
        problems.push(`${label}: audience name "${name}" is not in audiences.ts`);
      }
    }
  }
  return problems;
}

function checkMessageId(label: string, message: Record<string, unknown>): string[] {
  const msgId = message.id;
  if (typeof msgId === "string" && msgId && !MSG_PREFIX.test(msgId)) {
    return [`${label}: message id must be YYYYMMDDHHMMSS-slug`];
  }
  return [];
}

function limit(value: unknown, defaultValue: number): number | null {
  if (value == null) return defaultValue;
  if (typeof value === "boolean" || typeof value === "string") return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
