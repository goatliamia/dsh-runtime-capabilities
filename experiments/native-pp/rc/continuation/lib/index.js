/**
 * dsh-native-pp-continuation — Route-A Runtime Continuation, round 2 (v5).
 *
 * Round 2 hardens the boundaries (docs/status/runtime-continuation-2026-09-02.md §8
 * follow-up), two axes:
 *
 * A. Runtime boundary:
 *    - unique: continuation fires ONLY when facts + contracts compress the
 *      legal next step to exactly ONE action (multi-contract uniqueness
 *      check; ambiguous -> record and hand back to the Model);
 *    - stale: CAS re-projection before dispatch; the stale intent is
 *      discarded and never executes (full-bump and partial-bump variants);
 *    - cancel: the dispatch uses the loop's own signal through the public
 *      boundary — cancellation materializes as the canonical aborted result,
 *      never a bypass;
 *    - guard: the dispatch passes the world's tools.guard; a denial is
 *      classified outcome "blocked" and surfaced to the Model;
 *    - unknown: missing facts -> needs-decision, never a takeover.
 * B. Fact boundary:
 *    - fact sources are gated (per-segment execution gate + read channels);
 *      misleading source literals (rcbait) and missing fact formats
 *      (rcnofacts) must produce ZERO takeovers.
 *
 * Chain (rchain only, bounded): after a dispatched hop the pre-step handler
 * re-projects and continues while exactly one fresh contract is required
 * (Runtime A -> Runtime B -> Model), then injects ONE combined digest message.
 *
 * The custom record kind "runtime/continuation" remains outside
 * KNOWN_SESSION_EVENT_TYPES (documented round-1 finding); replay verification
 * uses the independent decode path.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const name = "native-pp-continuation";

export const inject = ["tools"];

const MAX_CHAIN = 2;
const CAS_WAIT_MS = 4000;

/**
 * Contract table. required(projection) receives the projection (artifact,
 * runtime, executions, continuationSeq) and returns a boolean; action is the
 * unique deterministic next step. The narrow standard: the RUN is legal only
 * when exactly one contract is required.
 */
const CONTRACTS = {
  "plugin-revision-mismatch": {
    id: "plugin-revision-mismatch",
    kind: "revision",
    required: (proj) => proj.artifact !== null && proj.runtime !== null && proj.artifact.rev !== proj.runtime.rev,
    action: { name: "pwsh", arguments: { command: "& .\\reload.ps1", description: "Reload runtime to match artifact revision" } },
    factScripts: { artifact: ["build.ps1", "stale-bump-artifact.ps1"], runtime: ["verify.ps1", "reload.ps1", "stale-bump.ps1"] },
  },
  "plugin-revision-rollback": {
    id: "plugin-revision-rollback",
    kind: "revision",
    required: (proj) => proj.artifact !== null && proj.runtime !== null && proj.artifact.rev !== proj.runtime.rev,
    action: { name: "pwsh", arguments: { command: "& .\\rollback.ps1", description: "Roll the artifact back to the runtime revision" } },
    factScripts: { artifact: ["build.ps1"], runtime: ["verify.ps1", "reload.ps1"] },
  },
  "post-reload-healthcheck": {
    id: "post-reload-healthcheck",
    kind: "post",
    required: (proj) => proj.executions.has("reload.ps1") && !proj.executions.has("healthcheck.ps1"),
    action: { name: "pwsh", arguments: { command: "& .\\healthcheck.ps1", description: "Run the post-reload health check" } },
    factScripts: { artifact: [], runtime: [] },
  },
  "post-edit-syntax-check": {
    id: "post-edit-syntax-check",
    kind: "post",
    // Real coding loop: after the plugin entry is edited, the unique
    // deterministic next step is a syntax check. Facts: the editor wrote
    // lib/index.js (tool/call record), and no node --check ran after it.
    required: (proj) => proj.lastEditSeq !== null && proj.lastEditSeq > proj.lastCheckSeq,
    action: { name: "pwsh", arguments: { command: "node --check lib/index.js", description: "Syntax-check the edited plugin entry" } },
    factScripts: { artifact: [], runtime: [] },
  },
};

/** Which contracts are active per scenario (scenario-scoped fixture worlds). */
const SCENARIO_CONTRACTS = {
  rc: ["plugin-revision-mismatch"],
  rccancel: ["plugin-revision-mismatch"],
  rcguard: ["plugin-revision-mismatch"],
  rcmulti: ["plugin-revision-mismatch", "plugin-revision-rollback"],
  rcbait: ["plugin-revision-mismatch"],
  rcnofacts: ["plugin-revision-mismatch"],
  rchain: ["plugin-revision-mismatch", "post-reload-healthcheck"],
  rccont: ["plugin-revision-mismatch"],
  rcc4: ["plugin-revision-mismatch"],
  rn: ["post-edit-syntax-check"],
  rccontrol: [],
};

/** rccancel scenario: the action target is the slow reload (mid-body variant). */
const SCENARIO_ACTION_OVERRIDE = {
  rccancel: { command: "& .\\reload-slow.ps1", description: "Reload runtime slowly to match artifact revision" },
};

const ARTIFACT_PATTERN = /artifact=(\d+)/;
const RUNTIME_PATTERN = /runtime_revision=(\d+)/;

function env() {
  const scenario = String(process.env.EXP_SCENARIO ?? "rc").toLowerCase();
  return {
    scenario,
    run: String(process.env.EXP_RUN ?? "r1").replace(/[^a-zA-Z0-9_-]/g, ""),
    arm: String(process.env.EXP_ARM ?? "a").toLowerCase(),
    resultsDir: String(process.env.EXP_RESULTS_DIR ?? "").trim(),
    inject: String(process.env.EXP_CONT_INJECT ?? "1") !== "0",
  };
}

function textOf(content) {
  return (content ?? [])
    .map((block) => (block?.type === "text" ? String(block.text ?? "") : ""))
    .join("");
}

/** Unwrap a tool-result MESSAGE into its flat text (the wrapper's inner content). */
function toolResultText(message) {
  const content = message?.content ?? [];
  let text = "";
  for (const block of content) {
    if (block?.type === "text") text += String(block.text ?? "");
    else if (block?.type === "tool-result" && Array.isArray(block.content)) text += textOf(block.content);
  }
  return text;
}

export function apply(ctx) {
  const cfg = env();
  const runId = `${cfg.scenario}-${cfg.run}`;
  const resultsDir = cfg.resultsDir;
  if (!resultsDir) return;
  mkdirSync(resultsDir, { recursive: true });
  const outPath = join(resultsDir, `${runId}.continuation.json`);

  /** Arm-gated contract set: the rcc4 chain arms add the post-reload hop. */
  function scenarioContracts() {
    const base = SCENARIO_CONTRACTS[cfg.scenario] ?? [];
    if (cfg.scenario === "rcc4" && (cfg.arm === "chain" || cfg.arm === "chainstale")) {
      return ["plugin-revision-mismatch", "post-reload-healthcheck"];
    }
    return base;
  }

  const activeContracts = scenarioContracts().map((id) => CONTRACTS[id]);

  const state = {
    sessionId: null,
    finalized: false,
    lastDecisionKey: null,
    metrics: {
      run: runId,
      scenario: cfg.scenario,
      arm: cfg.arm,
      intents: 0,
      dispatches: 0,
      discards: 0,
      blocked: 0,
      aborted: 0,
      ambiguous: 0,
      chainRuns: 0,
      chainHops: 0,
      casChecks: 0,
      guardDenials: 0,
      recordFailures: 0,
      handlerErrors: 0,
      decisions: {},
    },
    interventions: [],
  };

  function logIntervention(kind, data) {
    state.interventions.push({ at: Date.now(), kind, ...(data ?? {}) });
  }

  function recordDecision(kind, data) {
    state.metrics.decisions[kind] = (state.metrics.decisions[kind] ?? 0) + 1;
    const key = JSON.stringify({ kind, ...(data ?? {}) });
    if (key !== state.lastDecisionKey) {
      state.lastDecisionKey = key;
      logIntervention(`decision-${kind}`, data ?? {});
    }
  }

  /** Narrow fact-source gate: per command SEGMENT (split on ; | & newlines). */
  function pwshSegments(callArguments) {
    try {
      const parsed = JSON.parse(callArguments);
      return String(parsed?.command ?? "").split(/[;&|\r\n]+/);
    } catch {
      return [];
    }
  }

  function segmentExecutesScript(segment, script) {
    const seg = String(segment ?? "").trim();
    if (/^(get-content|type|cat|select-string)\b/i.test(seg)) return false;
    // The world is the run cwd: script references must be relative. Absolute
    // paths or .. escapes would execute a TEMPLATE copy (smoke-observed leak:
    // the model read/ran files under the world templates directory).
    if (/^[A-Za-z]:/.test(seg) || /(^|[\s;&|])\.\./.test(seg)) return false;
    const escaped = script.replace(/\./g, "\\.");
    return new RegExp(`(^|\\s)(&\\s*)?[.\\\\/]*${escaped}\\b`, "i").test(seg);
  }

  function pwshRunsScript(callArguments, script) {
    return pwshSegments(callArguments).some((segment) => segmentExecutesScript(segment, script));
  }

  /**
   * Read-channel path scoping: a file observation counts as a world fact only
   * when the path belongs to the RUN world (relative to the session cwd, or
   * absolute inside the results dir). Reading a same-named file anywhere else
   * (e.g. the experiment's world templates) must not produce facts
   * (smoke-observed false REQUIRED).
   */
  function readFilePath(callArguments) {
    try {
      const parsed = JSON.parse(callArguments);
      return String(parsed?.file_path ?? "");
    } catch {
      return "";
    }
  }

  function isWorldFilePath(filePath) {
    const normalized = String(filePath ?? "").replace(/\\/g, "/");
    if (!/^[A-Za-z]:\//.test(normalized) && !normalized.startsWith("/")) return true; // relative to the run cwd
    const resultsPrefix = String(resultsDir ?? "").replace(/\\/g, "/").toLowerCase();
    if (resultsPrefix && normalized.toLowerCase().startsWith(`${resultsPrefix}/`)) return true;
    return false;
  }

  /** The LIVE world file is the exact bare basename — archived per-cell
   *  copies (<runId>.runtime-state.txt) are historical artifacts, never the
   *  current world (round-4 smoke-observed contamination). */
  function isLiveWorldBasename(filePath, name) {
    const basename = String(filePath ?? "").split(/[\\/]/).at(-1);
    return basename === name;
  }

  /** Contract's action with scenario overrides applied. */
  function actionOf(contractId) {
    const contract = CONTRACTS[contractId];
    const override = SCENARIO_ACTION_OVERRIDE[cfg.scenario];
    if (!override || contractId !== "plugin-revision-mismatch") return contract.action;
    return { name: contract.action.name, arguments: { ...contract.action.arguments, ...override } };
  }

  /**
   * Pure projection over the session event log (the ONLY fact source).
   * - artifact: latest "artifact=N" from a pwsh result that EXECUTES a
   *   fact-declared script (build.ps1 / stale-bump-artifact.ps1) in some
   *   segment, or latest "revision" from a read of artifact.json;
   * - runtime: latest "runtime_revision=N" from a pwsh result that EXECUTES
   *   verify/reload/stale-bump scripts, or from a read of runtime-state.txt;
   * - executions: scripts executed via pwsh (per-segment gate) — the durable
   *   "what ran" facts for post-conditions;
   * - continuationSeq: latest runtime/continuation seq per contract id.
   */
  function project(session) {
    const events = session.events;
    const callArgs = new Map();
    for (const event of events) {
      if (event.type === "tool/call" && event.data?.callId !== undefined) {
        callArgs.set(String(event.data.callId), {
          name: String(event.data.name ?? ""),
          arguments: String(event.data.arguments ?? ""),
        });
      }
    }
    let artifact = null;
    let runtime = null;
    const executions = new Set();
    const continuationSeq = new Map();
    let lastEditSeq = null;
    let lastCheckSeq = null;
    for (const event of events) {
      if (event.type === "runtime/continuation" && event.data?.contract !== undefined) {
        continuationSeq.set(String(event.data.contract), event.seq);
      }
      if (event.type === "tool/call" && event.data?.name === "pwsh") {
        for (const script of ["build.ps1", "verify.ps1", "reload.ps1", "reload-slow.ps1", "stale-bump.ps1", "stale-bump-artifact.ps1", "rollback.ps1", "healthcheck.ps1"]) {
          if (pwshRunsScript(event.data.arguments, script)) executions.add(script);
        }
        if (pwshRunsScript(event.data.arguments, "node") && /node\s+--check/.test(String(event.data.arguments))) {
          lastCheckSeq = event.seq;
        }
      }
      if (event.type === "tool/call" && event.data?.name === "str_replace_editor") {
        if (/lib[\\/]index\.js/i.test(String(event.data.arguments ?? ""))) {
          lastEditSeq = event.seq;
        }
      }
      if (event.type !== "tool/result") continue;
      const callId = event.data?.callId ?? event.data?.message?.source?.callId;
      const call = callId !== undefined ? callArgs.get(String(callId)) : null;
      if (!call) continue;
      const text = toolResultText(event.data?.message);
      if (call.name === "pwsh") {
        if (pwshRunsScript(call.arguments, "build.ps1") || pwshRunsScript(call.arguments, "stale-bump-artifact.ps1")) {
          const match = ARTIFACT_PATTERN.exec(text);
          if (match) artifact = { rev: Number(match[1]), seq: event.seq };
        }
        if (
          pwshRunsScript(call.arguments, "verify.ps1") ||
          pwshRunsScript(call.arguments, "reload.ps1") ||
          pwshRunsScript(call.arguments, "reload-slow.ps1") ||
          pwshRunsScript(call.arguments, "stale-bump.ps1")
        ) {
          const match = RUNTIME_PATTERN.exec(text);
          if (match) runtime = { rev: Number(match[1]), seq: event.seq };
        }
      } else if (call.name === "read") {
        const filePath = readFilePath(call.arguments);
        if (!isWorldFilePath(filePath)) continue;
        if (isLiveWorldBasename(filePath, "artifact.json")) {
          const match = /"revision"\s*:\s*(\d+)/.exec(text);
          if (match) artifact = { rev: Number(match[1]), seq: event.seq };
        }
        if (isLiveWorldBasename(filePath, "runtime-state.txt")) {
          const match = RUNTIME_PATTERN.exec(text);
          if (match) runtime = { rev: Number(match[1]), seq: event.seq };
        }
      }
    }
    return { artifact, runtime, executions, continuationSeq, lastEditSeq, lastCheckSeq };
  }

  /** Bounded wait on the staleness/cancel injection handshake (always settles). */
  function waitFor(promise, ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(), ms);
      promise.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Classify the next legal action set: unique REQUIRED / ambiguous / none. */
  function classify(proj) {
    const candidates = activeContracts.filter((contract) => contract.required(proj));
    if (candidates.length === 0) return { kind: "none", candidates: [] };
    if (candidates.length > 1) return { kind: "ambiguous", candidates };
    return { kind: "required", contract: candidates[0] };
  }

  /** True when the canonical result shape indicates a guard/approval denial. */
  function isGuardDenial(result) {
    const text = textOf(result?.content ?? []);
    return result?.isError === true && text.startsWith("Error: ");
  }

  /** One continuation hop: CAS + dispatch + loop-contract records + provenance. */
  async function dispatchHop(session, payload, contract, proj) {
    const basedOn = {
      artifactRev: proj.artifact?.rev ?? null,
      artifactSeq: proj.artifact?.seq ?? null,
      runtimeRev: proj.runtime?.rev ?? null,
      runtimeSeq: proj.runtime?.seq ?? null,
    };
    const exec = {
      name: contract.action.name,
      arguments: { ...actionOf(contract.id).arguments },
      callId: `cont_${Date.now()}_${state.metrics.dispatches + state.metrics.blocked + state.metrics.aborted + 1}`,
      agent: payload.agent,
      signal: payload.signal,
    };

    let result;
    try {
      result = await ctx.tools.execute(exec);
    } catch (error) {
      state.metrics.blocked += 1;
      logIntervention("dispatch-error", { contract: contract.id, message: String(error?.message ?? error) });
      return { outcome: "blocked", exec, result: null };
    }

    const outcome = payload.signal.aborted ? "aborted" : isGuardDenial(result) ? "blocked" : "dispatched";

    let callSeq = null;
    let resultSeq = null;
    try {
      session.append(
        "assistant/message",
        {
          turn: payload.turn,
          step: payload.step,
          message: {
            role: "assistant",
            id: randomUUID(),
            source: { kind: "runtime-continuation", contract: contract.kind, callId: exec.callId },
            content: [{ type: "tool-call", id: exec.callId, name: exec.name, arguments: JSON.stringify(exec.arguments) }],
          },
        },
        { surfaceOp: "append" },
      );
      callSeq = session.append("tool/call", {
        turn: payload.turn,
        step: payload.step,
        callId: exec.callId,
        name: exec.name,
        arguments: JSON.stringify(exec.arguments),
      }).seq;
      const message = {
        role: "user",
        id: randomUUID(),
        source: { kind: "tool", callId: exec.callId },
        content: [
          { type: "tool-result", toolCallId: exec.callId, content: result.content ?? [], isError: result.isError === true },
        ],
      };
      const resultEvent = session.append(
        "tool/result",
        {
          turn: payload.turn,
          step: payload.step,
          message,
          ...(result.error?.info !== undefined ? { error: result.error.info } : {}),
          ...(result.meta !== undefined ? { meta: result.meta } : {}),
        },
        { surfaceOp: "append", sourceEventSeqs: [callSeq] },
      );
      resultSeq = resultEvent.seq;
      session.append("runtime/continuation", {
        kind: "runtime/continuation",
        version: 1,
        contract: contract.id,
        action: "reload",
        authority: "runtime-observation",
        outcome,
        basedOn,
        ...(outcome === "dispatched" ? { revision: { artifact: basedOn.artifactRev, runtime: basedOn.runtimeRev } } : {}),
        callSeq,
        resultSeq,
        resultIsError: result.isError === true,
      });
    } catch (error) {
      state.metrics.recordFailures += 1;
      logIntervention("record-failure", { stage: "dispatch-records", message: String(error?.message ?? error) });
    }

    if (outcome === "dispatched") state.metrics.dispatches += 1;
    else if (outcome === "blocked") state.metrics.blocked += 1;
    else if (outcome === "aborted") state.metrics.aborted += 1;
    logIntervention(outcome, { contract: contract.id, callId: exec.callId, callSeq, resultSeq, resultIsError: result?.isError === true });

    return {
      outcome,
      exec,
      result,
      basedOn,
      text: result === null ? "" : toolResultText({ content: result.content ?? [] }),
    };
  }

  ctx.on("agent/pre-step", async (payload, next) => {
    const decision = await next();
    try {
      if (state.sessionId !== null && payload?.agent?.id !== state.sessionId) return decision;
      if (state.sessionId === null && payload?.agent?.id) state.sessionId = payload.agent.id;
      const session = payload?.agent?.session;
      if (!session || typeof session.append !== "function") return decision;

      // ---- classify once per pre-step ----
      let proj = project(session);
      const { artifact, runtime, continuationSeq } = proj;
      const classification = classify(proj);
      if (classification.kind === "ambiguous") {
        state.metrics.ambiguous += 1;
        recordDecision("ambiguous", {
          artifact: artifact?.rev ?? null,
          runtime: runtime?.rev ?? null,
          candidates: classification.candidates.map((c) => c.id),
        });
        return decision;
      }
      if (classification.kind === "none") {
        if (artifact === null || runtime === null) {
          recordDecision("needs-decision", { artifact: artifact?.rev ?? null, runtime: runtime?.rev ?? null });
        } else if (artifact.rev === runtime.rev) {
          recordDecision("complete", { artifact: artifact.rev, runtime: runtime.rev });
        } else {
          recordDecision("contracts-satisfied-none", { artifact: artifact.rev, runtime: runtime.rev });
        }
        return decision;
      }
      // REQUIRED (unique)
      const contract = classification.contract;
      if (continuationSeq.has(contract.id)) {
        recordDecision("already-continuated", { contract: contract.id, continuationSeq: continuationSeq.get(contract.id) });
        return decision;
      }

      // ---- handshake (staleness / cancellation injection window) ----
      state.metrics.intents += 1;
      const basedOnSnapshot = {
        artifactRev: artifact?.rev ?? null,
        artifactSeq: artifact?.seq ?? null,
        runtimeRev: runtime?.rev ?? null,
        runtimeSeq: runtime?.seq ?? null,
      };
      logIntervention("required", { contract: contract.id, basedOn: basedOnSnapshot });
      const deferred = { resolve: null, promise: null };
      deferred.promise = new Promise((resolve) => {
        deferred.resolve = resolve;
      });
      try {
        ctx.emit("exp/continuation-intent", {
          turn: payload.turn,
          step: payload.step,
          agent: payload.agent,
          session,
          signal: payload.signal,
          basedOn: basedOnSnapshot,
          deferred,
        });
      } catch {
        /* an emit failure must never break the loop */
      }
      await waitFor(deferred.promise, CAS_WAIT_MS);

      // ---- CAS: re-project; revisions moved? discard, never execute stale ----
      state.metrics.casChecks += 1;
      const now = project(session);
      const staleDetected =
        now.artifact?.rev !== basedOnSnapshot.artifactRev || now.runtime?.rev !== basedOnSnapshot.runtimeRev;
      if (staleDetected) {
        state.metrics.discards += 1;
        const observed = { artifactRev: now.artifact?.rev ?? null, runtimeRev: now.runtime?.rev ?? null };
        logIntervention("discarded-stale", { basedOn: basedOnSnapshot, observed });
        try {
          session.append("runtime/continuation", {
            kind: "runtime/continuation",
            version: 1,
            contract: contract.id,
            action: "reload",
            authority: "runtime-observation",
            outcome: "discarded",
            reason: "stale-cas",
            basedOn: basedOnSnapshot,
            observed,
          });
        } catch (error) {
          state.metrics.recordFailures += 1;
          logIntervention("record-failure", { stage: "discard-record", message: String(error?.message ?? error) });
        }
        if (cfg.inject && decision.kind === "enter" && !payload.signal.aborted) {
          const injected = {
            role: "user",
            id: randomUUID(),
            source: { kind: "plugin", plugin: "dsh-native-pp-continuation" },
            content: [
              {
                type: "text",
                text:
                  `[runtime-continuation] contract ${contract.id}: while the runtime was deciding, the world moved ` +
                  `(was artifact=${basedOnSnapshot.artifactRev} vs runtime=${basedOnSnapshot.runtimeRev}; the event stream now ` +
                  `observes artifact=${observed.artifactRev} runtime_revision=${observed.runtimeRev}), so the stale action was ` +
                  `discarded (CAS re-projection) and never executed. Digest the current facts and continue; do not replay the ` +
                  `stale decision.`,
              },
            ],
          };
          return { kind: "enter", messages: [...decision.messages, injected] };
        }
        return decision;
      }

      // ---- dispatch chain (bounded; Runtime A -> Runtime B -> Model) ----
      const hops = [];
      let chainResult = null;
      let nextContract = contract;
      for (let hop = 0; hop < MAX_CHAIN; hop += 1) {
        chainResult = await dispatchHop(session, payload, nextContract, proj);
        hops.push(chainResult);
        if (chainResult.outcome !== "dispatched" || payload.signal.aborted) break;
        state.metrics.chainHops += 1;
        if (hop + 1 >= MAX_CHAIN) break;
        // Mid-chain staleness window (chainstale arm only): a competing event
        // may invalidate the NEXT hop's premise between hop A and hop B. Each
        // hop re-projects from the event stream, so the stale next hop must
        // fail classification and the chain must stop — never continue along
        // a pre-computed chain.
        if (cfg.arm === "chainstale") {
          const chainDeferred = { resolve: null, promise: null };
          chainDeferred.promise = new Promise((resolve) => {
            chainDeferred.resolve = resolve;
          });
          try {
            ctx.emit("exp/continuation-chain-intent", {
              turn: payload.turn,
              step: payload.step,
              agent: payload.agent,
              session,
              signal: payload.signal,
              hop,
              dispatchedContract: nextContract.id,
              deferred: chainDeferred,
            });
          } catch {
            /* an emit failure must never break the loop */
          }
          await waitFor(chainDeferred.promise, 3000);
        }
        proj = project(session);
        const nextClassification = classify(proj);
        if (nextClassification.kind !== "required") break;
        if (proj.continuationSeq.has(nextClassification.contract.id)) break;
        nextContract = nextClassification.contract;
      }
      if (hops.length > 1) state.metrics.chainRuns += 1;

      // ---- hand the already-happened facts to the model (one digest) ----
      if (cfg.inject && decision.kind === "enter" && !payload.signal.aborted) {
        const parts = hops.map((hop, index) => {
          const label =
            hop.outcome === "dispatched"
              ? `hop ${index + 1}: the runtime dispatched ${hop.exec.name} (${String(hop.exec.arguments?.command ?? "")}) via the normal tool pipeline; result: ${hop.text}`
              : `hop ${index + 1}: outcome ${hop.outcome} (no world change)`;
          return label;
        });
        const injected = {
          role: "user",
          id: randomUUID(),
          source: { kind: "plugin", plugin: "dsh-native-pp-continuation" },
          content: [
            {
              type: "text",
              text:
                `[runtime-continuation] the runtime deterministically resolved ${hops.length} step(s) on contract facts ` +
                `(base facts: artifact=${basedOnSnapshot.artifactRev} vs runtime=${basedOnSnapshot.runtimeRev}). ${parts.join("; ")}. ` +
                `Do not re-run these actions; digest the outcomes and continue from the current world state.`,
            },
          ],
        };
        return { kind: "enter", messages: [...decision.messages, injected] };
      }
    } catch (error) {
      state.metrics.handlerErrors += 1;
      logIntervention("prestep-error", { message: String(error?.message ?? error) });
    }
    return decision;
  });

  // ---- wire filter: protocol placeholder stays durable, never model-visible ----
  function stripRuntimePairs(messages) {
    const blocked = new Set();
    for (const message of messages ?? []) {
      for (const block of message?.content ?? []) {
        const id =
          block?.type === "tool-call" ? String(block.id ?? "") : block?.type === "tool-result" ? String(block.toolCallId ?? "") : "";
        if (id.startsWith("cont_") || id.startsWith("stale_")) blocked.add(id);
      }
    }
    if (blocked.size === 0) return messages;
    return (messages ?? []).filter((message) => {
      for (const block of message?.content ?? []) {
        if (block?.type === "tool-call" && blocked.has(String(block.id ?? ""))) return false;
        if (block?.type === "tool-result" && blocked.has(String(block.toolCallId ?? ""))) return false;
      }
      return true;
    });
  }

  ctx.on("llm/stream", (options, next) => {
    try {
      const messages = options?.messages;
      if (Array.isArray(messages)) {
        const filtered = stripRuntimePairs(messages);
        if (filtered !== messages) return next({ ...options, messages: filtered });
      }
    } catch (error) {
      state.metrics.handlerErrors += 1;
      logIntervention("stream-filter-error", { message: String(error?.message ?? error) });
    }
    return next();
  });

  // ---- rccont scenario: facts-guard (instruction-continuity round) ----
  // The runtime DISCARDS a reload the model was instructed to perform when
  // the event-stream facts positively show the world already aligned. The
  // teaching reason cites the facts with their seqs. Deny ONLY on positive
  // aligned facts (narrow standard: without facts the guard stays silent —
  // it advises from evidence, it never fabricates). The model's reload
  // attempt during an actual mismatch passes (the continuation owns that
  // case).
  if (cfg.scenario === "rccont" || cfg.scenario === "rcc4") {
    ctx.effect(() =>
      ctx.tools.guard((exec) => {
        try {
          if (String(exec?.name ?? "") !== "pwsh") return;
          const args = exec?.arguments;
          let command = "";
          if (typeof args === "string") {
            try {
              command = String(JSON.parse(args)?.command ?? "");
            } catch {
              command = args;
            }
          } else if (args && typeof args === "object") {
            command = String(args.command ?? "");
          }
          const segments = String(command ?? "").split(/[;&|\r\n]+/);
          const runsReload = segments.some((segment) => segmentExecutesScript(segment, "reload.ps1"));
          if (!runsReload) return;
          const session = exec?.agent?.session;
          if (!session || typeof session.events !== "object") return;
          const proj = project(session);
          const { artifact, runtime } = proj;
          if (artifact === null || runtime === null) return; // no positive facts: stay silent
          if (artifact.rev !== runtime.rev) return; // genuine mismatch: allow
          state.metrics.guardDenials += 1;
          logIntervention("facts-guard-deny", {
            artifactRev: artifact.rev,
            artifactSeq: artifact.seq,
            runtimeRev: runtime.rev,
            runtimeSeq: runtime.seq,
            callId: exec?.callId ?? null,
          });
          return (
            `[runtime-facts] reload is unnecessary: the event stream already shows the world aligned ` +
            `(artifact=${artifact.rev}@seq${artifact.seq}, runtime_revision=${runtime.rev}@seq${runtime.seq}). ` +
            `The reload the instruction asked for has already happened; do not run reload.ps1 again — ` +
            `verify the current state and continue.`
          );
        } catch {
          /* a failing guard must never break dispatch */
        }
        return;
      }),
    );
  }

  function finalize() {
    if (state.finalized) return;
    state.finalized = true;
    try {
      writeFileSync(
        outPath,
        `${JSON.stringify(
          {
            run: runId,
            sessionId: state.sessionId,
            activeContracts: activeContracts.map((c) => c.kind),
            metrics: state.metrics,
            interventions: state.interventions,
            surface: {
              toolsRegistered: 0,
              promptEdits: state.metrics.dispatches + state.metrics.discards,
              modelCallsInitiated: 0,
            },
          },
          null,
          2,
        )}\n`,
      );
    } catch {
      /* last resort */
    }
  }

  ctx.on("agent/disposed", (payload) => {
    if (state.sessionId !== null && payload?.agent?.id !== state.sessionId) return;
    finalize();
  });
  process.on("exit", finalize);
}
