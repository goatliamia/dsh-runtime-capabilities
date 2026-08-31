import { createHash } from "node:crypto";

export const RUNTIME_EXPOSURE_PROTOCOL_VERSION = 1;

export const EXPOSURE_POLICIES = Object.freeze({
  NONE: "none",
  ALWAYS: "always",
  CHANGE_ONLY: "change-only",
  CHANGE_PERSISTENT: "change-persistent",
  REACT_DISCOVERY: "react-discovery",
});

export const RUNTIME_FACT_STATUSES = Object.freeze([
  "known",
  "unknown",
  "stale",
  "conflicting",
]);

const POLICY_VALUES = new Set(Object.values(EXPOSURE_POLICIES));
const STATUS_VALUES = new Set(RUNTIME_FACT_STATUSES);
const FACT_ENVELOPE_KEYS = new Set(["__fact", "value", "status", "authority", "reason", "source"]);
const SNAPSHOT_METADATA_KEYS = new Set([
  "protocolVersion",
  "protocol_version",
  "revision",
  "runtimeRevision",
  "runtime_revision",
  "observedAt",
  "observed_at",
  "source",
  "fingerprint",
  "changes",
  "runtimeChanges",
  "runtime_changes",
]);

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
}

function digest(value) {
  return createHash("sha256").update(stableValue(value)).digest("hex").slice(0, 16);
}

function finiteRevision(value) {
  if (value === undefined || value === null || value === "") return null;
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("runtime revision must be a non-negative safe integer");
  }
  return revision;
}

function timestamp(value, fallback = new Date().toISOString()) {
  if (value === undefined || value === null || value === "") return fallback;
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) throw new Error("runtime observedAt must be a valid date");
  return result.toISOString();
}

/**
 * Fact envelopes are explicit metadata around a value. A lifecycle object
 * such as { state: "ready" } is deliberately not an envelope; it is flattened
 * into the state leaf. This prevents ordinary runtime objects with a
 * `status: "ready"` field from being rejected as an invalid fact status.
 */
function isFactEnvelope(value) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (!keys.length || !keys.every((key) => FACT_ENVELOPE_KEYS.has(key))) return false;
  if (Object.hasOwn(value, "value") || Object.hasOwn(value, "__fact")) return true;
  if (Object.hasOwn(value, "status") && STATUS_VALUES.has(String(value.status).toLowerCase())) return true;
  return Object.hasOwn(value, "authority") || Object.hasOwn(value, "reason") || Object.hasOwn(value, "source");
}

function normalizeFact(value, path) {
  const input = isFactEnvelope(value) ? value : { value };
  const status = String(input.status || "known").toLowerCase();
  if (!STATUS_VALUES.has(status)) throw new Error(`invalid runtime fact status at ${path}: ${status}`);
  const fact = {
    status,
    value: input.value === undefined ? null : clone(input.value),
  };
  if (input.authority !== undefined && input.authority !== null && input.authority !== "") {
    fact.authority = String(input.authority).slice(0, 128);
  }
  if (input.reason !== undefined && input.reason !== null && input.reason !== "") {
    fact.reason = String(input.reason).slice(0, 512);
  }
  if (input.source !== undefined && input.source !== null) {
    if (!isRecord(input.source)) throw new Error(`runtime fact source at ${path} must be an object`);
    fact.source = clone(input.source);
  }
  if (status !== "known" && fact.reason === undefined) fact.reason = `fact is ${status}`;
  return fact;
}

function flattenFacts(value, prefix = "", output = {}) {
  if (!isRecord(value) || Array.isArray(value) || isFactEnvelope(value)) {
    output[prefix || "$" ] = normalizeFact(value, prefix || "$" );
    return output;
  }
  const keys = Object.keys(value);
  // An empty nested object is still an explicit known value. An empty root
  // object means “no facts”, which is useful for a dormant observer.
  if (!keys.length && prefix) output[prefix] = normalizeFact(value, prefix);
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    flattenFacts(value[key], path, output);
  }
  return output;
}

function unflattenFacts(flat) {
  const result = {};
  for (const [path, fact] of Object.entries(flat)) {
    if (path === "$") return clone(fact);
    const parts = path.split(".");
    let cursor = result;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      if (!isRecord(cursor[part])) cursor[part] = {};
      cursor = cursor[part];
    }
    cursor[parts.at(-1)] = clone(fact);
  }
  return result;
}

function factInputWithoutMetadata(input) {
  return Object.fromEntries(Object.entries(input)
    .filter(([key]) => !SNAPSHOT_METADATA_KEYS.has(key)));
}

function normalizeSnapshot(input = {}) {
  if (!isRecord(input)) throw new Error("runtime snapshot must be an object");
  const factsInput = input.facts === undefined ? factInputWithoutMetadata(input) : input.facts;
  if (!isRecord(factsInput)) throw new Error("runtime snapshot facts must be an object");
  const flat = flattenFacts(factsInput);
  delete flat["$"];
  const revision = finiteRevision(input.revision ?? input.runtimeRevision ?? input.runtime_revision);
  const observedAt = timestamp(input.observedAt ?? input.observed_at);
  const source = input.source === undefined ? undefined : clone(input.source);
  if (source !== undefined && !isRecord(source)) throw new Error("runtime snapshot source must be an object");
  return {
    protocolVersion: RUNTIME_EXPOSURE_PROTOCOL_VERSION,
    revision,
    observedAt,
    source,
    facts: flat,
    fingerprint: digest({ revision, facts: flat }),
  };
}

function factEqual(left, right) {
  return stableValue(left) === stableValue(right);
}

function diffFacts(previous = {}, current = {}) {
  const paths = new Set([...Object.keys(previous), ...Object.keys(current)]);
  const changes = [];
  for (const path of [...paths].sort()) {
    const beforeExists = Object.hasOwn(previous, path);
    const afterExists = Object.hasOwn(current, path);
    const before = previous[path];
    const after = current[path];
    if (beforeExists && afterExists && factEqual(before, after)) continue;
    changes.push({
      path,
      op: !beforeExists ? "add" : (!afterExists ? "remove" : "replace"),
      // JSON null is intentional here: undefined would disappear during
      // serialization and a consumer could not replay a removal.
      before: beforeExists ? clone(before) : null,
      after: afterExists ? clone(after) : null,
      status: after?.status || before?.status || "unknown",
    });
  }
  return changes;
}

function normalizeForcedChanges(changes = {}) {
  if (!Array.isArray(changes)) return [];
  return changes.filter((change) => isRecord(change) && String(change.path || "").trim())
    .map((change) => {
      const path = String(change.path).trim();
      const op = ["add", "replace", "remove"].includes(String(change.op || "").toLowerCase())
        ? String(change.op).toLowerCase()
        : (Object.hasOwn(change, "after") ? "replace" : "remove");
      const after = op === "remove" ? null : normalizeFact(
        Object.hasOwn(change, "after") ? change.after : change.value,
        path,
      );
      const before = Object.hasOwn(change, "before") && change.before !== null
        ? normalizeFact(change.before, path)
        : null;
      return {
        path,
        op,
        before,
        after,
        status: after?.status || before?.status || "known",
      };
    });
}

function mergeChanges(detected, forced) {
  if (!forced.length) return detected;
  const merged = new Map(detected.map((change) => [change.path, change]));
  for (const change of forced) {
    const existing = merged.get(change.path);
    merged.set(change.path, {
      ...change,
      before: change.before || existing?.before || null,
      // A forced removal is a tombstone in the emitted delta, not a value to
      // reinsert into the current snapshot.
      after: change.op === "remove" ? null : (change.after || existing?.after || null),
      status: change.status || existing?.status || "known",
    });
  }
  return [...merged.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function factPathsWithStatus(facts, status) {
  return Object.entries(facts)
    .filter(([, fact]) => fact.status === status)
    .map(([path]) => path)
    .sort();
}

function estimateTokens(value) {
  const chars = JSON.stringify(value ?? "").length;
  return Math.ceil(chars / 4);
}

function policyValue(policy) {
  const value = String(policy || EXPOSURE_POLICIES.CHANGE_PERSISTENT).toLowerCase();
  if (!POLICY_VALUES.has(value)) throw new Error(`invalid runtime exposure policy: ${value}`);
  return value;
}

function makeExposure({ policy, kind, reason, snapshot, changes = [], persistentContext = null, persistence = null }) {
  const base = {
    protocolVersion: RUNTIME_EXPOSURE_PROTOCOL_VERSION,
    policy,
    kind,
    reason,
    revision: snapshot.revision,
    observedAt: snapshot.observedAt,
    source: clone(snapshot.source),
    changes: clone(changes),
    unknownPaths: factPathsWithStatus(snapshot.facts, "unknown"),
    stalePaths: factPathsWithStatus(snapshot.facts, "stale"),
    conflictingPaths: factPathsWithStatus(snapshot.facts, "conflicting"),
  };
  if (kind === "baseline" || kind === "full") base.facts = unflattenFacts(snapshot.facts);
  if (kind === "delta") base.delta = clone(changes);
  // The baseline establishes the durable context once.  Subsequent deltas
  // must stay small so a host can reuse its existing KV/context state instead
  // of paying to resend the full Runtime snapshot on every change.
  if (persistentContext && kind === "baseline") base.context = clone(persistentContext);
  if (persistence) base.persistence = clone(persistence);
  return base;
}

/**
 * Deterministic Runtime observation state machine.
 *
 * A host supplies authoritative facts. This class decides only whether a
 * baseline, full snapshot, or delta should be exposed. It never registers a
 * model tool, edits a prompt, calls a model, or talks to a host runtime.
 */
export class RuntimeExposureController {
  constructor({ policy = EXPOSURE_POLICIES.CHANGE_PERSISTENT, now = () => new Date().toISOString() } = {}) {
    this.policy = policyValue(policy);
    this.now = now;
    this.lastSnapshot = null;
    this.persistentFacts = {};
    this.baselineRevision = null;
    this.baselineFingerprint = null;
    this.observationCount = 0;
    this.metricsState = this.#emptyMetrics();
  }

  #emptyMetrics() {
    return {
      observations: 0,
      emissions: 0,
      baselineEmissions: 0,
      deltaEmissions: 0,
      fullEmissions: 0,
      stableSuppressions: 0,
      policySuppressions: 0,
      unknownEmissions: 0,
      changedFacts: 0,
      payloadChars: 0,
      estimatedTokens: 0,
    };
  }

  observe(input = {}) {
    const raw = { ...input };
    const forcedChanges = normalizeForcedChanges(raw.changes ?? raw.runtimeChanges ?? raw.runtime_changes);
    delete raw.changes;
    delete raw.runtimeChanges;
    delete raw.runtime_changes;
    if (raw.observedAt === undefined) raw.observedAt = this.now();
    const snapshot = normalizeSnapshot(raw);
    const previous = this.lastSnapshot;
    const changes = mergeChanges(diffFacts(previous?.facts || {}, snapshot.facts), forcedChanges);
    const first = previous === null;
    this.lastSnapshot = snapshot;
    this.observationCount += 1;
    this.metricsState.observations += 1;
    this.metricsState.changedFacts += changes.length;

    const suppressed = (reason, extra = {}) => {
      if (reason === "stable") this.metricsState.stableSuppressions += 1;
      else this.metricsState.policySuppressions += 1;
      return {
        emitted: false,
        reason,
        exposure: null,
        revision: snapshot.revision,
        fingerprint: snapshot.fingerprint,
        changes: clone(changes),
        ...extra,
      };
    };

    if (this.policy === EXPOSURE_POLICIES.NONE || this.policy === EXPOSURE_POLICIES.REACT_DISCOVERY) {
      return suppressed("policy-suppressed", { requiresDiscovery: first || changes.length > 0 });
    }

    if (!first && changes.length === 0 && this.policy !== EXPOSURE_POLICIES.ALWAYS) {
      return suppressed("stable");
    }

    let kind;
    let reason;
    if (this.policy === EXPOSURE_POLICIES.ALWAYS) {
      kind = "full";
      reason = first ? "initial" : "always";
    } else if (first) {
      kind = "baseline";
      reason = "initial";
    } else {
      kind = "delta";
      reason = "changed";
    }

    let persistentContext = null;
    let persistence = null;
    if (this.policy === EXPOSURE_POLICIES.CHANGE_PERSISTENT) {
      if (first) {
        this.baselineRevision = snapshot.revision;
        this.baselineFingerprint = snapshot.fingerprint;
      }
      for (const [path, fact] of Object.entries(snapshot.facts)) this.persistentFacts[path] = clone(fact);
      for (const change of changes) if (change.op === "remove") delete this.persistentFacts[change.path];
      // The baseline is the only full context payload. Later deltas are
      // replayable patches and carry a small pointer to that baseline; they do
      // not repeat the entire context and therefore model KV-friendly reuse.
      persistentContext = kind === "baseline" ? unflattenFacts(this.persistentFacts) : null;
      persistence = {
        mode: "baseline-plus-delta",
        baseRevision: this.baselineRevision,
        baseFingerprint: this.baselineFingerprint,
        currentFingerprint: snapshot.fingerprint,
      };
    }

    const exposure = makeExposure({
      policy: this.policy,
      kind,
      reason,
      snapshot,
      changes,
      persistentContext,
      persistence,
    });
    const serialized = JSON.stringify(exposure);
    this.metricsState.emissions += 1;
    this.metricsState[`${kind}Emissions`] += 1;
    const nonKnownChange = changes.some((change) => (
      (change.after && change.after.status !== "known")
      || (change.op === "remove" && change.before && change.before.status !== "known")
    ));
    if (exposure.unknownPaths.length || exposure.stalePaths.length || exposure.conflictingPaths.length || nonKnownChange) {
      this.metricsState.unknownEmissions += 1;
    }
    this.metricsState.payloadChars += serialized.length;
    this.metricsState.estimatedTokens += estimateTokens(exposure);
    return {
      emitted: true,
      reason,
      exposure,
      revision: snapshot.revision,
      fingerprint: snapshot.fingerprint,
      changes: clone(changes),
      requiresDiscovery: false,
    };
  }

  current() {
    return this.lastSnapshot ? {
      revision: this.lastSnapshot.revision,
      observedAt: this.lastSnapshot.observedAt,
      source: clone(this.lastSnapshot.source),
      facts: unflattenFacts(this.lastSnapshot.facts),
      fingerprint: this.lastSnapshot.fingerprint,
    } : null;
  }

  persistentContext() {
    return this.policy === EXPOSURE_POLICIES.CHANGE_PERSISTENT
      ? unflattenFacts(this.persistentFacts)
      : null;
  }

  metrics() {
    return {
      policy: this.policy,
      ...this.metricsState,
      currentRevision: this.lastSnapshot?.revision ?? null,
      currentFingerprint: this.lastSnapshot?.fingerprint ?? null,
      persistent: this.policy === EXPOSURE_POLICIES.CHANGE_PERSISTENT,
      persistentBaseRevision: this.baselineRevision,
      persistentBaseFingerprint: this.baselineFingerprint,
    };
  }

  reset({ keepMetrics = false } = {}) {
    this.lastSnapshot = null;
    this.persistentFacts = {};
    this.baselineRevision = null;
    this.baselineFingerprint = null;
    this.observationCount = 0;
    if (!keepMetrics) this.metricsState = this.#emptyMetrics();
  }
}

export function createRuntimeExposureController(options) {
  return new RuntimeExposureController(options);
}

/**
 * Compose the next ReAct reason input. Runtime is a field of the next reason
 * input, never a synthetic chat participant or an extra model turn.
 */
export function composeReasonInput({ actionResult = null, environmentalObservation = null, runtimeResult = null } = {}) {
  const input = {};
  if (actionResult !== null && actionResult !== undefined) input.actionResult = clone(actionResult);
  if (environmentalObservation !== null && environmentalObservation !== undefined) {
    input.environmentalObservation = clone(environmentalObservation);
  }
  if (runtimeResult?.emitted && runtimeResult.exposure) input.runtimeObservation = clone(runtimeResult.exposure);
  return input;
}

export function normalizeRuntimeSnapshot(input) {
  return normalizeSnapshot(input);
}

function factMap(input) {
  if (isRecord(input) && isRecord(input.facts)) return input.facts;
  return input;
}

export function diffRuntimeFacts(previous, current) {
  const left = normalizeSnapshot({ facts: factMap(previous) || {} }).facts;
  const right = normalizeSnapshot({ facts: factMap(current) || {} }).facts;
  return diffFacts(left, right);
}

export function estimateRuntimePayload(value) {
  const payloadChars = JSON.stringify(value ?? "").length;
  return { payloadChars, estimatedTokens: Math.ceil(payloadChars / 4) };
}
