import * as failproof from "failproofai";

const { customPolicies, allow, deny, instruct } =
  failproof.default ?? failproof;

const hasText = (value) =>
  typeof value === "string" && value.trim().length > 0;
const isTrue = (value) => value === true;

function normalizeInput(input = {}) {
  if (!input || typeof input !== "object") return {};
  if (typeof input.command !== "string") return input;
  try {
    const parsed = JSON.parse(input.command);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ...input, ...parsed };
    }
  } catch {
    return input;
  }
  return input;
}

function toolName(ctx) {
  return ctx?.toolName ?? ctx?.payload?.tool_name ?? "";
}

function commandOf(ctx, input) {
  if (hasText(ctx?.toolInput?.command)) return ctx.toolInput.command;
  if (hasText(input.command)) return input.command;
  return "";
}

function userApproved(input) {
  return (
    isTrue(input.user_approved) ||
    isTrue(input.confirmed_policy_publish) ||
    isTrue(input.confirmed_policy_install) ||
    hasText(input.approval_id)
  );
}

/** Publishing / installing / deploying Failproof policy packs or Cloud policies. */
function isPolicyLifecycleCommand(cmd) {
  if (!hasText(cmd)) return false;
  // failproofai / npx failproofai publish & policies add/remove
  if (
    /\b(failproofai|npx\s+[^\n]*failproofai)\b[^\n]*\b(publish|policies\s+(add|remove|install|-i))\b/i.test(
      cmd
    )
  ) {
    return true;
  }
  // node …/failproofai/dist/cli.mjs publish|policies add
  if (
    /\bfailproofai\/dist\/cli\.mjs\b[^\n]*\b(publish|policies\s+(add|remove))\b/i.test(
      cmd
    )
  ) {
    return true;
  }
  // scripts that wrap pack publish
  if (
    /\b(release-pack|publish-pack|install-pack)\.mjs\b/i.test(cmd) &&
    !/\b--dry-run\b/i.test(cmd)
  ) {
    return true;
  }
  // fp Cloud: policies publish / enable / fleet deploy --add
  if (
    /\bfp\b[^\n]*\bpolicies\s+(publish|enable|disable|delete)\b/i.test(cmd)
  ) {
    return true;
  }
  if (/\bfp\b[^\n]*\bfleet\s+deploy\b/i.test(cmd)) {
    return true;
  }
  return false;
}

/** Writing or editing policy source / pack manifests. */
function isPolicySourceWrite(tool, input, cmd) {
  const path =
    input.path ??
    input.file_path ??
    input.filePath ??
    input.target_file ??
    "";
  const paths = [
    path,
    ...(Array.isArray(input.paths) ? input.paths : []),
  ]
    .filter(hasText)
    .join("\n");

  const policyPath =
    /(?:^|\/)policies\/[^/\s]+\.mjs\b/i.test(paths) ||
    /(?:^|\/)[^/\s]*-policies\.mjs\b/i.test(paths) ||
    /failproofai-pack\.(mjs|json)\b/i.test(paths) ||
    /(?:^|\/)dist-pack\//i.test(paths);

  if (
    (tool === "Write" ||
      tool === "Edit" ||
      tool === "StrReplace" ||
      tool === "CreateFile" ||
      tool === "ApplyPatch" ||
      tool === "Delete" ||
      tool === "DeleteFile") &&
    policyPath
  ) {
    return true;
  }

  // Shell redirects into policy files
  if (
    tool === "Bash" &&
    hasText(cmd) &&
    (/>\s*['"]?[^'"\n]*policies\/[^/\s]+\.mjs/i.test(cmd) ||
      /\btee\b[^\n]*policies\/[^/\s]+\.mjs/i.test(cmd) ||
      /\bmv\b[^\n]*policies\/[^/\s]+\.mjs/i.test(cmd))
  ) {
    return true;
  }

  return false;
}

function isDryRunOnly(cmd) {
  if (!hasText(cmd)) return false;
  // Dry-run builds or previews only — never mutates GitHub/Cloud/fleet.
  if (!/--dry-run\b/i.test(cmd)) return false;
  // fleet deploy has no meaningful dry-run; still require approval if present.
  if (/\bfleet\s+deploy\b/i.test(cmd)) return false;
  return true;
}

customPolicies.add({
  name: "block-unattended-policy-publish",
  description:
    "Deny Failproof policy pack publish / Cloud publish / fleet deploy / policies add|remove unless the user explicitly approved this action.",
  category: "agent-reliability",
  defaultEnabled: true,
  match: { events: ["PreToolUse"] },
  fn: async (ctx) => {
    const name = toolName(ctx);
    const input = normalizeInput(ctx.toolInput ?? {});
    const cmd = commandOf(ctx, input);

    if (name !== "Bash" && name !== "Shell") return allow();
    if (!isPolicyLifecycleCommand(cmd)) return allow();
    if (isDryRunOnly(cmd)) return allow();

    if (userApproved(input)) return allow();

    return deny(
      "Policy publish/install/deploy requires explicit user approval. " +
        "Set user_approved=true or approval_id / confirmed_policy_publish on the tool input after the user confirms."
    );
  },
});

customPolicies.add({
  name: "block-unattended-policy-source-edit",
  description:
    "Deny writing or editing Failproof policy source files (policies/*.mjs, pack manifests) without user approval.",
  category: "agent-reliability",
  defaultEnabled: true,
  match: { events: ["PreToolUse"] },
  fn: async (ctx) => {
    const name = toolName(ctx);
    const input = normalizeInput(ctx.toolInput ?? {});
    const cmd = commandOf(ctx, input);

    if (!isPolicySourceWrite(name, input, cmd)) return allow();
    if (userApproved(input)) return allow();

    return deny(
      "Editing Failproof policy source requires explicit user approval " +
        "(user_approved / approval_id). Policy files change what agents are allowed to do."
    );
  },
});

customPolicies.add({
  name: "instruct-review-policy-before-publish",
  description:
    "When a policy lifecycle command is approved, remind the agent to show the user the policy source and effect (enforce vs observe) before proceeding.",
  category: "agent-reliability",
  defaultEnabled: true,
  match: { events: ["PreToolUse"] },
  fn: async (ctx) => {
    const name = toolName(ctx);
    const input = normalizeInput(ctx.toolInput ?? {});
    const cmd = commandOf(ctx, input);

    if (name !== "Bash" && name !== "Shell") return allow();
    if (!isPolicyLifecycleCommand(cmd)) return allow();
    if (isDryRunOnly(cmd)) return allow();
    if (!userApproved(input)) return allow(); // deny policy handles unapproved

    return instruct(
      "User approved this policy lifecycle action. Before running it, confirm: " +
        "(1) policy source reviewed, (2) enforce vs observe, (3) target repo/machine is sank8-2-owned / intended."
    );
  },
});
