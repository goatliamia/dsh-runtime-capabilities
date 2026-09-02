// verify-continuation.mjs — post-run trajectory verification for the docs/19
// Runtime Continuation cells. Reads the PERSISTED session log through the
// independent decode path (zstd frame split + official decodeStorageRecord),
// then verifies:
//   V1 loop-contract replication: the continuation's tool/call and
//      tool/result records match the dsh-agent-loop append contract
//      (turn/step/callId/name/arguments string; result message shape;
//      surfaceOp:"append"; sourceEventSeqs:[callSeq]).
//   V2 provenance: runtime/continuation record fields
//      (contract/action/authority/outcome/basedOn/revision/callSeq/resultSeq).
//   V3 official-replay compatibility: whether the persisted log would be
//      REFUSED by the persistence read path (KNOWN_SESSION_EVENT_TYPES +
//      ignorable predicate, dsh-session-persistence: assertEventsSupported) —
//      the runtime/continuation custom kind is expected to fail this on the
//      pinned version; this documents the route-B seam gap.
//   V4 confounded-sample gate (docs/bugs/005): any compaction/start or
//      compaction/summary record marks the cell harness-invalid for
//      conclusions.
// Usage: node verify-continuation.mjs <resultsDir> <home> <runId>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { effectiveSessionId } from "./recovered-session-ids.mjs";

const resultsDir = process.argv[2];
const home = process.argv[3];
const runId = process.argv[4];

const metrics = JSON.parse(readFileSync(join(resultsDir, `${runId}.metrics.json`), "utf8"));
const sessionId = effectiveSessionId(runId, metrics.sessionId);

function projectKey(cwd) {
  let readable = "";
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === "/" || ch === "\\" || ch === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += "~" + code.toString(16).toUpperCase().padStart(4, "0");
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}

function encodeSegment(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
    else out += "~" + code.toString(16).toUpperCase().padStart(4, "0");
  }
  return out;
}

const logPath = join(home, "sessions", projectKey(resultsDir), encodeSegment(sessionId), "session.jsonl.zstd");
if (!existsSync(logPath)) {
  console.error(`session log not found: ${logPath}`);
  process.exit(2);
}

const buf = readFileSync(logPath);
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const starts = [];
let idx = buf.indexOf(MAGIC);
while (idx !== -1) {
  starts.push(idx);
  idx = buf.indexOf(MAGIC, idx + 4);
}
let text = "";
for (let i = 0; i < starts.length; i++) {
  const start = starts[i];
  const end = i + 1 < starts.length ? starts[i + 1] : buf.length;
  text += zstdDecompressSync(buf.subarray(start, end), { maxOutputLength: 256 * 1024 * 1024 }).toString("utf8");
}

// Resolve the pinned DSH install at RUNTIME from the environment, so
// concurrent sanitize passes over this repo cannot break the path again.
const dshInstallRoot = process.env.DSH_INSTALL_PATH ?? `${process.env.APPDATA ?? ""}/npm/node_modules/@deepseek-ai/dsh`;
const { decodeStorageRecord, KNOWN_SESSION_EVENT_TYPES } = await import(
  pathToFileURL(`${dshInstallRoot}/node_modules/@deepseek-ai/dsh-session/lib/index.js`).href
);

const events = [];
for (const line of text.split("\n")) {
  if (line.trim() === "") continue;
  const row = JSON.parse(line);
  if (row.type === "session") continue;
  events.push(...decodeStorageRecord(row));
}

const out = {
  run: runId,
  sessionId,
  eventsDecoded: events.length,
  checks: [],
  verdicts: {},
  notes: [],
};

function check(id, ok, detail) {
  out.checks.push({ id, ok, detail: detail ?? null });
}

// ---- V4: confounded-sample gate (docs/bugs/005) ----
const compactionEvents = events.filter((e) => ["compaction/start", "compaction/end", "compaction/summary", "compaction/prune"].includes(e.type));
out.verdicts.confoundedByCompaction = compactionEvents.length > 0;
if (compactionEvents.length > 0) {
  out.notes.push(`compaction records present (${compactionEvents.length}); cell is harness-invalid per docs/bugs/005`);
}

// ---- locate continuation records ----
const continuationEvents = events.filter((e) => e.type === "runtime/continuation");
const contToolCalls = [];
const callById = new Map();
for (const event of events) {
  if (event.type === "tool/call" && event.data?.callId !== undefined) {
    callById.set(String(event.data.callId), event);
    if (String(event.data.callId).startsWith("cont_")) contToolCalls.push(event);
  }
}
const staleToolCalls = [];
for (const [callId, event] of callById) {
  if (callId.startsWith("stale_")) staleToolCalls.push(event);
}

out.verdicts.continuationRecords = continuationEvents.length;
out.verdicts.continuationToolCalls = contToolCalls.length;
out.verdicts.staleActorToolCalls = staleToolCalls.length;

// ---- V2: provenance fields ----
for (const event of continuationEvents) {
  const d = event.data ?? {};
  check(
    `provenance-fields-seq${event.seq}`,
    d.kind === "runtime/continuation" &&
      typeof d.contract === "string" &&
      d.action === "reload" &&
      d.authority === "runtime-observation" &&
      typeof d.outcome === "string" &&
      d.basedOn !== undefined &&
      Number.isSafeInteger(d.basedOn.artifactSeq) &&
      Number.isSafeInteger(d.basedOn.runtimeSeq) &&
      (d.outcome === "discarded"
        ? d.reason === "stale-cas" && d.observed !== undefined
        : Number.isSafeInteger(d.callSeq) && Number.isSafeInteger(d.resultSeq) && (d.outcome === "dispatched" ? d.revision !== undefined : true)),
    { outcome: d.outcome, basedOn: d.basedOn, revision: d.revision ?? null },
  );
}

// ---- V1: loop-contract replication ----
for (const call of contToolCalls) {
  const callId = String(call.data.callId);
  const resultEvent = events.find((e) => e.type === "tool/result" && (e.data?.callId ?? e.data?.message?.source?.callId) === callId);
  const pairEvent = events.find(
    (e) =>
      e.type === "assistant/message" &&
      (e.data?.message?.content ?? []).some((b) => b?.type === "tool-call" && b?.id === callId),
  );
  const contract = {
    call: {
      turn: call.data.turn,
      step: call.data.step,
      callId: call.data.callId,
      name: call.data.name,
      argumentsIsString: typeof call.data.arguments === "string",
      arguments: call.data.arguments,
    },
    pair: pairEvent
      ? {
          seq: pairEvent.seq,
          turn: pairEvent.data.turn,
          step: pairEvent.data.step,
          sourceKind: pairEvent.data.message?.source?.kind ?? null,
          blockId: pairEvent.data.message?.content?.[0]?.id ?? null,
          blockType: pairEvent.data.message?.content?.[0]?.type ?? null,
          blockName: pairEvent.data.message?.content?.[0]?.name ?? null,
          surfaceOp: pairEvent.surfaceOp ?? null,
        }
      : null,
    result: resultEvent
      ? {
          seq: resultEvent.seq,
          turn: resultEvent.data.turn,
          step: resultEvent.data.step,
          sourceKind: resultEvent.data.message?.source?.kind ?? null,
          sourceCallId: resultEvent.data.message?.source?.callId ?? null,
          contentBlockType: resultEvent.data.message?.content?.[0]?.type ?? null,
          toolCallId: resultEvent.data.message?.content?.[0]?.toolCallId ?? null,
          isError: resultEvent.data.message?.content?.[0]?.isError ?? null,
          surfaceOp: resultEvent.surfaceOp ?? null,
          sourceEventSeqs: resultEvent.sourceEventSeqs ?? null,
        }
      : null,
  };
  let argumentsOk = false;
  try {
    const parsed = JSON.parse(call.data.arguments);
    argumentsOk = parsed.command !== undefined && parsed.description !== undefined;
  } catch {
    /* not JSON */
  }
  const pairOk =
    pairEvent !== undefined &&
    pairEvent.data.turn === call.data.turn &&
    pairEvent.data.step === call.data.step &&
    pairEvent.data.message?.source?.kind === "runtime-continuation" &&
    pairEvent.data.message?.content?.[0]?.type === "tool-call" &&
    pairEvent.data.message?.content?.[0]?.id === callId &&
    pairEvent.data.message?.content?.[0]?.name === call.data.name &&
    pairEvent.surfaceOp === "append" &&
    pairEvent.seq < call.seq;
  const resultOk =
    resultEvent !== undefined &&
    resultEvent.data.turn === call.data.turn &&
    resultEvent.data.step === call.data.step &&
    resultEvent.data.message?.source?.kind === "tool" &&
    resultEvent.data.message?.source?.callId === callId &&
    resultEvent.data.message?.content?.[0]?.type === "tool-result" &&
    resultEvent.data.message?.content?.[0]?.toolCallId === callId &&
    typeof resultEvent.data.message?.content?.[0]?.isError === "boolean" &&
    resultEvent.surfaceOp === "append" &&
    Array.isArray(resultEvent.sourceEventSeqs) &&
    resultEvent.sourceEventSeqs.length === 1 &&
    resultEvent.sourceEventSeqs[0] === call.seq &&
    call.seq < resultEvent.seq;
  check(
    `loop-contract-${callId}`,
    contract.call.turn !== undefined &&
      contract.call.step !== undefined &&
      contract.call.name === "pwsh" &&
      contract.call.argumentsIsString &&
      argumentsOk &&
      pairOk &&
      resultOk,
    contract,
  );
}

// stale actor records must follow the same contract (C arm)
for (const call of staleToolCalls) {
  const callId = String(call.data.callId);
  const resultEvent = events.find((e) => e.type === "tool/result" && (e.data?.callId ?? e.data?.message?.source?.callId) === callId);
  const pairEvent = events.find(
    (e) =>
      e.type === "assistant/message" &&
      (e.data?.message?.content ?? []).some((b) => b?.type === "tool-call" && b?.id === callId),
  );
  const ok =
    resultEvent !== undefined &&
    resultEvent.data.turn === call.data.turn &&
    resultEvent.data.step === call.data.step &&
    resultEvent.surfaceOp === "append" &&
    Array.isArray(resultEvent.sourceEventSeqs) &&
    resultEvent.sourceEventSeqs[0] === call.seq &&
    call.seq < resultEvent.seq &&
    pairEvent !== undefined &&
    pairEvent.data.message?.source?.kind === "stale-actor" &&
    pairEvent.data.message?.content?.[0]?.type === "tool-call" &&
    pairEvent.data.message?.content?.[0]?.id === callId &&
    pairEvent.surfaceOp === "append" &&
    pairEvent.seq < call.seq;
  check(`stale-actor-contract-${callId}`, ok, { pairSeq: pairEvent?.seq ?? null, callSeq: call.seq, resultSeq: resultEvent?.seq ?? null });
}

// ---- V3: official-replay compatibility (documented finding) ----
const unknownTypes = [];
for (const event of events) {
  if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable !== true) {
    if (!unknownTypes.some((u) => u.type === event.type)) unknownTypes.push({ type: event.type, firstSeq: event.seq });
  }
}
out.verdicts.officialReplayCompatible = unknownTypes.length === 0;
if (unknownTypes.length > 0) {
  out.notes.push(
    `persistence read path would REFUSE this log (assertEventsSupported): unknown non-ignorable type(s) ${unknownTypes
      .map((u) => `${u.type}@${u.firstSeq}`)
      .join(", ")} — expected for the runtime/continuation custom kind on the pinned version; feeds the route-B seam proposal`,
  );
}

// ---- C-arm discard semantics: discarded intents must have no reload pair ----
const dispatched = continuationEvents.filter((e) => e.data?.outcome === "dispatched");
const discarded = continuationEvents.filter((e) => e.data?.outcome === "discarded");
out.verdicts.dispatched = dispatched.length;
out.verdicts.discarded = discarded.length;

const outPath = join(resultsDir, `${runId}.verify-continuation.json`);
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
const failed = out.checks.filter((c) => !c.ok).length;
process.exitCode = failed > 0 || out.verdicts.confoundedByCompaction ? 1 : 0;
