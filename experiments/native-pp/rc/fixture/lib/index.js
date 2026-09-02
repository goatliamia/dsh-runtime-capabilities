/**
 * dsh-native-pp-rc-fixture — deterministic world + observation for the
 * docs/19 Runtime Continuation experiment (route A, plugin-layer assembly).
 *
 * World (all files in the run cwd, materialized by the driver):
 *   artifact.json / runtime-state.txt / build.ps1 / verify.ps1 / reload.ps1
 *   + reload-count.txt / reload-marker.txt / verify-result.txt as effects.
 *   C-arm only: stale-bump.ps1 (competing pipeline).
 *
 * Responsibilities (observation ONLY — no intervention, no model calls):
 *   1. trace session/event records into <runId>.events.jsonl (full payload for
 *      tool/call, tool/result, turn/start, turn/end, compaction/start,
 *      compaction/summary, runtime/continuation; keys only otherwise);
 *   2. record metrics (modelCalls via llm/stream, toolCalls via tools/result);
 *   3. record world truth at finalize (artifact/runtime revisions, reload
 *      count, markers) — the truth is read from world FILES, never asserted
 *      from the event stream;
 *   4. C-arm staleness injection: on the continuation plugin's
 *      exp/continuation-intent host event (EXP_ARM=c only), run the competing
 *      pipeline (stale-bump.ps1) through the PUBLIC tools.execute boundary and
 *      append loop-contract tool/call + tool/result records, then resolve the
 *      intent's deferred so the plugin's CAS re-projection can see the new
 *      facts. Non-C arms resolve the deferred immediately.
 *
 * Zero default side effects: no plugin state files, no prompt edits. All
 * experiment output goes to EXP_RESULTS_DIR.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const name = "native-pp-rc-fixture";

export const inject = ["tools"];

const SCENARIOS = new Set(["rc", "rccontrol", "rccancel", "rcguard", "rcmulti", "rcbait", "rcnofacts", "rchain", "rccont", "rcc4"]);

function env() {
  const scenario = String(process.env.EXP_SCENARIO ?? "rc").toLowerCase();
  return {
    scenario: SCENARIOS.has(scenario) ? scenario : "rc",
    run: String(process.env.EXP_RUN ?? "r1").replace(/[^a-zA-Z0-9_-]/g, ""),
    arm: String(process.env.EXP_ARM ?? "a").toLowerCase(),
    resultsDir: String(process.env.EXP_RESULTS_DIR ?? "").trim(),
  };
}

export function apply(ctx) {
  const cfg = env();
  const runId = `${cfg.scenario}-${cfg.run}`;
  const resultsDir = cfg.resultsDir;
  mkdirSync(resultsDir, { recursive: true });
  const tracePath = join(resultsDir, `${runId}.events.jsonl`);
  const metricsPath = join(resultsDir, `${runId}.metrics.json`);
  const worldPath = join(resultsDir, `${runId}.world.json`);

  const metrics = {
    run: runId,
    scenario: cfg.scenario,
    arm: cfg.arm,
    sessionId: null,
    modelCalls: 0,
    toolCalls: 0,
    toolErrors: 0,
    perToolCalls: {},
    payloadChars: 0,
    traceEvents: 0,
    staleBumps: 0,
    staleBumpFailures: 0,
    cancelInjected: 0,
    guardDenials: 0,
    runtimeFailures: 0,
  };

  let sessionId = null;
  let sessionRef = null;
  let finalized = false;

  const FULL_PAYLOAD_TYPES = new Set([
    "tool/call",
    "tool/result",
    "turn/start",
    "turn/end",
    "compaction/start",
    "compaction/summary",
    "runtime/continuation",
  ]);

  function traceLine(obj) {
    try {
      // bug-003 discipline: never spread a payload that may carry `kind`;
      // outer kind wins, subtype payloads keep their own field names.
      const { kind: _ignored, ...rest } = obj ?? {};
      appendFileSync(tracePath, `${JSON.stringify({ t: Date.now(), kind: _ignored, ...rest })}\n`);
      metrics.traceEvents += 1;
    } catch {
      metrics.runtimeFailures += 1;
    }
  }

  function record(kind, data) {
    traceLine({ kind, ...(data ?? {}) });
  }

  ctx.on("agent/session-start", (payload) => {
    try {
      if (sessionId !== null && payload?.agent?.id !== sessionId) return;
      sessionId = payload?.agent?.id ?? sessionId;
      sessionRef = payload?.agent?.session ?? sessionRef;
      metrics.sessionId = sessionId;
      const tools = ctx.tools;
      const globalNames = (tools?.schemas?.() ?? []).map((s) => String(s?.name)).filter(Boolean).sort();
      record("session-start", { sessionId, globalToolNames: globalNames });
    } catch {
      metrics.runtimeFailures += 1;
    }
  });

  ctx.on("session/event", (session, event) => {
    try {
      if (sessionId !== null && session?.id !== sessionId) return;
      if (sessionId === null) {
        sessionId = session?.id ?? null;
        sessionRef = session ?? sessionRef;
        metrics.sessionId = sessionId;
      }
      const trace = { seq: event.seq, type: event.type, session: session?.id ?? null };
      if (FULL_PAYLOAD_TYPES.has(event.type)) {
        trace.data = event.data;
      } else {
        trace.dataKeys = Object.keys(event.data ?? {});
      }
      traceLine(trace);
    } catch {
      metrics.runtimeFailures += 1;
    }
  });

  ctx.on("llm/stream", (options, next) => {
    try {
      metrics.modelCalls += 1;
      const chars =
        JSON.stringify(options?.messages ?? []).length +
        JSON.stringify(options?.system ?? "").length +
        JSON.stringify(options?.tools ?? []).length;
      metrics.payloadChars += chars;
    } catch {
      metrics.runtimeFailures += 1;
    }
    return next();
  });

  // ---- rcguard scenario: the world's execution guard disables reload ----
  // The continuation MUST still pass this guard (no bypass): a denial
  // materializes as an isError result through the normal boundary, and the
  // model sees the same denial for its own reload attempts.
  if (cfg.scenario === "rcguard") {
    const tools = ctx.tools;
    if (tools && typeof tools.guard === "function") {
      ctx.effect(() =>
        tools.guard((exec) => {
          try {
            if (String(exec?.name ?? "") !== "pwsh") return;
            // exec.arguments reaches the guard as the SNAPSHOTTED OBJECT (the
            // prepare stage), not the durable JSON string — parse accordingly.
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
            if (/[.\\\\/]*reload\.ps1\b/i.test(command) && !/\b(get-content|type|cat)\b/i.test(command)) {
              metrics.guardDenials += 1;
              record("guard-deny", { callId: exec?.callId ?? null, command });
              return "[rc-guard] reload is disabled in this world; do not call reload.ps1, report the block instead";
            }
          } catch {
            /* a failing guard must never break dispatch */
          }
          return;
        }),
      );
    } else {
      record("runtime-failure", { type: "guard-unavailable", message: "tools.guard unavailable; rcguard scenario cannot install its guard" });
    }
  }

  ctx.on("tools/result", (exec, result) => {
    try {
      if (sessionId !== null && exec?.agent?.id !== sessionId) return;
      const toolName = String(exec?.name ?? "unknown");
      const isError = Boolean(result?.isError);
      metrics.toolCalls += 1;
      if (isError) metrics.toolErrors += 1;
      metrics.perToolCalls[toolName] = (metrics.perToolCalls[toolName] ?? 0) + 1;
      record("tool-result", { name: toolName, isError, callId: exec?.callId ?? null });
    } catch {
      metrics.runtimeFailures += 1;
    }
  });

  // ---- C-arm staleness injection handshake ----
  // The continuation plugin emits this host event between its projection and
  // its CAS re-projection. Injection variants by EXP_ARM:
  //   c        -> competing pipeline completes BOTH (stale-bump.ps1: 12/11 ->
  //               13/13); the stale reload must be discarded, zero execution.
  //   cpartial -> competing pipeline bumps the ARTIFACT only (12 -> 13,
  //               runtime stays 11); the stale intent (basedOn 12/11) must be
  //               discarded; a fresh intent on 13/11 may follow (recorded).
  //   cancel   -> the loop's own cancellation machinery: agent.cancel() aborts
  //               the running phase during the intent window; the continuation
  //               must NOT bypass normal cancellation semantics.
  //   others   -> resolve the deferred immediately (no injection).
  // The bump records replicate the loop contract (assistant pairing +
  // tool/call + tool/result) with source kind "stale-actor".
  ctx.on("exp/continuation-intent", (payload) => {
    const deferred = payload?.deferred;
    const arm = cfg.arm;
    if (arm === "cancel" || arm === "cancelmid") {
      const delayMs = arm === "cancelmid" ? 1500 : 0;
      if (delayMs > 0) {
        // Mid-body variant: release the deferred IMMEDIATELY so the plugin
        // proceeds to dispatch the slow reload; the cancellation lands 1.5s
        // later, mid-body (drain semantics). Bounded one-shot timer.
        deferred?.resolve?.();
        setTimeout(() => {
          try {
            const agent = payload?.agent;
            if (agent && typeof agent.cancel === "function") {
              agent.cancel(new Error("exp cancel during continuation dispatch (mid-body)"));
              metrics.cancelInjected += 1;
              record("cancel-injected", { outcome: "aborted-phase", delayMs });
            } else {
              record("cancel-injected", { outcome: "no-agent-cancel-api" });
            }
          } catch (error) {
            metrics.staleBumpFailures += 1;
            record("cancel-injected", { outcome: "error", message: String(error?.message ?? error) });
          }
        }, delayMs);
        return;
      }
      try {
        const agent = payload?.agent;
        if (agent && typeof agent.cancel === "function") {
          agent.cancel(new Error("exp cancel during continuation dispatch"));
          metrics.cancelInjected += 1;
          record("cancel-injected", { outcome: "aborted-phase", delayMs });
        } else {
          record("cancel-injected", { outcome: "no-agent-cancel-api" });
        }
      } catch (error) {
        metrics.staleBumpFailures += 1;
        record("cancel-injected", { outcome: "error", message: String(error?.message ?? error) });
      } finally {
        deferred?.resolve?.();
      }
      return;
    }
    if (arm !== "c" && arm !== "cpartial") {
      deferred?.resolve?.();
      return;
    }
    const bumpScript = arm === "cpartial" ? "stale-bump-artifact.ps1" : "stale-bump.ps1";
    try {
      const exec = {
        name: "pwsh",
        callId: `stale_${Date.now()}`,
        agent: payload?.agent,
        signal: payload?.signal,
        arguments: {
          command: `& .\\${bumpScript}`,
          description: "External pipeline bumps the artifact revision",
        },
      };
      (async () => {
        try {
          const result = await ctx.tools.execute(exec);
          const session = payload?.session;
          if (!session || typeof session.append !== "function") {
            record("stale-bump", { outcome: "skipped-no-session" });
            return;
          }
          // Same pairing discipline as the continuation dispatch: the provider
          // rejects a tool message without a preceding assistant tool_calls
          // entry, so the competing actor writes its own assistant/message
          // (source kind "stale-actor") before the tool/result.
          session.append(
            "assistant/message",
            {
              turn: payload.turn,
              step: payload.step,
              message: {
                role: "assistant",
                id: randomUUID(),
                source: { kind: "stale-actor", callId: exec.callId },
                content: [
                  {
                    type: "tool-call",
                    id: exec.callId,
                    name: exec.name,
                    arguments: JSON.stringify(exec.arguments),
                  },
                ],
              },
            },
            { surfaceOp: "append" },
          );
          const callSeq = session.append("tool/call", {
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
              {
                type: "tool-result",
                toolCallId: exec.callId,
                content: result.content ?? [],
                isError: result.isError === true,
              },
            ],
          };
          session.append(
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
          metrics.staleBumps += 1;
          record("stale-bump", { outcome: "applied", callSeq });
        } catch (error) {
          metrics.staleBumpFailures += 1;
          record("stale-bump", { outcome: "failed", message: String(error?.message ?? error) });
        } finally {
          deferred?.resolve?.();
        }
      })();
    } catch (error) {
      metrics.staleBumpFailures += 1;
      record("stale-bump", { outcome: "handler-error", message: String(error?.message ?? error) });
      deferred?.resolve?.();
    }
  });

  // ---- chainstale arm: mid-chain injection ----
  // Between chain hop A and hop B, a competing actor completes B's premise
  // (healthcheck). B must fail its re-projection and the chain must stop —
  // the continuation is event-driven, never a pre-computed plan.
  ctx.on("exp/continuation-chain-intent", (payload) => {
    const deferred = payload?.deferred;
    if (cfg.arm !== "chainstale") {
      deferred?.resolve?.();
      return;
    }
    try {
      const exec = {
        name: "pwsh",
        callId: `stale_${Date.now()}`,
        agent: payload?.agent,
        signal: payload?.signal,
        arguments: {
          command: "& .\\healthcheck.ps1",
          description: "External actor completes the health check",
        },
      };
      (async () => {
        try {
          const result = await ctx.tools.execute(exec);
          const session = payload?.session;
          if (!session || typeof session.append !== "function") {
            record("chain-stale", { outcome: "skipped-no-session" });
            return;
          }
          session.append(
            "assistant/message",
            {
              turn: payload.turn,
              step: payload.step,
              message: {
                role: "assistant",
                id: randomUUID(),
                source: { kind: "stale-actor", callId: exec.callId },
                content: [
                  { type: "tool-call", id: exec.callId, name: exec.name, arguments: JSON.stringify(exec.arguments) },
                ],
              },
            },
            { surfaceOp: "append" },
          );
          const callSeq = session.append("tool/call", {
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
          session.append(
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
          metrics.staleBumps += 1;
          record("chain-stale", { outcome: "applied", callSeq, hop: payload.hop });
        } catch (error) {
          metrics.staleBumpFailures += 1;
          record("chain-stale", { outcome: "failed", message: String(error?.message ?? error) });
        } finally {
          deferred?.resolve?.();
        }
      })();
    } catch (error) {
      metrics.staleBumpFailures += 1;
      record("chain-stale", { outcome: "handler-error", message: String(error?.message ?? error) });
      deferred?.resolve?.();
    }
  });

  function readWorldFile(name) {
    try {
      return readFileSync(join(resultsDir, name), "utf8").trim();
    } catch {
      return null;
    }
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
        arm: cfg.arm,
        sessionId,
        staleBumps: metrics.staleBumps,
        taskArtifactExists: existsSync(join(resultsDir, "result.txt")),
      };
      if (cfg.scenario !== "rccontrol") {
        const artifactRaw = readWorldFile("artifact.json");
        const runtimeRaw = readWorldFile("runtime-state.txt");
        const reloadCountRaw = readWorldFile("reload-count.txt");
        const rollbackCountRaw = readWorldFile("rollback-count.txt");
        let artifactRev = null;
        try {
          artifactRev = artifactRaw ? JSON.parse(artifactRaw).revision : null;
        } catch {
          /* unparsable */
        }
        let runtimeRev = null;
        try {
          runtimeRev = runtimeRaw ? Number(String(runtimeRaw.split("=")[1] ?? "").trim()) : null;
        } catch {
          /* unparsable */
        }
        const reloadCount = reloadCountRaw
          ? reloadCountRaw.split("\n").filter((l) => l.trim() !== "").length
          : 0;
        const rollbackCount = rollbackCountRaw
          ? rollbackCountRaw.split("\n").filter((l) => l.trim() !== "").length
          : 0;
        truth.rc = {
          artifactRev,
          runtimeRev,
          reloadCount,
          rollbackCount,
          reloadMarkerExists: existsSync(join(resultsDir, "reload-marker.txt")),
          verifyResult: readWorldFile("verify-result.txt"),
          healthCheck: readWorldFile("health-check.txt"),
          worldAligned: artifactRev !== null && runtimeRev !== null && artifactRev === runtimeRev,
        };
      }
      if (cfg.scenario === "rccontrol") {
        const testResult = readWorldFile("test-result.txt");
        truth.rccontrol = {
          testResult,
          worldCorrect: testResult === "PASS",
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
