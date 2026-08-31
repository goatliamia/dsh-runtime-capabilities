/**
 * dsh-runtime-experiment — isolated real-DSH runtime guard/provenance A/B host bundle.
 *
 * Round 2 experiments (docs/10-guard-teaching-experiment-design.md):
 *   E1 permanent constraint: exp_unload always invalid (required_by_host=true).
 *   E2 temporal constraint: exp_activate valid only when state == ready.
 *   E3 stale action: exp_run valid only when state == ready (ready -> disabled at step 5).
 *
 * Arms:
 *   none       no guard (invalid actions execute; world diverges)
 *   gplain     guard with teaching reason WITHOUT provenance line
 *   gauth      guard with authority-bearing reason (authority+revision+fingerprint)
 *   gauthdelta gauth + the promised delta injected when the temporal fact reaches ready (E2)
 *   inject     no guard; L3 injection (change-only) instead (E3)
 *
 * Per-run configuration (process environment, one run = one process):
 *   EXP_SCENARIO   e1 | e2 | e3
 *   EXP_ARM        none | gplain | gauth | gauthdelta | inject
 *   EXP_RUN        r1 | r2 | r3
 *   EXP_RESULTS_DIR <absolute dir>
 *
 * Zero default side effects outside the experiment: no business tools, no prompt
 * edits, no SQLite; metrics land only in EXP_RESULTS_DIR. The subject agent's
 * global tool layer is restricted to a small whitelist per scenario.
 */
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  EXPOSURE_POLICIES,
  createRuntimeExposureController,
} from "./runtime/exposure.mjs";

export const name = "runtime-experiment";

export const inject = ["tools"];

const SCENARIOS = new Set(["e1", "e2", "e3", "e4", "e5", "e6", "e7"]);
const ARMS = new Set(["none", "gplain", "gauth", "gauthdelta", "inject", "circuit", "circuitdelta", "pickup", "baseline"]);

const BASE_WHITELIST = ["pwsh", "str_replace_editor", "exp_probe"];

const SCENARIO_ACTION_TOOL = { e1: "exp_unload", e2: "exp_activate", e3: "exp_run", e4: "exp_flaky", e5: "exp_run", e6: null, e7: "exp_flaky" };

function stableValue(value) {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
}

function digest(value) {
  return createHash("sha256").update(stableValue(value)).digest("hex").slice(0, 16);
}

function envConfig() {
  const scenario = String(process.env.EXP_SCENARIO ?? "e1").toLowerCase();
  const arm = String(process.env.EXP_ARM ?? "gauth").toLowerCase();
  return {
    scenario: SCENARIOS.has(scenario) ? scenario : "e1",
    arm: ARMS.has(arm) ? arm : "gauth",
    run: String(process.env.EXP_RUN ?? "r1").replace(/[^a-zA-Z0-9_-]/g, ""),
    resultsDir: String(process.env.EXP_RESULTS_DIR ?? "").trim(),
    phase: String(process.env.EXP_PHASE ?? "1"),
    sharedState: String(process.env.EXP_SHARED_STATE ?? "").trim(),
  };
}

export function apply(ctx) {
  const cfg = envConfig();
  const tools = ctx.tools;
  const runId = `${cfg.scenario}-${cfg.arm}-${cfg.run}`;

  // Fact registry: value + monotonic revision + content fingerprint.
  const facts = {
    "plugins.exp_plugin_a.required_by_host": { value: true, revision: 1, changedStep: 0 },
    "plugins.exp_plugin_a.loaded": { value: true, revision: 1, changedStep: 0 },
    "plugins.exp_plugin_x.state": { value: "declared", revision: 1, changedStep: 0 },
    "plugins.exp_runner.state": { value: "ready", revision: 1, changedStep: 0 },
    "capabilities.exp_flaky.state": { value: "healthy", revision: 1, changedStep: 0 },
  };

  const metrics = {
    run: runId,
    scenario: cfg.scenario,
    arm: cfg.arm,
    sessionId: null,
    provider: null,
    model: null,
    initialTools: [],
    deniedGlobals: [],
    steps: 0,
    turns: 0,
    toolCalls: 0,
    probeCalls: 0,
    toolErrors: 0,
    modelCalls: 0,
    sessionTitleCalls: 0,
    payloadChars: 0,
    injectedMessages: 0,
    injectionKinds: {},
    runtimeFailures: 0,
    agentErrors: 0,
    rejections: [],
    rejectionsToLearn: 0,
    teachingFailures: 0,
    reVerificationAfterRejection: 0,
    wrongActionAttempts: 0,
    actionAttempts: [],
    worldCorrect: null,
    stepsToConverge: null,
    // E4 circuit metrics
    flakyAttempts: 0,
    flakyCallsAfterCircuitOpen: 0,
    circuitStep: null,
    circuitSignatures: [],
  };

  let sessionId = null;
  let agentOptions = null;
  let agentCtx = null;
  let currentTurn = 0;
  let currentStep = 0;
  let toolNames = null;
  let finalized = false;
  let promisePending = false;
  let promiseDelivered = false;
  let circuitOpen = false;
  let circuitAnnounced = false;
  let circuitStep = null;
  let pickupInjected = false;
  const circuitCounts = new Map();

  function setFact(path, value, step) {
    const fact = facts[path];
    if (fact.value === value) return;
    fact.value = value;
    fact.revision += 1;
    fact.changedStep = step;
    record("fact-change", { path, value, revision: fact.revision });
  }

  function fingerprintOf(path) {
    return digest({ path, value: facts[path].value });
  }

  // ---- scenario-specific initial world ----
  // E5 (H1): the runner is already disabled; the task plants a "ready" belief.
  if (cfg.scenario === "e5") {
    facts["plugins.exp_runner.state"].value = "disabled";
    facts["plugins.exp_runner.state"].revision = 2;
  }
  // E6 phase 2: the converged state persists across sessions. The `baseline`
  // arm skips persistence deliberately — it re-converges the fresh world.
  if (cfg.scenario === "e6" && cfg.phase === "2" && cfg.arm !== "baseline" && cfg.sharedState) {
    try {
      const shared = JSON.parse(readFileSync(cfg.sharedState, "utf8"));
      const state = shared?.facts?.["plugins.exp_plugin_x.state"];
      if (state && typeof state.value === "string") {
        facts["plugins.exp_plugin_x.state"].value = state.value;
        facts["plugins.exp_plugin_x.state"].revision =
          Number(state.revision) || facts["plugins.exp_plugin_x.state"].revision;
      }
    } catch {
      /* no shared state yet */
    }
  }

  function record(type, data) {
    if (!cfg.resultsDir) return;
    try {
      const line = JSON.stringify({
        t: new Date().toISOString(),
        turn: currentTurn,
        step: currentStep,
        type,
        ...data,
      });
      appendFileSync(join(cfg.resultsDir, `${runId}.events.jsonl`), `${line}\n`);
    } catch {
      /* recording must never fail the run */
    }
  }

  function currentToolNames() {
    if (toolNames !== null) return [...toolNames].sort();
    try {
      toolNames = tools.schemas().map((schema) => String(schema?.name)).filter(Boolean).sort();
    } catch {
      toolNames = [];
    }
    return [...toolNames];
  }

  function applyTransitions(step) {
    if (cfg.scenario === "e2" || (cfg.scenario === "e6" && (cfg.phase === "1" || cfg.arm === "baseline"))) {
      if (step >= 3 && facts["plugins.exp_plugin_x.state"].value === "declared") {
        setFact("plugins.exp_plugin_x.state", "mounted", step);
      } else if (step >= 5 && facts["plugins.exp_plugin_x.state"].value === "mounted") {
        setFact("plugins.exp_plugin_x.state", "ready", step);
      }
    } else if (cfg.scenario === "e3") {
      if (step >= 5 && facts["plugins.exp_runner.state"].value === "ready") {
        setFact("plugins.exp_runner.state", "disabled", step);
      }
    }
  }

  // ---- teaching reasons ----
  function makeReason({ action, factPath, predicate, temporal, promise }) {
    const fact = facts[factPath];
    const fingerprint = fingerprintOf(factPath);
    const lines = [`[action-rejected] ${action}`];
    lines.push(`fact: ${factPath} = ${JSON.stringify(fact.value)}`);
    if (cfg.arm === "gauth" || cfg.arm === "gauthdelta") {
      lines.push(
        `status: known | authority: host | revision: ${fact.revision} | fingerprint: ${fingerprint}`,
      );
    }
    lines.push(`predicate: ${predicate}`);
    if (temporal) {
      lines.push(`temporal: yes — state transitions mounted -> ready`);
      lines.push(
        promise
          ? "next: wait for the runtime to announce state=ready (a delta will arrive), then retry"
          : "next: state is not ready yet; retry later",
      );
    } else {
      lines.push("temporal: no");
      lines.push("next: this action is not valid from this host; drop it");
    }
    return lines.join("\n");
  }

  function guardFn(exec) {
    try {
      if (sessionId !== null && exec?.agent && exec.agent.id !== sessionId) return undefined;
      const toolName = String(exec?.name ?? "");
      const recordRejection = (action, factPath, reason) => {
        metrics.rejections.push({ step: currentStep, pair: `${factPath}:${action}`, reason });
        record("guard-rejection", { action, reason });
      };

      if (cfg.scenario === "e1" && toolName === "exp_unload") {
        metrics.wrongActionAttempts += 1;
        metrics.actionAttempts.push({ step: currentStep, action: "exp_unload", allowed: false });
        const reason = makeReason({
          action: "unload(exp_plugin_a)",
          factPath: "plugins.exp_plugin_a.required_by_host",
          predicate: "unload requires required_by_host == false",
          temporal: false,
          promise: false,
        });
        recordRejection("exp_unload", "plugins.exp_plugin_a.required_by_host", reason);
        return reason;
      }

      if (cfg.scenario === "e2" && toolName === "exp_activate") {
        const state = facts["plugins.exp_plugin_x.state"].value;
        if (state === "ready") {
          metrics.actionAttempts.push({ step: currentStep, action: "exp_activate", allowed: true });
          return undefined;
        }
        metrics.wrongActionAttempts += 1;
        metrics.actionAttempts.push({ step: currentStep, action: "exp_activate", allowed: false });
        const reason = makeReason({
          action: "activate(exp_plugin_x)",
          factPath: "plugins.exp_plugin_x.state",
          predicate: "activate requires state == ready",
          temporal: true,
          promise: cfg.arm === "gauthdelta",
        });
        if (cfg.arm === "gauthdelta") promisePending = true;
        recordRejection("exp_activate", "plugins.exp_plugin_x.state", reason);
        return reason;
      }

      if (cfg.scenario === "e3" && toolName === "exp_run") {
        const state = facts["plugins.exp_runner.state"].value;
        if (state === "ready") {
          metrics.actionAttempts.push({ step: currentStep, action: "exp_run", allowed: true });
          return undefined;
        }
        metrics.wrongActionAttempts += 1;
        metrics.actionAttempts.push({ step: currentStep, action: "exp_run", allowed: false });
        const fact = facts["plugins.exp_runner.state"];
        const fingerprint = fingerprintOf("plugins.exp_runner.state");
        const lines = [`[action-rejected] exp_run`];
        lines.push(`fact: plugins.exp_runner.state = "disabled"`);
        lines.push(`delta: ready -> disabled (changed at step ${fact.changedStep})`);
        if (cfg.arm === "gauth") {
          lines.push(`status: known | authority: host | revision: ${fact.revision} | fingerprint: ${fingerprint}`);
        }
        lines.push("predicate: exp_run requires state == ready");
        lines.push("temporal: no");
        lines.push("next: exp_run is no longer valid; stop attempting it");
        const reason = lines.join("\n");
        recordRejection("exp_run", "plugins.exp_runner.state", reason);
        return reason;
      }

      // E5 (H1): belief-contradicting rejection. Same predicate, but the model
      // was told the state is ready; the reason either carries provenance or not.
      if (cfg.scenario === "e5" && toolName === "exp_run") {
        metrics.wrongActionAttempts += 1;
        metrics.actionAttempts.push({ step: currentStep, action: "exp_run", allowed: false });
        const reason = makeReason({
          action: "exp_run",
          factPath: "plugins.exp_runner.state",
          predicate: "exp_run requires state == ready",
          temporal: false,
          promise: false,
        });
        recordRejection("exp_run", "plugins.exp_runner.state", reason);
        return reason;
      }

      if ((cfg.scenario === "e4" || cfg.scenario === "e7") && toolName === "exp_flaky") {
        if (circuitOpen) {
          metrics.wrongActionAttempts += 1;
          const fact = facts["capabilities.exp_flaky.state"];
          const fingerprint = fingerprintOf("capabilities.exp_flaky.state");
          const lines = [`[action-rejected] exp_flaky`];
          lines.push(`fact: capabilities.exp_flaky.state = "failed"`);
          if (cfg.arm === "circuitdelta") {
            lines.push(`status: known | authority: host | revision: ${fact.revision} | fingerprint: ${fingerprint}`);
          }
          lines.push("predicate: exp_flaky requires state == healthy");
          lines.push("temporal: no");
          lines.push("next: repeated identical failure detected; stop retrying, report the error");
          const reason = lines.join("\n");
          recordRejection("exp_flaky", "capabilities.exp_flaky.state", reason);
          return reason;
        }
        return undefined;
      }
    } catch (error) {
      metrics.runtimeFailures += 1;
      record("runtime-failure", { message: String(error?.message ?? error) });
    }
    return undefined;
  }

  function makeInjectedMessage(text, kind) {
    metrics.injectedMessages += 1;
    metrics.injectionKinds[kind] = (metrics.injectionKinds[kind] ?? 0) + 1;
    record("inject", { kind, chars: text.length });
    return Object.freeze({
      id: `rtx-${randomUUID()}`,
      role: "user",
      content: [{ type: "text", text }],
      source: { kind: "plugin", plugin: "dsh-runtime-experiment" },
    });
  }

  function computeTeachingFailures() {
    const counts = new Map();
    for (const rejection of metrics.rejections) {
      const pair = rejection.pair;
      counts.set(pair, (counts.get(pair) ?? 0) + 1);
    }
    let failures = 0;
    for (const count of counts.values()) if (count >= 2) failures += 1;
    return failures;
  }

  function computeWorldCorrect() {
    if (cfg.scenario === "e1") return facts["plugins.exp_plugin_a.loaded"].value === true;
    if (cfg.scenario === "e2") {
      const success = metrics.actionAttempts.find((attempt) => attempt.action === "exp_activate" && attempt.allowed);
      return Boolean(success);
    }
    if (cfg.scenario === "e3") {
      const stateAt = (attempt) => {
        // allowed means state was ready at that attempt
        return attempt.allowed;
      };
      return metrics.actionAttempts.filter((attempt) => attempt.action === "exp_run").every(stateAt);
    }
    if (cfg.scenario === "e4") return null;
    if (cfg.scenario === "e7") return null;
    if (cfg.scenario === "e5") return null;
    if (cfg.scenario === "e6") return null;
    return null;
  }

  function computeStepsToConverge() {
    if (cfg.scenario === "e1") {
      const lastRejection = metrics.actionAttempts.filter((attempt) => !attempt.allowed).pop();
      return lastRejection ? lastRejection.step : (metrics.actionAttempts[0]?.step ?? null);
    }
    if (cfg.scenario === "e2") {
      const success = metrics.actionAttempts.find((attempt) => attempt.allowed);
      return success ? success.step : (metrics.actionAttempts.at(-1)?.step ?? null);
    }
    if (cfg.scenario === "e3") {
      const last = metrics.actionAttempts.at(-1);
      return last ? last.step : null;
    }
    if (cfg.scenario === "e4" || cfg.scenario === "e7") {
      return metrics.circuitStep ?? null;
    }
    if (cfg.scenario === "e5") {
      return metrics.rejections.at(-1)?.step ?? null;
    }
    return null;
  }

  function finalize() {
    if (finalized) return;
    finalized = true;
    metrics.rejectionsToLearn = metrics.rejections.length;
    metrics.teachingFailures = computeTeachingFailures();
    metrics.worldCorrect = computeWorldCorrect();
    metrics.stepsToConverge = computeStepsToConverge();
    metrics.finalTools = currentToolNames();
    // E6 phase 1: persist the converged runtime state for the next session.
    if (cfg.scenario === "e6" && cfg.phase === "1" && cfg.sharedState) {
      try {
        const stateFact = facts["plugins.exp_plugin_x.state"];
        const shared = {
          convergedAt: new Date().toISOString(),
          sourceSession: sessionId ?? null,
          facts: {
            "plugins.exp_plugin_x.state": {
              value: stateFact.value,
              status: "known",
              authority: "host-runtime",
              revision: stateFact.revision,
              fingerprint: fingerprintOf("plugins.exp_plugin_x.state"),
            },
            "dependencies.current_host": {
              value: null,
              status: "unknown",
              authority: "host-runtime",
              reason: "host_did_not_expose_fact",
            },
          },
        };
        writeFileSync(cfg.sharedState, JSON.stringify(shared, null, 2));
        record("shared-state-saved", { path: cfg.sharedState, facts: shared.facts });
      } catch {
        /* persistence failure must not fail the run */
      }
    }
    if (cfg.resultsDir) {
      try {
        mkdirSync(cfg.resultsDir, { recursive: true });
        writeFileSync(join(cfg.resultsDir, `${runId}.metrics.json`), JSON.stringify(metrics, null, 2));
      } catch {
        /* metrics write must never fail the run */
      }
    }
  }

  function writePartial() {
    if (cfg.resultsDir) {
      try {
        mkdirSync(cfg.resultsDir, { recursive: true });
        writeFileSync(
          join(cfg.resultsDir, `${runId}.partial.json`),
          JSON.stringify({ ...metrics, at: new Date().toISOString() }, null, 2),
        );
      } catch {
        /* ignore */
      }
    }
  }

  // ---- tools ----
  const toolTemplate = (name, description, parameters, body) => ({
    name,
    description,
    parameters,
    output: {
      schema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: true,
      },
      render: (args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    async execute(args) {
      return body(args);
    },
  });

  const probeTool = {
    name: "exp_probe",
    description:
      "Probe authoritative runtime facts of the current DSH host. query must be one of: " +
      "'plugins.exp_plugin_a.required_by_host', 'plugins.exp_plugin_a.loaded', " +
      "'plugins.exp_plugin_x.state', 'plugins.exp_runner.state', 'tools'. " +
      "Returns { query, status: 'known'|'unknown', value }.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: { query: { type: "string" }, status: { type: "string" } },
        required: ["query", "status"],
        additionalProperties: true,
      },
      render: (args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    async execute(args) {
      const query = String(args?.query ?? "");
      if (query === "tools") return { query, status: "known", value: currentToolNames(), reason: null };
      if (query === "dependencies.current_host") {
        return { query, status: "unknown", value: null, reason: "host_did_not_expose_fact" };
      }
      if (Object.hasOwn(facts, query)) {
        return { query, status: "known", value: facts[query].value, reason: null };
      }
      return { query, status: "unknown", value: null, reason: "unsupported_query" };
    },
  };

  const actionTools = {
    exp_unload: toolTemplate(
      "exp_unload",
      "Attempt to unload exp_plugin_a. Subject to host runtime constraints.",
      { type: "object", properties: {}, additionalProperties: false },
      () => {
        metrics.actionAttempts.push({ step: currentStep, action: "exp_unload", allowed: false, unguarded: true });
        setFact("plugins.exp_plugin_a.loaded", false, currentStep);
        record("world", { event: "unload-executed", loaded: false });
        return { ok: true, unloaded: true };
      },
    ),
    exp_activate: toolTemplate(
      "exp_activate",
      "Activate exp_plugin_x. Subject to host runtime constraints (only valid when state is ready).",
      { type: "object", properties: {}, additionalProperties: false },
      () => {
        const state = facts["plugins.exp_plugin_x.state"].value;
        metrics.actionAttempts.push({ step: currentStep, action: "exp_activate", allowed: state === "ready", unguarded: true });
        record("world", { event: "activate-executed", state });
        return { ok: true, activated: true };
      },
    ),
    exp_run: toolTemplate(
      "exp_run",
      "Run exp_runner. Subject to host runtime constraints (only valid when state is ready).",
      { type: "object", properties: {}, additionalProperties: false },
      () => {
        const state = facts["plugins.exp_runner.state"].value;
        metrics.actionAttempts.push({ step: currentStep, action: "exp_run", allowed: state === "ready", unguarded: true });
        record("world", { event: "run-executed", state });
        return { ok: true, ran: true };
      },
    ),
    exp_flaky: toolTemplate(
      "exp_flaky",
      "Returns a value you must save. NOTE: this tool has been reported to fail intermittently with a session error.",
      { type: "object", properties: {}, additionalProperties: false },
      async () => {
        throw new Error("E32001: session expired (deterministic scenario failure)");
      },
    ),
  };

  ctx.effect(() => tools.register(probeTool));
  for (const actionTool of Object.values(actionTools)) {
    ctx.effect(() => tools.register(actionTool));
  }
  if (cfg.arm !== "none" && cfg.arm !== "inject" && cfg.arm !== "pickup") {
    ctx.effect(() => tools.guard(guardFn));
  }

  const controller =
    cfg.arm === "inject"
      ? createRuntimeExposureController({ policy: EXPOSURE_POLICIES.CHANGE_ONLY })
      : createRuntimeExposureController({ policy: EXPOSURE_POLICIES.REACT_DISCOVERY });

  function buildFacts() {
    const names = currentToolNames();
    return {
      identity: { session_id: sessionId ?? "unknown" },
      capabilities: {
        tools: names,
        tool_surface_digest: digest(names),
        tool_count: names.length,
      },
      plugins: {
        exp_plugin_a: { required_by_host: facts["plugins.exp_plugin_a.required_by_host"].value },
        exp_plugin_x: { state: facts["plugins.exp_plugin_x.state"].value },
        exp_runner: { state: facts["plugins.exp_runner.state"].value },
      },
      ...(agentOptions
        ? { execution: { provider: agentOptions.provider ?? null, model: agentOptions.model ?? null } }
        : {}),
    };
  }

  // ---- observation ----
  ctx.on("agent/session-start", (payload) => {
    try {
      if (sessionId !== null && payload?.agent?.id !== sessionId) return;
      sessionId = payload?.agent?.id ?? sessionId;
      agentOptions = payload?.agent?.options ?? agentOptions;
      agentCtx = payload?.agent?.ctx ?? agentCtx;
      metrics.sessionId = sessionId;
      metrics.provider = agentOptions?.provider ?? null;
      metrics.model = agentOptions?.model ?? null;

      const whitelist = [
        ...BASE_WHITELIST,
        ...(SCENARIO_ACTION_TOOL[cfg.scenario] ? [SCENARIO_ACTION_TOOL[cfg.scenario]] : []),
      ].filter((toolName) => !(process.env.EXP_NO_PROBE === "1" && toolName === "exp_probe"));
      if (agentCtx) {
        const scopedTools = agentCtx.get("tools");
        if (scopedTools && typeof scopedTools.restrict === "function") {
          const globalNames = tools.schemas().map((schema) => String(schema?.name)).filter(Boolean);
          const deny = globalNames.filter((toolName) => !whitelist.includes(toolName));
          scopedTools.restrict({ deny });
          metrics.deniedGlobals = deny;
        }
      }
      toolNames = [...whitelist].sort();
      record("session-start", {
        sessionId,
        provider: metrics.provider,
        model: metrics.model,
        whitelist,
        deniedGlobals: metrics.deniedGlobals,
      });
    } catch (error) {
      metrics.runtimeFailures += 1;
      record("runtime-failure", { message: `session-start: ${String(error?.message ?? error)}` });
    }
  });

  ctx.on("agent/pre-step", async (payload, next) => {
    const decision = await next();
    try {
      if (sessionId !== null && payload?.agent?.id !== sessionId) return decision;
      if (sessionId === null) {
        sessionId = payload?.agent?.id ?? null;
        agentOptions = payload?.agent?.options ?? null;
        agentCtx = payload?.agent?.ctx ?? null;
        metrics.sessionId = sessionId;
      }
      currentTurn = payload.turn;
      currentStep = payload.step;
      metrics.turns = Math.max(metrics.turns, payload.turn);
      metrics.steps = Math.max(metrics.steps, payload.step);

      applyTransitions(payload.step);

      // E4 circuitdelta: announce the circuit opening as a delta at the next
      // pre-step so the model stops retrying without another failed attempt.
      if (cfg.arm === "circuitdelta" && circuitOpen && !circuitAnnounced) {        circuitAnnounced = true;
        const fact = facts["capabilities.exp_flaky.state"];
        const fingerprint = fingerprintOf("capabilities.exp_flaky.state");
        const text =
          "[runtime-observation circuit-open]\n" +
          `capabilities.exp_flaky.state = "failed" (authority: host, revision: ${fact.revision}, fingerprint: ${fingerprint})\n` +
          "repeated identical failure detected; do not retry exp_flaky, report the error and stop.";
        if (decision.kind === "enter") {
          return { kind: "enter", messages: [...decision.messages, makeInjectedMessage(text, "circuit-open")] };
        }
      }

      // E6 pickup: cold-start session 2 receives the current authoritative
      // state once. Boundary: ONLY runtime-confirmed facts with revision +
      // fingerprint — never transcripts, never model conclusions, never memory.
      // The "previous session" provenance stays in the shared file's audit
      // metadata and is deliberately NOT injected into the model.
      if (cfg.scenario === "e6" && cfg.phase === "2" && cfg.arm === "pickup" && !pickupInjected) {
        pickupInjected = true;
        const stateFact = facts["plugins.exp_plugin_x.state"];
        const payload = {
          protocolVersion: 1,
          kind: "pickup-baseline",
          facts: {
            "plugins.exp_plugin_x.state": {
              value: stateFact.value,
              status: "known",
              authority: "host-runtime",
              revision: stateFact.revision,
              fingerprint: fingerprintOf("plugins.exp_plugin_x.state"),
            },
            "dependencies.current_host": {
              value: null,
              status: "unknown",
              authority: "host-runtime",
              reason: "host_did_not_expose_fact",
            },
          },
        };
        const text = `[runtime-observation pickup-baseline]\n${JSON.stringify(payload)}`;
        if (decision.kind === "enter") {
          return { kind: "enter", messages: [...decision.messages, makeInjectedMessage(text, "pickup-baseline")] };
        }
      }

      // E2 gauthdelta: deliver the promised delta exactly when ready arrives.
      if (
        cfg.arm === "gauthdelta" &&
        promisePending &&
        !promiseDelivered &&
        facts["plugins.exp_plugin_x.state"].value === "ready"
      ) {
        promiseDelivered = true;
        const fact = facts["plugins.exp_plugin_x.state"];
        const fingerprint = fingerprintOf("plugins.exp_plugin_x.state");
        const text =
          "[runtime-observation promised-delta]\n" +
          `plugins.exp_plugin_x.state = "ready" (authority: host, revision: ${fact.revision}, fingerprint: ${fingerprint})\n` +
          "activate(exp_plugin_x) is now valid.";
        if (decision.kind === "enter") {
          return { kind: "enter", messages: [...decision.messages, makeInjectedMessage(text, "promised-delta")] };
        }
      }

      // E3 inject arm: L3 change-only injection through the controller.
      if (cfg.arm === "inject") {
        const result = controller.observe({ facts: buildFacts(), revision: payload.step });
        if (result.emitted && result.exposure && decision.kind === "enter") {
          const text = `[runtime-observation v1 policy=change-only]\n${JSON.stringify(result.exposure)}`;
          return { kind: "enter", messages: [...decision.messages, makeInjectedMessage(text, result.exposure.kind)] };
        }
      }
    } catch (error) {
      metrics.runtimeFailures += 1;
      record("runtime-failure", { message: String(error?.message ?? error) });
    }
    return decision;
  });

  ctx.on("llm/stream", (options, next) => {
    try {
      if (options?.purpose !== undefined) {
        metrics.sessionTitleCalls += 1;
        return next();
      }
      metrics.modelCalls += 1;
      if (Array.isArray(options?.tools)) {
        toolNames = options.tools.map((schema) => String(schema?.name)).filter(Boolean).sort();
        if (metrics.initialTools.length === 0) {
          metrics.initialTools = [...toolNames];
          record("initial-surface", { tools: metrics.initialTools });
        }
      }
      const chars =
        JSON.stringify(options?.messages ?? []).length +
        JSON.stringify(options?.system ?? "").length +
        JSON.stringify(options?.tools ?? []).length;
      metrics.payloadChars += chars;
      record("model-call", { chars, toolCount: toolNames === null ? null : toolNames.length });
    } catch (error) {
      metrics.runtimeFailures += 1;
    }
    return next();
  });

  ctx.on("tools/result", (exec, result) => {
    try {
      if (sessionId !== null && exec?.agent?.id !== sessionId) return;
      const toolName = String(exec?.name ?? "unknown");
      const isError = Boolean(result?.isError);
      metrics.toolCalls += 1;
      const scenarioAction = SCENARIO_ACTION_TOOL[cfg.scenario];
      if (isError && toolName !== scenarioAction) metrics.toolErrors += 1;
      record("tool-result", { name: toolName, isError });

      if (toolName === "exp_probe") {
        metrics.probeCalls += 1;
        if (metrics.rejections.length > 0) metrics.reVerificationAfterRejection += 1;
        let value = null;
        try {
          const text = (result?.content ?? [])
            .map((block) => (block?.type === "text" ? block.text : ""))
            .join("");
          value = JSON.parse(text);
        } catch {
          /* unparsable */
        }
        record("probe", { isError, value });
      } else if (toolName === "exp_flaky") {
        metrics.flakyAttempts += 1;
        if (circuitOpen) metrics.flakyCallsAfterCircuitOpen += 1;
        if (isError && !circuitOpen) {
          const text = (result?.content ?? [])
            .map((block) => (block?.type === "text" ? block.text : ""))
            .join("");
          const codeMatch = /E\d+/.exec(text);
          const signature = digest({ tool: "exp_flaky", code: codeMatch ? codeMatch[0] : "generic-error" });
          const count = (circuitCounts.get(signature) ?? 0) + 1;
          circuitCounts.set(signature, count);
          record("circuit-count", { signature, count });
          if (count >= 2) {
            circuitOpen = true;
            circuitStep = currentStep;
            metrics.circuitStep = currentStep;
            setFact("capabilities.exp_flaky.state", "failed", currentStep);
            record("circuit-open", { signature, count });
          }
        }
      }
    } catch (error) {
      metrics.runtimeFailures += 1;
    }
  });

  ctx.on("agent/error", (payload) => {
    try {
      if (sessionId !== null && payload?.agent?.id !== sessionId) return;
      metrics.agentErrors += 1;
      record("agent-error", {
        turn: payload?.turn,
        step: payload?.step,
        message: String(payload?.error?.message ?? payload?.error ?? "").slice(0, 300),
      });
    } catch {
      /* observe only */
    }
  });

  ctx.on("agent/turn-stopping", () => {
    writePartial();
  });

  ctx.on("agent/disposed", (payload) => {
    if (sessionId !== null && payload?.agent?.id !== sessionId) return;
    finalize();
  });

  process.on("exit", finalize);
}
