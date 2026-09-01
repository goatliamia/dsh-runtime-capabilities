/**
 * dsh-ctx-place - context-placement experiment (host-only).
 *
 * Places ONE authoritative fact through one of DSH's native context channels,
 * selected by the EXP_ARM environment variable:
 *
 *   baseline      - no fact anywhere (control)
 *   section       - systemPrompt.section(): ordered system-prompt section
 *                   (stable prefix, order 50 = after persona, before tool guidance)
 *   context       - systemPrompt.context(): runtime-context snapshot, a
 *                   durable user-role snapshot materialized per request
 *   prestep       - agent/pre-step injection appended to EVERY step's messages
 *                   (current-state semantics, repetition constant across arms)
 *   prestep-once  - same message, injected at step 1 only (event/delta semantics)
 *
 * Mechanism ground truth: for section/context arms the plugin assembles the
 * prompt itself at apply time and prints ARM-OK / ARM-FAIL to stderr (captured
 * in the run's stdout file). The durable transcript does NOT log assembled
 * system sections, so this self-check is the only reliable way to prove the
 * fact actually reached the model input.
 */

const FACT_TEXT =
  "RUNTIME FACT (authoritative, current): the build tag for this project is v3.0.0. " +
  "Use v3.0.0 wherever the build tag is required.";

function injectMessage(plugin) {
  return {
    id: `ctxp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    content: [{ type: "text", text: FACT_TEXT }],
    source: { kind: "plugin", plugin },
  };
}

export const name = "dsh-ctx-place";
export const inject = ["systemPrompt"];

export function apply(ctx) {
  const arm = String(process.env.EXP_ARM ?? "baseline").trim();
  const systemPrompt = ctx.systemPrompt;

  if (arm === "section") {
    ctx.effect(() =>
      systemPrompt.section({
        name: "ctx-place-fact",
        order: 50,
        text: FACT_TEXT,
      }),
    );
    systemPrompt.assemble().then((assembly) => {
      const joined = assembly.sections.map((s) => s.text).join("\n");
      console.error(
        joined.includes("v3.0.0")
          ? "ARM-OK: fact present in assembled sections"
          : "ARM-FAIL: fact missing from assembled sections",
      );
    });
  } else if (arm === "context") {
    ctx.effect(() =>
      systemPrompt.context({
        name: "ctx-place-fact",
        order: 0,
        text: FACT_TEXT,
      }),
    );
    systemPrompt.assemble().then((assembly) => {
      const joined = assembly.contexts.map((c) => c.text).join("\n");
      console.error(
        joined.includes("v3.0.0")
          ? "ARM-OK: fact present in assembled contexts"
          : "ARM-FAIL: fact missing from assembled contexts",
      );
    });
  } else if (arm === "prestep" || arm === "prestep-once") {
    let injected = false;
    ctx.on("agent/pre-step", async (_payload, next) => {
      const decision = await next();
      try {
        if (decision?.kind !== "enter") return decision;
        if (arm === "prestep-once" && injected) return decision;
        injected = true;
        return {
          kind: "enter",
          messages: [...decision.messages, injectMessage("dsh-ctx-place")],
        };
      } catch {
        return decision;
      }
    });
  }
  // baseline: nothing.
}
