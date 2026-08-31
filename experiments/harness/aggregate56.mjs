/**
 * E5 (H1 provenance) + E6 (cross-session pickup) aggregation.
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

function readResultFile(runId) {
  const path = join(RESULTS, `${runId}.result.txt`);
  if (!existsSync(path)) return "(missing)";
  try {
    return readFileSync(path, "utf8").trim().replace(/\s+/g, " ").slice(0, 140);
  } catch {
    return "(unreadable)";
  }
}

function avg(list) {
  const values = list.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
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

function armTable(md, armOrder, armLabel, rows, keys, worldCorrect = false) {
  const byArm = {};
  for (const row of rows) (byArm[row.arm] ??= []).push(row);
  md.push("| 指标 | " + armOrder.map((arm) => armLabel[arm]).join(" | ") + " |", `|---|---${"|---".repeat(armOrder.length)}|`);
  for (const [key, label] of keys) {
    const cells = armOrder.map((arm) => {
      const value = avg((byArm[arm] ?? []).map((row) => row.metrics[key]));
      return value === null ? "-" : String(value);
    });
    md.push(`| ${label} | ${cells.join(" | ")} |`);
  }
  md.push("", "| run | 结果文件 |", "|---|---|");
  for (const row of rows.sort((l, r) => armOrder.indexOf(l.arm) - armOrder.indexOf(r.arm) || l.repeat.localeCompare(r.repeat))) {
    md.push(`| ${row.runId} | ${row.resultFile} |`);
  }
  md.push("");
  return byArm;
}

function main() {
  const md = [];
  md.push("# E5 (H1) + E6 (Pickup) 结果", "");
  md.push(`生成时间：${new Date().toISOString()}`, "");

  // ---- E5 ----
  md.push("## E5：H1（provenance 是否减少拒绝后的复核）", "");
  const e5 = collect(/^e5-(gplain|gauth)-(r[123])\.metrics\.json$/, 1, 2);
  if (e5.length) {
    const byArm = armTable(md, ["gplain", "gauth"], { gplain: "guard-plain", gauth: "guard-authority" }, e5, [
      ["rejectionsToLearn", "拒绝数均值"],
      ["reVerificationAfterRejection", "拒绝后复核探测均值"],
      ["probeCalls", "总探测均值"],
      ["steps", "steps 均值"],
      ["payloadChars", "payload 字符均值"],
    ]);
    const plain = avg((byArm.gplain ?? []).map((row) => row.metrics.reVerificationAfterRejection));
    const auth = avg((byArm.gauth ?? []).map((row) => row.metrics.reVerificationAfterRejection));
    const plainRej = avg((byArm.gplain ?? []).map((row) => row.metrics.rejectionsToLearn));
    const authRej = avg((byArm.gauth ?? []).map((row) => row.metrics.rejectionsToLearn));
    md.push(`**H1 判定**：plain 复核=${plain}（拒绝 ${plainRej} 次），authority 复核=${auth}（拒绝 ${authRej} 次）。`);
    if (plainRej !== null && plainRej > 0) {
      md.push(auth < plain ? "→ authority 臂拒绝后复核更少，H1 获得方向性支持（小样本）。" : "→ authority 臂未减少复核，H1 在本条件下未获支持。", "");
    } else {
      md.push("→ 拒绝未发生（模型先探测后放弃了调用），H1 本轮无法判定。", "");
    }
  } else {
    md.push("（无数据）", "");
  }

  // ---- E6 ----
  md.push("## E6：跨会话拾取（三臂水位语义）", "");
  const e6 = collect(/^e6-(baseline|none|pickup)-(r[123])\.metrics\.json$/, 1, 2);
  if (e6.length) {
    armTable(md, ["baseline", "none", "pickup"], { baseline: "baseline (no persist)", none: "persist + silent (L2)", pickup: "persist + inject (ceiling)" }, e6, [
      ["probeCalls", "探测数均值"],
      ["steps", "steps 均值"],
      ["modelCalls", "模型调用数均值"],
      ["payloadChars", "payload 字符均值"],
      ["injectedMessages", "注入消息均值"],
      ["runtimeFailures", "runtime 失败"],
    ]);
    md.push("判定：none（L2 沉默）与 pickup（注入）的成本对比回答『水位是否该默认归零』；baseline 是重发现基线。", "");
  } else {
    md.push("（无数据）", "");
  }

  writeFileSync(join(RESULTS, "summary56.json"), JSON.stringify({ generatedAt: new Date().toISOString(), e5, e6 }, null, 2));
  writeFileSync(join(RESULTS, "summary56.md"), md.join("\n"));
  console.log(md.join("\n"));
}

main();
