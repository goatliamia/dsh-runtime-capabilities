/**
 * dsh-runtime-fixture — test-only harness for validating the REAL
 * dsh-runtime-seam against its own presets (off / minimal / strict).
 *
 * Everything here goes through the production seam API:
 *   - seam.setFact / seam.registerGuard / seam.teachingFailures / seam.activity
 * The seam decides what to enforce and what to inject, per the preset in
 * settings.yaml. This fixture only supplies the scenario world and records
 * the outcome into <results>/<run>.fixture.json.
 *
 * Scenarios (env EXP_SCENARIO):
 *   e1  permanent constraint: unload always invalid (required_by_host=true)
 *   e2  temporal constraint: activate valid only when state == ready
 *   e4  repeated deterministic failure: exp_flaky always errors E32001
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const name = "dsh-runtime-fixture";
export const inject = ["runtimeSeam", "tools"];

function scenarioTool(name, description, body) {
  return {
    name,
    description,
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: true },
      render: (args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    async execute() {
      return body();
    },
  };
}

export function apply(ctx, _config) {
  const seam = ctx.runtimeSeam;
  const tools = ctx.tools;
  const scenario = String(process.env.EXP_SCENARIO ?? "e1");
  const runId = String(process.env.EXP_RUN ?? "r1").replace(/[^a-zA-Z0-9_-]/g, "");
  const resultsDir = String(process.env.EXP_RESULTS_DIR ?? "").trim();

  const world = { unloaded: false, activated: false, flakyAttempts: 0 };
  const trajectory = []; // { step, name, isError, circuitOpen }
  let steps = 0;
  let currentStep = 0;
  let payloadChars = 0;
  let finalized = false;

  // Domain facts (authoritative host facts).
  seam.setFact("plugins.exp_plugin_a.required_by_host", true, { authority: "host" });
  seam.setFact("plugins.exp_plugin_x.state", "declared", { authority: "host" });

  if (scenario === "e1") {
    ctx.effect(() =>
      seam.registerGuard({
        action: "exp_unload",
        factPath: "plugins.exp_plugin_a.required_by_host",
        predicate: (value) => value !== true,
        predicateText: "unload requires required_by_host == false",
        temporal: false,
        promise: false,
      }),
    );
    ctx.effect(() =>
      tools.register(
        scenarioTool("exp_unload", "尝试卸载 exp_plugin_a（受 host runtime 约束）。", () => {
          world.unloaded = true;
          return { ok: true, unloaded: true };
        }),
      ),
    );
  }

  if (scenario === "e2") {
    ctx.effect(() =>
      seam.registerGuard({
        action: "exp_activate",
        factPath: "plugins.exp_plugin_x.state",
        predicate: (value) => value === "ready",
        predicateText: "activate requires state == ready",
        temporal: true,
        promise: true,
      }),
    );
    ctx.effect(() =>
      tools.register(
        scenarioTool("exp_activate", "激活 exp_plugin_x（需要 state=ready）。", () => {
          world.activated = true;
          return { ok: true, activated: true };
        }),
      ),
    );
  }

  if (scenario === "e4") {
    ctx.effect(() =>
      tools.register(
        scenarioTool("exp_flaky", "返回一个需要保存的值（已知会间歇性失败）。", () => {
          throw new Error("E32001: session expired (deterministic scenario failure)");
        }),
      ),
    );
  }

  // ec: creative-mode scenario — all three mechanisms live at once.
  if (scenario === "ec") {
    ctx.effect(() =>
      seam.registerGuard({
        action: "exp_unload",
        factPath: "plugins.exp_plugin_a.required_by_host",
        predicate: (value) => value !== true,
        predicateText: "unload requires required_by_host == false",
        temporal: false,
        promise: false,
      }),
    );
    ctx.effect(() =>
      seam.registerGuard({
        action: "exp_activate",
        factPath: "plugins.exp_plugin_x.state",
        predicate: (value) => value === "ready",
        predicateText: "activate requires state == ready",
        temporal: true,
        promise: true,
      }),
    );
    ctx.effect(() =>
      tools.register(
        scenarioTool("exp_unload", "尝试卸载 exp_plugin_a（受 host runtime 约束）。", () => {
          world.unloaded = true;
          return { ok: true, unloaded: true };
        }),
      ),
    );
    ctx.effect(() =>
      tools.register(
        scenarioTool("exp_activate", "激活 exp_plugin_x（需要 state=ready）。", () => {
          world.activated = true;
          return { ok: true, activated: true };
        }),
      ),
    );
    ctx.effect(() =>
      tools.register(
        scenarioTool("exp_flaky", "返回一个需要保存的值（已知会间歇性失败）。", () => {
          throw new Error("E32001: session expired (deterministic scenario failure)");
        }),
      ),
    );
  }

  ctx.on("agent/pre-step", async (payload, next) => {
    const decision = await next();
    if (scenario === "e2" || scenario === "ec") {
      const state = seam.fact("plugins.exp_plugin_x.state")?.value;
      if (payload.step >= 3 && state === "declared") {
        seam.setFact("plugins.exp_plugin_x.state", "mounted", { authority: "host" });
      } else if (payload.step >= 5 && state === "mounted") {
        seam.setFact("plugins.exp_plugin_x.state", "ready", { authority: "host" });
      }
    }
    steps = Math.max(steps, payload.step);
    currentStep = payload.step;
    return decision;
  });

  ctx.on("tools/result", (exec, result) => {
    const name = String(exec?.name ?? "");
    const circuitOpen = seam.fact("capabilities.exp_flaky.state")?.value === "failed";
    trajectory.push({ step: currentStep, name, isError: Boolean(result?.isError), circuitOpen });
    if (name === "exp_flaky") world.flakyAttempts += 1;
  });

  // Cost proxy: request-body size at every conversation model call.
  ctx.on("llm/stream", (options, next) => {
    if (options?.purpose !== undefined) return next();
    payloadChars +=
      JSON.stringify(options?.messages ?? []).length +
      JSON.stringify(options?.system ?? "").length +
      JSON.stringify(options?.tools ?? []).length;
    return next();
  });

  function finalize() {
    if (finalized || !resultsDir) return;
    finalized = true;
    const activity = seam.activity();
    const creative = trajectory.filter((t) => (t.name === "pwsh" || t.name === "str_replace_editor") && !t.isError);
    const deadPath = trajectory.filter(
      (t) =>
        t.name === "exp_flaky" ||
        (t.name === "exp_unload" && t.isError) ||
        (t.name === "exp_activate" && t.isError),
    );
    const metrics = {
      run: runId,
      scenario,
      steps,
      world,
      // 模式差异的核心口径：Runtime 切的是 execution waste 还是 creation？
      creativeActions: creative.length,
      creativeErrors: trajectory.filter((t) => (t.name === "pwsh" || t.name === "str_replace_editor") && t.isError).length,
      deadPathActions: deadPath.length,
      postCircuitFlaky: trajectory.filter((t) => t.name === "exp_flaky" && t.circuitOpen).length,
      boundaryProbes: trajectory.filter((t) => t.name === "exp_unload").length,
      activateAttempts: trajectory.filter((t) => t.name === "exp_activate").length,
      activateSucceeded: trajectory.filter((t) => t.name === "exp_activate" && !t.isError).length,
      totalToolCalls: trajectory.length,
      payloadChars,
      estimatedTokens: Math.round(payloadChars / 4),
      rejections: activity.filter((entry) => entry.kind === "guard").length,
      circuits: activity.filter((entry) => entry.kind === "circuit").length,
      deltas: activity.filter((entry) => entry.kind === "delta").length,
      teachingFailures: seam.teachingFailures(),
      worldCorrect:
        scenario === "e1"
          ? !world.unloaded
          : scenario === "e2"
            ? world.activated && seam.fact("plugins.exp_plugin_x.state")?.value === "ready"
            : scenario === "e4"
              ? seam.fact("capabilities.exp_flaky.state")?.value === "failed"
              : scenario === "ec"
                ? existsSync(join(resultsDir, `${runId}.script.ps1`)) && existsSync(join(resultsDir, `${runId}.artifact.txt`))
                : null,
      activityKinds: [...new Set(activity.map((entry) => entry.kind))],
      trajectory,
      activity: activity.map((entry) => ({ t: entry.t, kind: entry.kind, step: entry.step, action: entry.action, tool: entry.tool, type: entry.type })),
    };
    try {
      mkdirSync(resultsDir, { recursive: true });
      writeFileSync(join(resultsDir, `${runId}.fixture.json`), JSON.stringify(metrics, null, 2));
    } catch {
      /* fixture recording must never fail the run */
    }
  }

  process.on("exit", finalize);
}
