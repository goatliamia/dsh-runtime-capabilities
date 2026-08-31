/**
 * v4pro verification aggregation: compares v4-pro runs against the flash
 * baselines for the model-dependent (soft) layer only.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const RESULTS = "<HOME>/Documents/runtime-exp/results";

function readMetrics(runId) {
  const path = join(RESULTS, `${runId}.metrics.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function avg(list) {
  const values = list.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function readResultFile(runId) {
  const path = join(RESULTS, `${runId}.result.txt`);
  if (!existsSync(path)) return "(missing)";
  try {
    return readFileSync(path, "utf8").trim().replace(/\s+/g, " ").slice(0, 100);
  } catch {
    return "(unreadable)";
  }
}

function collect(pattern, armKey, repeatKey) {
  const rows = [];
  for (const file of readdirSync(RESULTS)) {
    const match = pattern.exec(file);
    if (!match) continue;
    const arm = match[armKey];
    const repeat = match[repeatKey];
    const runId = file.replace(/\.metrics\.json$/, "");
    const metrics = readMetrics(runId);
    if (!metrics) continue;
    rows.push({ runId, arm, repeat, metrics, resultFile: readResultFile(runId) });
  }
  return rows;
}

function pairCompare(md, title, flashRows, v4Rows, armOrder, armLabel, keys, note = "") {
  md.push(`## ${title}`, "");
  const fBy = {};
  const vBy = {};
  for (const row of flashRows) (fBy[row.arm] ??= []).push(row);
  for (const row of v4Rows) (vBy[row.arm] ??= []).push(row);
  md.push(`| 指标 | ${armOrder.map((arm) => `${armLabel[arm]} (flash)`).join(" | ")} | ${armOrder.map((arm) => `${armLabel[arm]} (v4pro)`).join(" | ")} |`);
  md.push(`|---${"|---".repeat(armOrder.length * 2)}|`);
  for (const [key, label] of keys) {
    const cells = [
      ...armOrder.map((arm) => {
        const value = avg((fBy[arm] ?? []).map((row) => row.metrics[key]));
        return value === null ? "-" : String(value);
      }),
      ...armOrder.map((arm) => {
        const value = avg((vBy[arm] ?? []).map((row) => row.metrics[key]));
        return value === null ? "-" : String(value);
      }),
    ];
    md.push(`| ${label} | ${cells.join(" | ")} |`);
  }
  if (note) md.push("", note, "");
  return { fBy, vBy };
}

function main() {
  const md = [];
  md.push("# v4-pro 复测：模型依赖层（soft layer）对比", "");
  md.push(`生成时间：${new Date().toISOString()}`, "");
  md.push("flash 基线来自首轮（N=2-3），v4pro 为 N=2。只比较模型依赖的量（幅度与复核行为），机制层结论不在此列。", "");

  // E2 promise
  pairCompare(
    md,
    "E2：承诺兑现（gauth vs gauthdelta）",
    collect(/^e2-(gauth|gauthdelta)-r[123]\.metrics\.json$/, 1, 2),
    collect(/^e2-(gauth|gauthdelta)-v[12]\.metrics\.json$/, 1, 2),
    ["gauth", "gauthdelta"],
    { gauth: "guard-authority", gauthdelta: "+promised-delta" },
    [
      ["reVerificationAfterRejection", "拒绝后复核探测"],
      ["probeCalls", "总探测"],
      ["steps", "steps"],
      ["payloadChars", "payload 字符"],
    ],
  );

  // E4b circuit
  pairCompare(
    md,
    "E4b：循环熔断（none vs circuitdelta）",
    collect(/^e4-(none|circuitdelta)-r[456]\.metrics\.json$/, 1, 2),
    collect(/^e4-(none|circuitdelta)-v[12]\.metrics\.json$/, 1, 2),
    ["none", "circuitdelta"],
    { none: "无熔断", circuitdelta: "熔断+delta" },
    [
      ["flakyAttempts", "失败尝试"],
      ["steps", "steps"],
      ["payloadChars", "payload 字符"],
    ],
    "注意：v4pro 的 none 臂烧多少，直接量化了更强模型的循环成本上限。",
  );

  // E7 creative framing
  const e7 = collect(/^e7-(none|circuitdelta)-v[12]\.metrics\.json$/, 1, 2);
  if (e7.length) {
    const byArm = {};
    for (const row of e7) (byArm[row.arm] ??= []).push(row);
    md.push("## E7：创造性框架下的熔断（v4pro only，新场景）", "");
    md.push("| 指标 | none (无熔断) | circuitdelta (熔断+delta) |", "|---|---|---|");
    for (const [key, label] of [
      ["flakyAttempts", "exp_flaky 尝试"],
      ["flakyCallsAfterCircuitOpen", "开断后尝试"],
      ["steps", "steps"],
      ["payloadChars", "payload 字符"],
    ]) {
      md.push(`| ${label} | ${avg((byArm.none ?? []).map((row) => row.metrics[key])) ?? "-"} | ${avg((byArm.circuitdelta ?? []).map((row) => row.metrics[key])) ?? "-"} |`);
    }
    md.push("", "| run | 结果文件 |", "|---|---|");
    for (const row of e7) md.push(`| ${row.runId} | ${row.resultFile} |`);
    md.push("");
  }

  // E5 H1
  pairCompare(
    md,
    "E5：H1（gplain vs gauth 拒绝后复核）",
    collect(/^e5-(gplain|gauth)-r[123]\.metrics\.json$/, 1, 2),
    collect(/^e5-(gplain|gauth)-v[12]\.metrics\.json$/, 1, 2),
    ["gplain", "gauth"],
    { gplain: "guard-plain", gauth: "guard-authority" },
    [
      ["reVerificationAfterRejection", "拒绝后复核探测"],
      ["probeCalls", "总探测"],
      ["steps", "steps"],
      ["payloadChars", "payload 字符"],
    ],
    "flash 上 H1 方向性反转；v4pro 是否翻转是本题。",
  );

  // E6 pickup
  pairCompare(
    md,
    "E6：跨会话拾取（baseline vs pickup）",
    collect(/^e6-(baseline|pickup)-r[123]\.metrics\.json$/, 1, 2),
    collect(/^e6-(baseline|pickup)-v4v[12]\.metrics\.json$/, 1, 2),
    ["baseline", "pickup"],
    { baseline: "重发现基线", pickup: "持久化+注入" },
    [
      ["probeCalls", "探测"],
      ["steps", "steps"],
      ["payloadChars", "payload 字符"],
    ],
  );

  writeFileSync(join(RESULTS, "summary7.md"), md.join("\n"));
  console.log(md.join("\n"));
}

main();
