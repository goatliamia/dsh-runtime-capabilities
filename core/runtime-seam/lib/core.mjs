/**
 * dsh-runtime-seam — host-independent core (evidence-backed primitives E1-E7).
 *
 * This module never touches DSH APIs. It owns:
 *   - the fact registry (value/status/authority/revision/fingerprint)
 *   - teaching-reason templates (plain / authority-bearing)
 *   - the no-progress circuit tracker
 *   - preset definitions (Minimal / Strict / Goal / Custom)
 *   - activity records ("Why did Runtime intervene?")
 */
import { createHash } from "node:crypto";

// ---- deterministic hashing ----
export function stableValue(value) {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
}

export function digest(value) {
  return createHash("sha256").update(stableValue(value)).digest("hex").slice(0, 16);
}

// ---- fact registry ----
const FACT_STATUSES = new Set(["known", "unknown", "stale", "conflicting"]);

export class FactRegistry {
  constructor() {
    this.facts = new Map();
  }

  setFact(path, value, { status = "known", authority = "host", reason = null } = {}) {
    if (!FACT_STATUSES.has(status)) throw new Error(`invalid fact status: ${status}`);
    const previous = this.facts.get(path);
    if (previous && previous.value === value && previous.status === status) {
      return { changed: false, fact: previous };
    }
    const revision = (previous?.revision ?? 0) + 1;
    const fact = {
      path,
      value: value === undefined ? null : value,
      status,
      authority,
      reason,
      revision,
      fingerprint: digest({ path, value }),
      changedAt: new Date().toISOString(),
      previousValue: previous ? previous.value : null,
    };
    this.facts.set(path, fact);
    return { changed: true, fact };
  }

  declareUnknown(path, reason = "host_did_not_expose_fact") {
    return this.setFact(path, null, { status: "unknown", reason });
  }

  fact(path) {
    return this.facts.get(path) ?? null;
  }

  list() {
    return [...this.facts.values()];
  }

  toJSON() {
    return Object.fromEntries([...this.facts.entries()].map(([path, fact]) => [path, fact]));
  }
}

// ---- teaching reasons (E1/E3/E5 format) ----
export function teachingReason({ action, fact, predicate, temporal = false, promise = false, authority = false }) {
  const lines = [`[action-rejected] ${action}`];
  lines.push(`fact: ${fact.path} = ${JSON.stringify(fact.value)}`);
  if (authority) {
    lines.push(
      `status: ${fact.status} | authority: ${fact.authority} | revision: ${fact.revision} | fingerprint: ${fact.fingerprint}`,
    );
  }
  lines.push(`predicate: ${predicate}`);
  if (temporal) {
    lines.push(`temporal: yes — the fact is expected to change`);
    lines.push(
      promise
        ? "next: wait for the runtime to announce the change (a delta will arrive), then retry"
        : "next: the precondition is not met yet; retry later",
    );
  } else {
    lines.push("temporal: no");
    lines.push("next: this action is not valid; drop it");
  }
  return lines.join("\n");
}

export function circuitOpenReason({ fact, authority = false }) {
  const lines = ["[action-rejected] circuit-open"];
  lines.push(`fact: ${fact.path} = "failed"`);
  if (authority) {
    lines.push(`status: known | authority: ${fact.authority} | revision: ${fact.revision} | fingerprint: ${fact.fingerprint}`);
  }
  lines.push("predicate: repeated identical failure with no runtime progress");
  lines.push("temporal: no");
  lines.push("next: stop retrying; report the error");
  return lines.join("\n");
}

// ---- circuit tracker (E4/E4b) ----
// LEGACY (2026-09-02): fingerprint semantics ("same tool + same error code")
// superseded by core/runtime-circuit, which consumes the Progress fold
// (stalled x N). Kept exported for seam-internal compatibility until the
// preset rewiring lands; new policies must NOT depend on this class.
export class CircuitTracker {
  constructor({ threshold = 2 } = {}) {
    this.threshold = threshold;
    this.counts = new Map();
    this.open = new Set(); // tool names with an open circuit
  }

  /** Signature ignores arguments: same tool + same error code = same loop. */
  observeFailure(tool, errorText, threshold = this.threshold) {
    const code = /E\d+/.exec(errorText ?? "")?.[0] ?? "generic-error";
    const signature = digest({ tool, code });
    const count = (this.counts.get(signature) ?? 0) + 1;
    this.counts.set(signature, count);
    if (count >= threshold && !this.open.has(tool)) {
      this.open.add(tool);
      return { opened: true, tool, signature, count };
    }
    return { opened: false, tool, signature, count };
  }

  isOpen(tool) {
    return this.open.has(tool);
  }

  reset(tool) {
    this.open.delete(tool);
  }
}

// ---- presets: responsibility combinations, not strength levels ----
// 2026-09-02 reframe (docs/17, docs/18): presets select WHICH deterministic
// responsibilities the Runtime takes, not "how strict" it is.
//   guard       已知非法动作拦截（执行前：能不能做）
//   circuit     连续无进展熔断（消费 progress 的 stalled）
//   reconcile   副作用可能已发生时不盲目重试（failure + progressed）
//   investigate 成功但未生效 → 验证修复（success + stalled）
//   delta       critical-delta-first 上下文（placement 实验定稿：不折腾）
export const PRESETS = Object.freeze({
  off: Object.freeze({ guard: false, circuit: false, reconcile: false, investigate: false, delta: "none", persistence: false, goal: false, query: false, exposure: "silent" }),
  minimal: Object.freeze({ guard: true, circuit: true, reconcile: false, investigate: false, delta: "critical", persistence: false, goal: false, query: true, exposure: "silent" }),
  balanced: Object.freeze({ guard: true, circuit: true, reconcile: true, investigate: false, delta: "critical", persistence: false, goal: false, query: true, exposure: "silent" }),
  strict: Object.freeze({ guard: true, circuit: true, reconcile: true, investigate: true, delta: "critical", persistence: true, goal: false, query: true, exposure: "silent" }),
  goal: Object.freeze({ guard: true, circuit: true, reconcile: false, investigate: false, delta: "critical", persistence: true, goal: true, query: true, exposure: "silent" }),
  custom: null, // resolved from explicit capability overrides
});

export const PRESET_NAMES = ["off", "minimal", "balanced", "strict", "goal", "custom"];

export function resolvePreset(preset, capabilities) {
  const base = PRESETS[preset] ?? PRESETS.minimal;
  return { ...base, ...(capabilities ?? {}) };
}

// ---- activity record ("Why did Runtime intervene?") ----
export function activityRecord(kind, data) {
  return { t: new Date().toISOString(), kind, ...data };
}
