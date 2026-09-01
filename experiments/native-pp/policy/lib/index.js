/**
 * dsh-native-pp-policy — the thin Progress consumer for the consumer
 * experiment (docs/status/native-pp-2026-09-02.md, follow-up round).
 *
 * Consumes:
 *   - the projection package's PURE fold over session/event records
 *     (execution facts: per-tool calls and failures) — unchanged projection,
 *     consumed as a library through its public foldProjection/createFolder;
 *   - its own capability-effect CONTRACT model (which failures mean
 *     "stalled" and which capabilities are non-atomic).
 *
 * Intervenes ONLY through the native tools.guard:
 *   - pure capability (exp_flaky): same-tool failures >= stallThreshold
 *     => circuit: deny further calls with a teaching reason (the agent sees
 *     a synthetic error result; the tool body never executes).
 *   - non-atomic capability (exp_apply): after ANY prior call (success or
 *     failure), deny repeats — a failed response may still mean the effect
 *     was applied, so a blind retry can duplicate the side effect.
 *   - noop capability (exp_noop): no intervention this round (record only).
 *
 * Zero tool registration, zero prompt edits, zero model calls. All evidence
 * (interventions + the consumed progress state) lands in
 * EXP_RESULTS_DIR/<runId>.policy.json.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { foldProjection } from "dsh-native-pp-projection";

export const name = "native-pp-policy";

export const inject = ["tools"];

/** Capability-effect contract model owned by the policy (not the projection). */
const POLICY_MODEL = {
  exp_flaky: { kind: "pure", stallThreshold: 2 },
  exp_apply: { kind: "non-atomic" },
  exp_noop: { kind: "noop" },
  exp_pretend: { kind: "claimed" }, // success claims an unobservable effect
  exp_check: { kind: "verify" },
  exp_repair: { kind: "repair" },
};

/**
 * Real-scenario pattern contracts: capabilities invoked through the generic
 * pwsh tool are matched by their call signature (script name in arguments).
 * Mirrors how a real deployment would declare capability contracts.
 */
const PATTERN_CONTRACTS = [
  {
    id: "apply-config",
    kind: "claimed",
    pattern: /apply-config/i,
    verify: "verify.ps1",
    repair: "reload.ps1",
  },
  {
    id: "deploy",
    kind: "non-atomic",
    pattern: /deploy\.ps1/i,
  },
];

export function apply(ctx) {
  const resultsDir = String(process.env.EXP_RESULTS_DIR ?? "").trim();
  if (!resultsDir) return;

  const scenario = String(process.env.EXP_SCENARIO ?? "ok").toLowerCase();
  const run = String(process.env.EXP_RUN ?? "r1").replace(/[^a-zA-Z0-9_-]/g, "");
  const runId = `${scenario}-${run}`;

  const tools = ctx.tools;
  let sessionId = null;
  let finalized = false;
  let investigated = false;
  let jobCompletePending = false;
  let jobInjected = false;
  const events = [];
  const interventions = [];
  let guardedDenials = 0;

  /** One-shot view of the consumed Progress state at decision time. */
  function progress() {
    return foldProjection(events);
  }

  function failuresOf(projection, toolName) {
    const effect = projection.axes?.effect?.[toolName];
    if (!effect) return 0;
    return effect.calls.filter((call) => call.isError).length;
  }

  function callsOf(projection, toolName) {
    const effect = projection.axes?.effect?.[toolName];
    return effect ? effect.calls.length : 0;
  }

  function guardFn(exec) {
    try {
      const toolName = String(exec?.name ?? "");
      const argumentsText = String(exec?.arguments ?? "");
      const model = POLICY_MODEL[toolName];
      // Real-scenario pattern path: non-atomic capabilities invoked through
      // pwsh are matched by their script signature.
      for (const contract of PATTERN_CONTRACTS) {
        if (contract.kind !== "non-atomic") continue;
        if (toolName !== "pwsh" || !contract.pattern.test(argumentsText)) continue;
        const prior = patternCallResults(contract.pattern);
        if (prior.length >= 1) {
          const anyFailure = prior.some((result) => result.isError);
          const reason =
            `[progress-policy non-atomic] ${contract.id} was already invoked once${anyFailure ? " and its confirmation was lost" : ""}; ` +
            "the deployment may already be applied, so a retry can duplicate the side effect. " +
            "Do not run it again; verify the deployment state by other means instead.";
          interventions.push({ at: Date.now(), tool: contract.id, kind: "non-atomic-deny", evidence: { matchedCalls: prior.length, anyFailure } });
          guardedDenials += 1;
          return reason;
        }
      }
      if (!model) return; // not a capability this policy owns
      if (model.kind === "pure") {
        const p = progress();
        const failures = failuresOf(p, toolName);
        if (failures >= model.stallThreshold) {
          const reason =
            `[progress-policy circuit] ${toolName} has failed ${failures} times in a row with no effect progress (execution=failed, effect=stalled). ` +
            "Do not call it again; report the failure and stop retrying.";
          interventions.push({ at: Date.now(), tool: toolName, kind: "circuit-deny", evidence: { failures, threshold: model.stallThreshold } });
          guardedDenials += 1;
          return reason;
        }
        return;
      }
      if (model.kind === "non-atomic") {
        const p = progress();
        const calls = callsOf(p, toolName);
        if (calls >= 1) {
          const anyFailure = failuresOf(p, toolName) > 0;
          const reason =
            `[progress-policy non-atomic] ${toolName} was already invoked once${anyFailure ? " and its response was lost" : ""}; ` +
            "the effect may already be applied, so a retry can duplicate the side effect. " +
            "Do not call it again; verify the effect by other means instead.";
          interventions.push({ at: Date.now(), tool: toolName, kind: "non-atomic-deny", evidence: { calls, anyFailure } });
          guardedDenials += 1;
          return reason;
        }
        return;
      }
      // kind === "noop": observe only this round.
      return;
    } catch {
      // a failing guard must never break dispatch
      return;
    }
  }

  if (tools && typeof tools.guard === "function") {
    ctx.effect(() => tools.guard(guardFn));
  }

  ctx.on("session/event", (session, event) => {
    try {
      if (sessionId !== null && session?.id !== sessionId) return;
      if (sessionId === null) sessionId = session?.id ?? null;
      events.push(event);
    } catch {
      /* observe only */
    }
  });

  // Real4 async-job path: the fixture publishes the world's completion on the
  // host event substrate; the policy turns it into ONE change notification.
  ctx.on("exp/job-changed", (payload) => {
    try {
      if (jobCompletePending || payload?.state !== "complete") return;
      jobCompletePending = true;
    } catch {
      /* observe only */
    }
  });

  // success + claimed (effect unobservable) => investigate, exactly once.
  // Injects ONE pre-step instruction so the agent verifies the claimed effect
  // instead of trusting the silent success. The injection is a policy cost,
  // measured like any other payload growth.
  function patternCallResults(pattern) {
    const matched = new Set();
    for (const event of events) {
      if (
        event.type === "tool/call" &&
        String(event.data?.name ?? "") === "pwsh" &&
        pattern.test(String(event.data?.arguments ?? ""))
      ) {
        if (event.data?.callId !== undefined) matched.add(String(event.data.callId));
      }
    }
    const results = [];
    for (const event of events) {
      if (event.type !== "tool/result") continue;
      const callId = event.data?.callId ?? event.data?.message?.source?.callId;
      if (callId === undefined || !matched.has(String(callId))) continue;
      const blocks = Array.isArray(event.data?.message?.content) ? event.data.message.content : [];
      results.push({
        seq: event.seq,
        isError: event.data?.error !== undefined || blocks.some((block) => block?.isError === true),
      });
    }
    return results;
  }

  ctx.on("agent/pre-step", async (payload, next) => {
    const decision = await next();
    try {
      if (investigated) return decision;
      if (sessionId !== null && payload?.agent?.id !== sessionId) return decision;
      // exp_pretend path (fixture capability)
      let kind = null;
      let evidence = null;
      let text = null;
      const p = progress();
      const pretend = p.axes?.effect?.["exp_pretend"];
      const claimedSuccess = Boolean(pretend && pretend.calls.some((call) => !call.isError));
      if (claimedSuccess) {
        kind = "investigate-inject";
        evidence = { tool: "exp_pretend", calls: pretend.calls.length, callResult: pretend.callResult, worldEffect: pretend.worldEffect };
        text =
          "[progress-policy investigate] exp_pretend reported success but its effect is not event-observable " +
          "(execution=success, effect=unknown). Do not trust the report blindly: verify with exp_check, " +
          "and if the change is missing, repair it with exp_repair.";
      }
      // Real-scenario pattern path (pwsh + script signature)
      for (const contract of PATTERN_CONTRACTS) {
        if (contract.kind !== "claimed") continue;
        const results = patternCallResults(contract.pattern);
        const success = results.find((result) => !result.isError);
        if (!success) continue;
        kind = "investigate-inject";
        evidence = { contract: contract.id, matchedCalls: results.length, lastResultSeq: success.seq };
        text =
          `[progress-policy investigate] the "${contract.id}" capability reported success but its effect is not ` +
          `confirmed by the event stream (execution=success, effect=unknown). Verify the outcome with ${contract.verify}, ` +
          `and if the result is stale or missing, recover with ${contract.repair} and re-verify.`;
        break;
      }
      if (kind === null && jobCompletePending && !jobInjected) {
        jobInjected = true;
        kind = "job-complete-inject";
        evidence = { state: "complete", source: "exp/job-changed" };
        text =
          "[progress-policy job-complete] the background job just reached state complete. " +
          "Check its status once now and wrap up; no further polling is needed.";
      }
      if (kind === null) return decision;
      investigated = true;
      interventions.push({ at: Date.now(), kind, evidence });
      const injected = {
        id: `ppx-${Date.now()}`,
        role: "user",
        content: [{ type: "text", text }],
        source: { kind: "plugin", plugin: "dsh-native-pp-policy" },
      };
      if (decision.kind === "enter") {
        return { kind: "enter", messages: [...decision.messages, injected] };
      }
    } catch {
      /* an injecting listener must never break the loop */
    }
    return decision;
  });

  function finalize() {
    if (finalized) return;
    finalized = true;
    try {
      const consumed = progress();
      const payload = {
        run: runId,
        sessionId,
        policyModel: POLICY_MODEL,
        interventions,
        guardedDenials,
        consumedProgress: {
          verdict: consumed.verdict,
          unknownFields: consumed.unknownFields,
          effects: Object.fromEntries(
            Object.entries(consumed.axes.effect ?? {}).map(([toolName, effect]) => [
              toolName,
              { called: effect.called, callResult: effect.callResult, worldEffect: effect.worldEffect, support: effect.support },
            ]),
          ),
        },
        surface: {
          toolsRegistered: 0,
          promptEdits: interventions.filter((i) => i.kind === "investigate-inject").length,
          modelCallsInitiated: 0,
        },
      };
      writeFileSync(join(resultsDir, `${runId}.policy.json`), `${JSON.stringify(payload, null, 2)}\n`);
    } catch {
      /* last resort */
    }
  }

  ctx.on("agent/disposed", (payload) => {
    if (sessionId !== null && payload?.agent?.id !== sessionId) return;
    finalize();
  });
  process.on("exit", finalize);
}
