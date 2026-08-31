/**
 * dsh-runtime-seam host half.
 *
 * The DSH adapter over the evidence-backed core (E1-E7). Defaults follow the
 * Minimal preset: teaching guard + no-progress circuit + critical delta only +
 * silence everywhere else. Everything is opt-in through the `runtime-seam`
 * settings namespace (preset + capability overrides).
 */
import { isIP } from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Schema from "@deepseek-ai/schemastery";

import {
  CircuitTracker,
  FactRegistry,
  PRESET_NAMES,
  activityRecord,
  circuitOpenReason,
  resolvePreset,
  teachingReason,
} from "./core.mjs";

export const name = "dsh-runtime-seam";
export const inject = ["tools", "settings"];

const API_PREFIX = "/api/runtime-seam";
const STATE_DIR = join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "plugins", "dsh-runtime-seam");
const STATE_FILE = join(STATE_DIR, "state.json");
const ACTIVITY_CAP = 200;

const SETTINGS_SCHEMA = Schema.object({
  preset: Schema.union(PRESET_NAMES.map((value) => Schema.const(value))).default("minimal"),
  authority: Schema.boolean().default(false),
  circuitThreshold: Schema.number().default(2),
  experimental: Schema.object({
    autoPickupInjection: Schema.boolean().default(false),
    broadExposure: Schema.boolean().default(false),
    reconcile: Schema.boolean().default(false),
  }).default({ autoPickupInjection: false, broadExposure: false, reconcile: false }),
});

function trustedRequest(req) {
  const remote = String(req.socket?.remoteAddress ?? "").replace(/^::ffff:/, "");
  const loopback = remote === "::1" || remote === "127.0.0.1" || (isIP(remote) === 4 && remote.startsWith("127."));
  if (!loopback) return false;
  if (req.headers?.["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers?.origin;
  const host = req.headers?.host;
  if (typeof origin !== "string" || typeof host !== "string") return req.headers?.["sec-fetch-site"] === "same-origin";
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function writeJson(res, status, value) {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader?.("content-type", "application/json; charset=utf-8");
  res.setHeader?.("cache-control", "no-store");
  res.end(body);
}

export function apply(ctx, _config) {
  const tools = ctx.tools;
  const settingsScope = ctx.settings.register("runtime-seam", SETTINGS_SCHEMA);

  const registry = new FactRegistry();
  const circuit = new CircuitTracker({ threshold: 2 });
  const guardRules = new Map(); // action -> rule
  const commitments = new Map(); // factPath -> { desired }
  const activity = [];
  const pendingDeltas = []; // messages to inject at the next pre-step
  let sessionId = null;
  let currentStep = 0;
  let teachingFailures = 0;

  const recordActivity = (kind, data) => {
    const entry = activityRecord(kind, data);
    activity.push(entry);
    if (activity.length > ACTIVITY_CAP) activity.shift();
    for (const listener of activityListeners) {
      try {
        listener(entry);
      } catch {
        /* an activity listener must never break the runtime */
      }
    }
    return entry;
  };
  const activityListeners = new Set();

  const readConfig = () => {
    let settings;
    try {
      settings = settingsScope.get() ?? { preset: "minimal" };
    } catch {
      settings = { preset: "minimal" };
    }
    return {
      settings,
      capabilities: resolvePreset(settings.preset ?? "minimal", {}),
    };
  };

  const configNow = () => readConfig().capabilities;
  const settingsNow = () => readConfig().settings;

  // ---- persistence (Strict / Goal) ----
  if (existsSync(STATE_FILE)) {
    try {
      const saved = JSON.parse(readFileSync(STATE_FILE, "utf8"));
      for (const [path, fact] of Object.entries(saved.facts ?? {})) {
        registry.setFact(path, fact.value, {
          status: fact.status ?? "known",
          authority: fact.authority ?? "host",
          reason: fact.reason ?? null,
        });
      }
    } catch {
      /* corrupt state file: start empty, never fail boot */
    }
  }

  function persist() {
    if (!configNow().persistence) return;
    try {
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(STATE_FILE, JSON.stringify({ savedAt: new Date().toISOString(), facts: registry.toJSON() }, null, 2));
    } catch {
      /* persistence must never fail the run */
    }
  }

  // ---- seam service for other runtime-* plugins ----
  const seam = {
    fact: (path) => registry.fact(path),
    setFact: (path, value, options) => {
      const result = registry.setFact(path, value, options);
      if (result.changed) {
        recordActivity("change", { path, value, revision: result.fact.revision });
        for (const [commitPath, commitment] of commitments) {
          if (commitPath === path && commitment.desired === value) {
            pendingDeltas.push({
              kind: "committed-delta",
              fact: registry.fact(path),
              text: `[runtime-observation committed-delta]\n${path} = ${JSON.stringify(value)} (authority: ${result.fact.authority}, revision: ${result.fact.revision}, fingerprint: ${result.fact.fingerprint})`,
            });
          }
        }
        persist();
      }
      return result;
    },
    declareUnknown: (path, reason) => seam.setFact(path, null, { status: "unknown", reason }),
    commit: ({ factPath, desired }) => {
      commitments.set(factPath, { desired });
      return () => commitments.delete(factPath);
    },
    /**
     * Goal v1 (narrow, per design review): Current + Desired + known transition.
     * Runtime announces (committed delta on change) and guards (existing guard
     * rules) — it NEVER executes the transition itself; runtime-executed
     * reconcile stays behind the experimental switch.
     */
    registerGoal: ({ factPath, desired }) => {
      const dispose = seam.commit({ factPath, desired });
      recordActivity("goal", { factPath, desired });
      const current = registry.fact(factPath);
      return {
        current: current?.value ?? null,
        desired,
        state: current?.value === desired ? "satisfied" : "pending",
        dispose,
      };
    },
    registerGuard: ({ action, factPath, predicate, predicateText, temporal = false, promise = false }) => {
      if (guardRules.has(action)) throw new Error(`runtime-seam: guard already registered for ${action}`);
      guardRules.set(action, { action, factPath, predicate, predicateText, temporal, promise });
      recordActivity("guard-registered", { action, factPath });
      return () => guardRules.delete(action);
    },
    activity: () => [...activity],
    onActivity: (listener) => {
      activityListeners.add(listener);
      return () => activityListeners.delete(listener);
    },
    teachingFailures: () => teachingFailures,
    capabilities: () => configNow(),
  };
  ctx.provide("runtimeSeam", seam);

  // ---- one monotonic guard dispatcher over all registered rules ----
  ctx.effect(() =>
    tools.guard((exec) => {
      if (!configNow().guard) return undefined;
      const toolName = String(exec?.name ?? "");
      const rule = guardRules.get(toolName);
      if (!rule) return undefined;
      const fact = registry.fact(rule.factPath);
      if (!fact) return undefined;
      let allowed = true;
      try {
        allowed = rule.predicate(fact.value, exec);
      } catch {
        allowed = false;
      }
      if (allowed) return undefined;
      const reason = teachingReason({
        action: rule.action,
        fact,
        predicate: rule.predicateText,
        temporal: rule.temporal,
        promise: rule.promise,
        authority: settingsNow().authority,
      });
      const pair = `${rule.factPath}:${rule.action}`;
      const repeats = activity.filter((entry) => entry.kind === "guard" && entry.pair === pair).length;
      if (repeats >= 1) teachingFailures += 1;
      recordActivity("guard", { action: rule.action, reason, pair, revision: fact.revision, step: currentStep });
      return reason;
    }),
  );

  // ---- circuit observation (tools/result, the E4/E4b fingerprint loop) ----
  ctx.on("tools/result", (exec, result) => {
    if (!configNow().circuit) return;
    if (!result?.isError) return;
    const toolName = String(exec?.name ?? "");
    if (!toolName) return;
    const text = (result?.content ?? [])
      .map((block) => (block?.type === "text" ? block.text : ""))
      .join("");
    const outcome = circuit.observeFailure(toolName, text, Number(settingsNow().circuitThreshold) || 2);
    if (outcome.opened) {
      const factPath = `capabilities.${toolName}.state`;
      const factResult = seam.setFact(factPath, "failed", { authority: "runtime" });
      recordActivity("circuit", {
        tool: toolName,
        fingerprint: outcome.signature,
        repeated: outcome.count,
        progress: "none",
        result: "opened",
        step: currentStep,
      });
      pendingDeltas.push({
        kind: "circuit-open",
        fact: factResult.fact,
        text: `[runtime-observation circuit-open]\n${factPath} = "failed" (authority: runtime, revision: ${factResult.fact.revision}, fingerprint: ${factResult.fact.fingerprint})\nrepeated identical failure detected; do not retry ${toolName}.`,
      });
      persist();
    }
  });

  // ---- the guard dispatcher also rejects calls to tools with an open circuit
  // (E4b: reject + announce was the best variant) ----
  // handled inside the dispatcher below.

  ctx.on("agent/pre-step", async (payload, next) => {
    const decision = await next();
    try {
      sessionId = payload?.agent?.id ?? sessionId;
      currentStep = payload.step;
      const capabilities = configNow();
      if (decision.kind !== "enter") return decision;
      const messages = [...decision.messages];
      if (capabilities.delta === "none") return decision;
      for (const delta of pendingDeltas.splice(0)) {
        if (capabilities.delta === "critical" && delta.kind !== "committed-delta" && delta.kind !== "circuit-open") continue;
        recordActivity("delta", { kind: delta.kind, path: delta.fact?.path, step: currentStep });
        messages.push({
          id: `rtx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: "user",
          content: [{ type: "text", text: delta.text }],
          source: { kind: "plugin", plugin: "dsh-runtime-seam" },
        });
      }
      return { kind: "enter", messages };
    } catch {
      return decision;
    }
  });

  // ---- activity + config route for the client ("Why did Runtime intervene?")
  // webServer does not exist in headless profiles: the seam must stay
  // fully functional without any HTTP surface.
  const webServer = ctx.get("webServer");
  if (webServer) {
    ctx.effect(() =>
      webServer.register({
        kind: "exact",
        path: `${API_PREFIX}/activity`,
        handler(req, res) {
          if (req.method !== "GET") return writeJson(res, 405, { ok: false, error: "method-not-allowed" });
          if (!trustedRequest(req)) return writeJson(res, 403, { ok: false, error: "forbidden" });
          writeJson(res, 200, {
            ok: true,
            data: {
              preset: settingsNow().preset,
              capabilities: configNow(),
              activity: [...activity].slice(-50).reverse(),
              teachingFailures,
              facts: registry.list().map((fact) => ({
                path: fact.path,
                value: fact.value,
                status: fact.status,
                authority: fact.authority,
                revision: fact.revision,
                fingerprint: fact.fingerprint,
              })),
            },
          });
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: "exact",
        path: `${API_PREFIX}/config`,
        handler: async (req, res) => {
          if (req.method !== "POST") return writeJson(res, 405, { ok: false, error: "method-not-allowed" });
          if (!trustedRequest(req)) return writeJson(res, 403, { ok: false, error: "forbidden" });
          try {
            const chunks = [];
            for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
            if (typeof body.preset === "string" && PRESET_NAMES.includes(body.preset)) {
              await ctx.settings.update("runtime-seam", { preset: body.preset });
              return writeJson(res, 200, { ok: true, data: { preset: body.preset } });
            }
            return writeJson(res, 400, { ok: false, error: "invalid-preset" });
          } catch {
            return writeJson(res, 400, { ok: false, error: "bad-request" });
          }
        },
      }),
    );
  }
}
