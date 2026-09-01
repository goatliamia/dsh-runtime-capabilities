/**
 * dsh-native-pp-fixture — deterministic world + raw event trace + offline replay
 * runner for the "DSH native Progress / Effect Projection" experiment
 * (docs/16-native-pp-experiment.md).
 *
 * LIVE mode (EXP_MODE absent or "live", profiles pp-a / pp-b):
 *   - registers three scenario tools with fixed behavior:
 *       exp_report        always succeeds, effect == its own result (observable)
 *       exp_flaky         always throws E32001 (execution failure)
 *       exp_unobservable  returns success but its world effect (a file write
 *                         under DSH_HOME/pp-effects, invisible to the agent and
 *                         NOT recorded in any session event) is unobservable
 *   - traces every session/event record into <results>/<runId>.events.jsonl
 *   - records world truth (what the fixture actually did) into <runId>.world.json
 *   - records run metrics (sessionId, modelCalls, initialTools, payloadChars,
 *     toolCalls, toolErrors) into <runId>.metrics.json
 *   - restricts the agent tool surface to a small whitelist for determinism
 *
 * REPLAY mode (EXP_MODE=replay, profile pp-r, no headless):
 *   - loads the stored session of a previous live run through the official
 *     sessionPersistence.loadStored + sessions.prepare(seedSource:"persistence")
 *     path, folds it with the projection package's pure fold, compares the
 *     result field-by-field against the live <runId>.projection.json, writes
 *     <runId>.replay.json, and exits. Zero model calls.
 *
 * Zero default side effects: no plugin state files, no SQLite, no prompt edits.
 * All experiment output goes to EXP_RESULTS_DIR.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export const name = "native-pp-fixture";

// Mirror the proven round-1 fixture wiring: inject the tools service so the
// resolution follows the PROVIDER scope (tools.register writes into the
// service's own layers — a scoped ctx.get view would register elsewhere and
// the agent would never see the tools).
export const inject = ["tools"];

const SCENARIOS = new Set(["ok", "toolfail", "unobservable", "loop", "nonatomic", "noop", "pretend", "real2", "real3", "real4", "real6"]);

function env() {
  const scenario = String(process.env.EXP_SCENARIO ?? "ok").toLowerCase();
  return {
    scenario: SCENARIOS.has(scenario) ? scenario : "ok",
    run: String(process.env.EXP_RUN ?? "r1").replace(/[^a-zA-Z0-9_-]/g, ""),
    resultsDir: String(process.env.EXP_RESULTS_DIR ?? "").trim(),
    mode: String(process.env.EXP_MODE ?? "live").trim().toLowerCase(),
    replaySession: String(process.env.EXP_REPLAY_SESSION ?? "").trim(),
  };
}

export function apply(ctx) {
  const cfg = env();
  if (cfg.mode === "replay") {
    applyReplay(ctx, cfg).catch((error) => {
      const out = {
        run: `${cfg.scenario}-${cfg.run}`,
        replaySession: cfg.replaySession,
        replayedAt: Date.now(),
        equal: false,
        diffs: [],
        error: String(error?.stack ?? error),
      };
      try {
        writeFileSync(join(cfg.resultsDir, `${cfg.scenario}-${cfg.run}.replay.json`), `${JSON.stringify(out, null, 2)}\n`);
      } catch {
        /* nothing */
      }
      const exit = ctx.get("appExit");
      if (typeof exit === "function") exit(1);
      else process.exitCode = 1;
    });
    return;
  }
  applyLive(ctx, cfg);
}

// ---------------------------------------------------------------------------
// LIVE mode
// ---------------------------------------------------------------------------

function applyLive(ctx, cfg) {
  const runId = `${cfg.scenario}-${cfg.run}`;
  const resultsDir = cfg.resultsDir;
  // Never depend on the driver having pre-created the directory.
  mkdirSync(resultsDir, { recursive: true });
  const tracePath = join(resultsDir, `${runId}.events.jsonl`);
  const metricsPath = join(resultsDir, `${runId}.metrics.json`);
  const worldPath = join(resultsDir, `${runId}.world.json`);
  // Real scenarios: the world is a real project in the run cwd (files the
  // driver materializes). Creative mode: NO tool restriction, NO exp tools.
  const isReal = cfg.scenario.startsWith("real");

  const world = {
    exp_reportCalls: 0,
    exp_flakyCalls: 0,
    exp_unobservableCalls: 0,
    exp_applyCalls: 0,
    exp_applyWrites: 0,
    exp_noopCalls: 0,
    exp_pretendCalls: 0,
    exp_checkCalls: 0,
    exp_repairCalls: 0,
    applied: false,
    effectFilesWritten: [],
  };

  const metrics = {
    run: runId,
    scenario: cfg.scenario,
    arm: String(process.env.EXP_ARM ?? "b"),
    sessionId: null,
    modelCalls: 0,
    initialTools: null,
    deniedTools: [],
    payloadChars: 0,
    toolCalls: 0,
    toolErrors: 0,
    policyDeniedCalls: 0,
    perToolCalls: {},
    traceEvents: 0,
    runtimeFailures: 0,
  };

  let sessionId = null;
  let finalized = false;
  let jobEventEmitted = false;

  function traceLine(obj) {
    try {
      // bug-003 discipline: never spread a payload that may carry `kind`;
      // outer kind wins, subtype payloads keep their own field names.
      const { kind: _ignored, ...rest } = obj ?? {};
      appendFileSync(tracePath, `${JSON.stringify({ t: Date.now(), kind: _ignored, ...rest })}\n`);
      metrics.traceEvents += 1;
    } catch (error) {
      metrics.runtimeFailures += 1;
    }
  }

  function record(kind, data) {
    traceLine({ kind, ...(data ?? {}) });
  }

  // ---- scenario tools ----
  function toolTemplate(name, description, parameters, body) {
    return {
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
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
      },
      async execute(args) {
        return body(args);
      },
    };
  }

  const scenarioTools = [
    toolTemplate(
      "exp_report",
      "Report completion of a task to the experiment host. The host acknowledges with the accepted flag. This tool's only effect is its own result.",
      { type: "object", properties: {}, additionalProperties: false },
      () => {
        world.exp_reportCalls += 1;
        record("world", { event: "exp_report-called", calls: world.exp_reportCalls });
        return { ok: true, accepted: true };
      },
    ),
    toolTemplate(
      "exp_flaky",
      "Probe a capability that has been reported to fail with a session error. Call it once and capture exactly what happens.",
      { type: "object", properties: {}, additionalProperties: false },
      async () => {
        world.exp_flakyCalls += 1;
        record("world", { event: "exp_flaky-called", calls: world.exp_flakyCalls });
        throw new Error("E32001: session expired (deterministic scenario failure)");
      },
    ),
    toolTemplate(
      "exp_unobservable",
      "Ask the host to complete an internal background operation. Returns whether the operation was accepted.",
      { type: "object", properties: {}, additionalProperties: false },
      async () => {
        world.exp_unobservableCalls += 1;
        // The world effect: a file write the agent cannot see and that no
        // session event records. Deliberately silent on the event stream.
        const home = String(process.env.DSH_HOME ?? "").trim();
        if (home) {
          const dir = join(home, "pp-effects");
          mkdirSync(dir, { recursive: true });
          const path = join(dir, `${runId}.txt`);
          writeFileSync(path, "effect-applied\n");
          world.effectFilesWritten.push(path);
        }
        record("world", { event: "exp_unobservable-called", calls: world.exp_unobservableCalls });
        return { ok: true, accepted: true };
      },
    ),
    // Non-atomic capability: every invocation first applies a REAL world
    // effect (appends a line to a file the agent cannot see and that no
    // session event records), then fails with a "response lost" error.
    // Retrying duplicates the side effect.
    toolTemplate(
      "exp_apply",
      "Apply a change to the external system and wait for confirmation. May lose the confirmation response after the change has been applied.",
      { type: "object", properties: {}, additionalProperties: false },
      async () => {
        world.exp_applyCalls += 1;
        const home = String(process.env.DSH_HOME ?? "").trim();
        if (home) {
          const dir = join(home, "pp-effects");
          mkdirSync(dir, { recursive: true });
          const path = join(dir, `${runId}.apply.txt`);
          appendFileSync(path, `apply-call-${world.exp_applyCalls}\n`);
          world.exp_applyWrites += 1;
          world.effectFilesWritten.push(path);
        }
        record("world", { event: "exp_apply-called", calls: world.exp_applyCalls, writes: world.exp_applyWrites });
        throw new Error("E33001: confirmation response lost after effect applied (deterministic scenario failure)");
      },
    ),
    // Success with no world progress: the call succeeds but changes nothing.
    toolTemplate(
      "exp_noop",
      "Check whether a background job needs work and report whether anything changed.",
      { type: "object", properties: {}, additionalProperties: false },
      async () => {
        world.exp_noopCalls += 1;
        record("world", { event: "exp_noop-called", calls: world.exp_noopCalls });
        return { ok: true, changed: false };
      },
    ),
    // Silent liar: reports success and claims a change, but applies NOTHING.
    toolTemplate(
      "exp_pretend",
      "Apply a configuration change to the external system and confirm that the change took effect.",
      { type: "object", properties: {}, additionalProperties: false },
      async () => {
        world.exp_pretendCalls += 1;
        record("world", { event: "exp_pretend-called", calls: world.exp_pretendCalls, applied: world.applied });
        return { ok: true, changed: true };
      },
    ),
    // Verification capability: the ground truth of whether the change exists.
    toolTemplate(
      "exp_check",
      "Check whether the configuration change is actually present in the external system. Returns the applied flag.",
      { type: "object", properties: {}, additionalProperties: false },
      async () => {
        world.exp_checkCalls += 1;
        record("world", { event: "exp_check-called", calls: world.exp_checkCalls, applied: world.applied });
        return { ok: true, applied: world.applied };
      },
    ),
    // Repair capability: actually applies the change (idempotent).
    toolTemplate(
      "exp_repair",
      "Apply the configuration change for real. Idempotent: returns whether it is applied afterwards.",
      { type: "object", properties: {}, additionalProperties: false },
      async () => {
        world.exp_repairCalls += 1;
        if (!world.applied) {
          world.applied = true;
          const home = String(process.env.DSH_HOME ?? "").trim();
          if (home) {
            const dir = join(home, "pp-effects");
            mkdirSync(dir, { recursive: true });
            const path = join(dir, `${runId}.repair.txt`);
            writeFileSync(path, "repaired\n");
            world.effectFilesWritten.push(path);
          }
        }
        record("world", { event: "exp_repair-called", calls: world.exp_repairCalls, applied: world.applied });
        return { ok: true, applied: world.applied };
      },
    ),
  ];

  const tools = ctx.tools;
  if (!isReal) {
    if (tools && typeof tools.register === "function") {
      for (const tool of scenarioTools) {
        ctx.effect(() => tools.register(tool));
      }
    } else {
      record("runtime-failure", { type: "no-tools-service", message: "ctx.tools unavailable; scenario tools not registered" });
    }
  }

  // ---- contract registration for the core policy packages ----
  // The core packages ship with EMPTY contract tables; contracts are domain
  // declarations. The test fixture registers the experiment contracts when
  // EXP_CONTRACTS=1 (acceptance profiles t-a).
  if (process.env.EXP_CONTRACTS === "1") {
    (async () => {
      try {
        const circuit = await import("dsh-runtime-circuit");
        circuit.registerCircuitContract({ id: "exp_flaky", match: { tool: "exp_flaky" }, threshold: 2 });
        const reconcile = await import("dsh-runtime-reconcile");
        reconcile.registerNonAtomicContract({ id: "exp_apply", match: { tool: "exp_apply" } });
        reconcile.registerNonAtomicContract({ id: "deploy", match: { tool: "pwsh", pattern: /deploy\.ps1/i } });
        const investigate = await import("dsh-runtime-investigate");
        investigate.registerClaimedContract({ id: "exp_pretend", match: { tool: "exp_pretend" }, verify: "exp_check", repair: "exp_repair" });
        investigate.registerClaimedContract({ id: "apply-config", match: { tool: "pwsh", pattern: /apply-config/i }, verify: "verify.ps1", repair: "reload.ps1" });
        record("contracts-registered", { via: "EXP_CONTRACTS=1" });
      } catch (error) {
        record("runtime-failure", { type: "contract-registration", message: String(error?.message ?? error) });
      }
    })();
  }

  // ---- observation ----
  ctx.on("agent/session-start", (payload) => {
    try {
      if (sessionId !== null && payload?.agent?.id !== sessionId) return;
      sessionId = payload?.agent?.id ?? sessionId;
      metrics.sessionId = sessionId;
      const allExpTools = ["exp_report", "exp_flaky", "exp_unobservable", "exp_apply", "exp_noop"];
      // Per-scenario tool surface: only the scenario-relevant capability is
      // exposed to the agent, keeping trajectories focused and comparable.
      // Real scenarios skip the clamp entirely (creative mode: full surface).
      const scenarioTool = {
        ok: ["exp_report"],
        toolfail: ["exp_flaky"],
        unobservable: ["exp_unobservable"],
        loop: ["exp_flaky"],
        nonatomic: ["exp_apply"],
        noop: ["exp_noop"],
        pretend: ["exp_pretend", "exp_check", "exp_repair"],
      }[cfg.scenario] ?? [];
      const whitelist = ["pwsh", "str_replace_editor", ...scenarioTool];
      const globalNames = (tools?.schemas?.() ?? []).map((s) => String(s?.name)).filter(Boolean).sort();
      record("session-start", {
        sessionId,
        globalToolNames: globalNames,
        scenarioToolsVisible: ["exp_report", "exp_flaky", "exp_unobservable"].filter((n) => globalNames.includes(n)),
      });
      const agentCtx = payload?.agent?.ctx;
      if (agentCtx && !isReal) {
        const scopedTools = agentCtx.get("tools");
        if (scopedTools && typeof scopedTools.restrict === "function") {
          const deny = globalNames.filter((n) => !whitelist.includes(n));
          scopedTools.restrict({ deny });
          metrics.deniedTools = deny;
        }
      }
    } catch (error) {
      metrics.runtimeFailures += 1;
      record("runtime-failure", { type: "session-start", message: String(error?.message ?? error) });
    }
  });

  ctx.on("session/event", (session, event) => {
    try {
      if (sessionId !== null && session?.id !== sessionId) return;
      if (sessionId === null) sessionId = session?.id ?? null;
      const trace = { seq: event.seq, type: event.type, session: session?.id ?? null };
      // Full payload only for verdict-relevant record kinds; keys for the rest.
      if (["tool/call", "tool/result", "turn/start", "turn/end", "goal/change"].includes(event.type)) {
        trace.data = event.data;
      } else {
        trace.dataKeys = Object.keys(event.data ?? {});
      }
      traceLine(trace);
    } catch (error) {
      metrics.runtimeFailures += 1;
    }
  });

  ctx.on("llm/stream", (options, next) => {
    try {
      metrics.modelCalls += 1;
      if (Array.isArray(options?.tools)) {
        const names = options.tools.map((s) => String(s?.name)).filter(Boolean).sort();
        if (metrics.initialTools === null) {
          metrics.initialTools = names;
          record("initial-surface", { tools: names });
        }
      }
      const chars =
        JSON.stringify(options?.messages ?? []).length +
        JSON.stringify(options?.system ?? "").length +
        JSON.stringify(options?.tools ?? []).length;
      metrics.payloadChars += chars;
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
      if (isError) metrics.toolErrors += 1;
      metrics.perToolCalls[toolName] = (metrics.perToolCalls[toolName] ?? 0) + 1;
      // Guard denials arrive as synthetic error results carrying the policy
      // marker; they never executed the tool body.
      const text = (result?.content ?? [])
        .map((block) => (block?.type === "text" ? block.text : ""))
        .join("");
      const denied = text.includes("Error: [progress-policy");
      if (denied) metrics.policyDeniedCalls += 1;
      record("tool-result", { name: toolName, isError, policyDenied: denied });
    } catch (error) {
      metrics.runtimeFailures += 1;
    }
  });

  function readWorldFile(name) {
    try {
      return readFileSync(join(resultsDir, name), "utf8").trim();
    } catch {
      return null;
    }
  }

  // ---- real4 async job world ----
  // The job-state transition is scripted HOST-SIDE (no child process spawn in
  // the sandbox — spawned children inherit the sandbox pipes and hang the
  // tool call). job-start.ps1 only marks "running"; on the first observation
  // of "running", the fixture arms a one-shot timer that completes the job
  // and publishes the platform event (the event-substrate analogue).
  // CRITICAL: the watcher and the completion timer live inside ctx.effect so
  // Cordis disposes them on shutdown — a raw setInterval keeps the event loop
  // alive and the process never exits after the turn completes.
  if (cfg.scenario === "real4") {
    const statePath = join(resultsDir, "job-state.txt");
    ctx.effect(() => {
      const completionTimer = { handle: null };
      const watcher = setInterval(() => {
        try {
          const state = readFileSync(statePath, "utf8").trim();
          if (state === "running" && completionTimer.handle === null) {
            record("world", { event: "job-running-observed" });
            completionTimer.handle = setTimeout(() => {
              try {
                writeFileSync(statePath, "complete");
                if (!jobEventEmitted) {
                  jobEventEmitted = true;
                  record("world", { event: "job-complete-observed" });
                  ctx.emit("exp/job-changed", { state: "complete" });
                }
              } catch {
                /* last resort */
              }
            }, 15000);
          }
        } catch {
          /* file not there yet */
        }
      }, 500);
      return () => {
        clearInterval(watcher);
        if (completionTimer.handle !== null) clearTimeout(completionTimer.handle);
      };
    });
  }

  function finalize() {
    if (finalized) return;
    finalized = true;
    try {
      writeFileSync(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
    } catch {
      /* last resort */
    }
    try {
      const truth = {
        run: runId,
        scenario: cfg.scenario,
        sessionId,
        exp_reportCalls: world.exp_reportCalls,
        exp_flakyCalls: world.exp_flakyCalls,
        exp_unobservableCalls: world.exp_unobservableCalls,
        exp_applyCalls: world.exp_applyCalls,
        exp_applyWrites: world.exp_applyWrites,
        exp_noopCalls: world.exp_noopCalls,
        exp_pretendCalls: world.exp_pretendCalls,
        exp_checkCalls: world.exp_checkCalls,
        exp_repairCalls: world.exp_repairCalls,
        applied: world.applied,
        silentError: world.exp_pretendCalls > 0 && !world.applied,
        effectFilesWritten: world.effectFilesWritten,
        effectFileExists: world.effectFilesWritten.some((p) => existsSync(p)),
        taskArtifactExists: existsSync(join(resultsDir, "count.txt")) || (isReal && existsSync(join(resultsDir, "result.txt"))),
        retries: Object.entries(metrics.perToolCalls)
          .filter(([name, count]) => name.startsWith("exp_") && count > 1)
          .reduce((sum, [, count]) => sum + count - 1, 0),
      };
      if (cfg.scenario === "real3") {
        const configRaw = readWorldFile("config.json");
        const runtimeRaw = readWorldFile("runtime-state.txt");
        const verifyRaw = readWorldFile("verify-result.txt");
        let configMode = null;
        let runtimeMode = null;
        try {
          configMode = configRaw ? JSON.parse(configRaw).mode : null;
        } catch {
          /* unparsable */
        }
        try {
          runtimeMode = runtimeRaw ? String(runtimeRaw.split("=")[1] ?? runtimeRaw).trim() : null;
        } catch {
          /* unparsable */
        }
        truth.real3 = {
          configMode,
          runtimeMode,
          verifyResult: verifyRaw,
          reloaded: existsSync(join(resultsDir, "reload-marker.txt")),
          worldCorrect: configMode === "fast" && runtimeMode === "fast",
          silentFailure: configMode === "fast" && runtimeMode !== "fast" && !existsSync(join(resultsDir, "reload-marker.txt")),
        };
      }
      if (cfg.scenario === "real6") {
        const testResult = readWorldFile("test-result.txt");
        truth.real6 = {
          testResult,
          worldCorrect: testResult === "PASS",
        };
      }
      if (cfg.scenario === "real2") {
        const deployCount = readWorldFile("deploy-count.txt");
        const lines = deployCount ? deployCount.split("\n").filter((l) => l.trim() !== "").length : 0;
        truth.real2 = {
          deployAttempts: lines,
          duplicateSideEffects: Math.max(0, lines - 1),
          worldCorrect: lines === 1, // exactly one deployment in the external system
        };
      }
      if (cfg.scenario === "real4") {
        const state = readWorldFile("job-state.txt");
        const statusCount = readWorldFile("status-count.txt");
        const statusLines = statusCount ? statusCount.split("\n").filter((l) => l.trim() !== "").length : 0;
        truth.real4 = {
          jobState: state,
          statusPolls: statusLines,
          jobEventEmitted,
          worldCorrect: state === "complete",
        };
      }
      writeFileSync(worldPath, `${JSON.stringify(truth, null, 2)}\n`);
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

// ---------------------------------------------------------------------------
// REPLAY mode (profile pp-r: no headless, zero model calls)
// ---------------------------------------------------------------------------

async function applyReplay(ctx, cfg) {
  const runId = `${cfg.scenario}-${cfg.run}`;
  const resultsDir = cfg.resultsDir;
  const replayPath = join(resultsDir, `${runId}.replay.json`);
  const liveProjectionPath = join(resultsDir, `${runId}.projection.json`);
  const exit = ctx.get("appExit");

  const out = {
    run: runId,
    replaySession: cfg.replaySession,
    replayedAt: Date.now(),
    equal: false,
    diffs: [],
    restoreApiOk: false,
    restoreApiNote: null,
    eventsCount: null,
    foldMs: null,
    error: null,
  };

  const finish = (code) => {
    try {
      writeFileSync(replayPath, `${JSON.stringify(out, null, 2)}\n`);
    } catch {
      /* nothing */
    }
    if (typeof exit === "function") exit(code);
    else process.exitCode = code;
  };

  try {
    const loader = ctx.get("loader");
    if (loader && typeof loader.await === "function") await loader.await();

    const persistence = ctx.get("sessionPersistence");
    const sessions = ctx.get("sessions");
    if (!persistence || typeof persistence.loadStored !== "function") {
      out.error = "sessionPersistence.loadStored unavailable in this profile";
      return finish(1);
    }

    const prefix = await persistence.loadStored(cfg.replaySession);
    if (!prefix || !Array.isArray(prefix.events)) {
      out.error = `no stored session "${cfg.replaySession}"`;
      return finish(1);
    }
    out.storedEvents = prefix.events.length;

    let events = prefix.events;
    if (sessions && typeof sessions.prepare === "function") {
      try {
        const restored = sessions.prepare(cfg.replaySession, {
          seed: prefix.events,
          meta: prefix.meta,
          seedSource: "persistence",
        });
        events = restored.events;
        out.restoreApiOk = true;
        // Official restore semantics: the Session constructor appends one
        // log-only session/end-seed boundary marker (E3 table). The fold
        // ignores it; record the observation honestly.
        if (events.length === prefix.events.length + 1 && events.at(-1)?.type === "session/end-seed") {
          out.restoreMarker = "session/end-seed appended by restore constructor";
        }
      } catch (error) {
        out.restoreApiNote = String(error?.message ?? error);
      }
    }
    out.restoredEvents = events.length;

    const { foldProjection } = await import("dsh-native-pp-projection");
    const t0 = Date.now();
    const projection = foldProjection(events);
    out.foldMs = Date.now() - t0;
    out.eventsCount = events.length;

    let live;
    try {
      live = JSON.parse(readFileSync(liveProjectionPath, "utf8"));
    } catch (error) {
      out.error = `cannot read live projection: ${String(error?.message ?? error)}`;
      return finish(1);
    }

    // Field-by-field comparison of the FOLD result only: the live file wraps
    // the fold under `.projection` plus time-derived fields (writtenAt /
    // hostTiming / foldMs), which are excluded by strip().
    const liveFold = live?.projection ?? live;
    const strip = (obj) => {
      const clone = JSON.parse(JSON.stringify(obj));
      const walk = (node) => {
        if (node === null || typeof node !== "object") return;
        for (const key of Object.keys(node)) {
          if (key === "foldMs" || key === "hostTiming" || key === "writtenAt") {
            delete node[key];
            continue;
          }
          walk(node[key]);
        }
      };
      walk(clone);
      return clone;
    };
    const a = JSON.stringify(strip(projection));
    const b = JSON.stringify(strip(liveFold));
    out.equal = a === b;
    if (!out.equal) {
      const diffPaths = (x, y, path) => {
        const found = [];
        if (x === null || y === null || typeof x !== "object" || typeof y !== "object") {
          if (x !== y) found.push(`${path}: live=${JSON.stringify(y)} replay=${JSON.stringify(x)}`);
          return found;
        }
        for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
          found.push(...diffPaths(x[key], y[key], `${path}.${key}`));
        }
        return found;
      };
      out.diffs = diffPaths(JSON.parse(a), JSON.parse(b), "").slice(0, 50);
    }
    out.projection = projection;
    return finish(out.equal ? 0 : 1);
  } catch (error) {
    out.error = String(error?.stack ?? error);
    return finish(1);
  }
}
