import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = join(root, "policies/policy-creation-guard.mjs");

const failproof = await import("failproofai");
const api = failproof.default ?? failproof;
api.clearCustomHooks?.();
await import(`${pathToFileURL(policyPath).href}?t=${Date.now()}`);
const hooks = api.getCustomHooks();
assert.ok(hooks.length >= 3, `expected >=3 hooks, got ${hooks.length}`);

async function evaluate(toolName, toolInput) {
  const results = [];
  for (const hook of hooks) {
    if (!hook.match?.events?.includes("PreToolUse")) continue;
    results.push(
      await hook.fn({
        eventType: "PreToolUse",
        toolName,
        toolInput,
        payload: { tool_name: toolName, tool_input: toolInput },
      })
    );
  }
  const denied = results.find((r) => r.decision === "deny");
  const instructed = results.find((r) => r.decision === "instruct");
  return {
    decision: denied ? "deny" : instructed ? "instruct" : "allow",
    reason: denied?.reason ?? instructed?.reason ?? null,
  };
}

test("failproofai publish without approval is denied", async () => {
  const r = await evaluate("Bash", {
    command: "failproofai publish policies/x.mjs --repo sank8-2/x",
  });
  assert.equal(r.decision, "deny");
  assert.match(r.reason ?? "", /approval/i);
});

test("fp policies publish without approval is denied", async () => {
  const r = await evaluate("Bash", {
    command: "fp policies publish my-policy ./rule.mjs",
  });
  assert.equal(r.decision, "deny");
});

test("fp fleet deploy without approval is denied", async () => {
  const r = await evaluate("Bash", {
    command: "fp fleet deploy abc --add my-policy -y",
  });
  assert.equal(r.decision, "deny");
});

test("policies add without approval is denied", async () => {
  const r = await evaluate("Bash", {
    command: "failproofai policies add sank8-2/idempotent-writes --all",
  });
  assert.equal(r.decision, "deny");
});

test("dry-run publish is allowed", async () => {
  const r = await evaluate("Bash", {
    command: "failproofai publish policies/x.mjs --dry-run --id sank8-2/x",
  });
  assert.equal(r.decision, "allow");
});

test("approved publish instructs then allows", async () => {
  const r = await evaluate("Bash", {
    command: "failproofai publish policies/x.mjs --repo sank8-2/x",
    user_approved: true,
  });
  assert.equal(r.decision, "instruct");
  assert.match(r.reason ?? "", /reviewed|enforce/i);
});

test("Write to policies/*.mjs without approval is denied", async () => {
  const r = await evaluate("Write", {
    path: "policies/evil.mjs",
    contents: "export {}",
  });
  assert.equal(r.decision, "deny");
});

test("approved Write to policy file is allowed", async () => {
  const r = await evaluate("Write", {
    path: "policies/ok.mjs",
    contents: "export {}",
    approval_id: "user-said-yes-1",
  });
  assert.equal(r.decision, "allow");
});

test("unrelated bash is allowed", async () => {
  const r = await evaluate("Bash", { command: "ls -la" });
  assert.equal(r.decision, "allow");
});

test("fp policies test deny path", () => {
  const fp = `${process.env.HOME}/.local/bin/fp`;
  const result = spawnSync(
    fp,
    [
      "policies",
      "test",
      policyPath,
      "--tool",
      "Bash",
      "--command",
      "fp policies publish x ./x.mjs",
    ],
    { encoding: "utf8" }
  );
  if (result.error?.code === "ENOENT") return;
  assert.match(`${result.stdout}\n${result.stderr}`, /deny|DENY|approval/i);
});
