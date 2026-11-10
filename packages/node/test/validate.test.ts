import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadNudgesDir, validate } from "../src/validate.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const examples = path.join(repo, "spec/examples");
const typescriptAudiences = path.join(examples, "typescript/audiences.ts");

function tempExamplesDir(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plgkit-validate-"));
  fs.cpSync(path.join(examples, "messages"), path.join(tmp, "messages"), { recursive: true });
  fs.copyFileSync(path.join(examples, "config.yml"), path.join(tmp, "config.yml"));
  fs.copyFileSync(typescriptAudiences, path.join(tmp, "audiences.ts"));
  return tmp;
}

test("spec examples pass with audiences.ts", () => {
  const tmp = tempExamplesDir();
  const { config, messages, audienceNames } = loadNudgesDir(tmp, "audiences.ts");
  assert.deepEqual(validate(config, messages, audienceNames), []);
});

test("unknown audience name", () => {
  const problems = validate(
    {},
    [
      {
        _path: "messages/x.yml",
        id: "20260101120000-test-banner",
        audience: { require_all: ["missing_fn"] },
      },
    ],
    new Set(["is_human"]),
  );
  assert.ok(problems.some((line) => line.includes("missing_fn")));
});

test("surface max higher than location max", () => {
  const problems = validate(
    {
      locations: {
        home: { max: 1, surfaces: { sidebar: { max: 3 } } },
      },
    },
    [],
    new Set(),
  );
  assert.ok(problems.some((line) => line.includes("sidebar")));
});
