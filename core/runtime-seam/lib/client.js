// dsh-runtime-seam client half (self-registering bundle).
// 三个入口（全部主题 token 化、文案中文化）：
//   - conversation.input.left：Runtime 控制（模式速览 + 介入原因弹层）
//   - conversation.input.dock：Runtime Goal 条（仿官方目标条：常驻可见、可增删）
//   - settings.section：Runtime 设置页（场景预设 + 模式选择 + 分组能力勾选 + 目标 + 介入日志 + 本次会话摘要）
// 设计依据：docs/18-runtime-frontend-design.md（2026-09-02）
window.__ModuleLoader__.load({
  id: "dsh-runtime-seam",
  factory: (require) => {
    const React = require("react");
    const { useEffect, useState } = React;
    const el = React.createElement;

    const MODES = ["off", "minimal", "balanced", "strict", "custom"];
    const MODE_LABEL = { off: "Off", minimal: "Minimal", balanced: "Balanced", strict: "Strict", custom: "Custom" };
    // Scene presets are shortcuts over modes (docs/18 §3 layer 0).
    const SCENES = [
      { key: "creative", label: "Creative", desc: "少打扰，明确问题才介入", preset: "minimal" },
      { key: "coding", label: "Coding", desc: "重视验证与重复失败", preset: "balanced" },
      { key: "external", label: "External Actions", desc: "重视副作用与超时确认", preset: "balanced" },
      { key: "safe", label: "Safe", desc: "宁愿多验证，不轻易当完成", preset: "strict" },
    ];
    // Grouped capability toggles (docs/18 §3 layer 2). Progress detection is
    // the always-on fact layer, not a policy toggle.
    const CAPABILITY_GROUPS = [
      { title: "Execution（执行前 / 执行中）", items: [
        { key: "guard", label: "Guard（已知非法的动作）" },
        { key: "circuit", label: "Circuit（连续无进展熔断）" },
        { key: "reconcile", label: "Reconcile（副作用可能已发生时不盲目重试）" },
      ]},
      { title: "Effect（执行后）", items: [
        { key: "progress", label: "Progress detection（事件投影）", factLayer: true },
        { key: "investigate", label: "Success verification（成功但未生效 → 验证修复）" },
      ]},
      { title: "Context（告诉模型什么）", items: [
        { key: "delta", label: "Critical delta（只通知承诺过的变更）" },
        { key: "exposure", label: "Runtime snapshot（全量上下文，实验未显示优势）" },
      ]},
      { title: "基础（既有能力，保留）", items: [
        { key: "persistence", label: "Persistence（事实跨会话持久化）" },
        { key: "query", label: "Query（权威应答）" },
        { key: "goal", label: "Goal（目标跟踪）" },
      ]},
    ];

    const font = { fontFamily: "inherit", fontSize: "12px", color: "var(--dsw-alias-label-primary)" };
    const row = { display: "flex", gap: "8px", alignItems: "center" };
    const button = {
      ...font,
      padding: "3px 10px",
      borderRadius: "7px",
      border: "1px solid var(--dsw-alias-border-l1)",
      background: "transparent",
      cursor: "pointer",
      fontWeight: 400,
      outline: "none",
    };
    const activeButton = {
      ...button,
      fontWeight: 700,
    };
    const popover = {
      ...font,
      position: "absolute",
      bottom: "110%",
      left: 0,
      width: 330,
      maxHeight: 380,
      overflow: "auto",
      padding: "10px 12px",
      borderRadius: "10px",
      border: "1px solid var(--dsw-alias-border-l1)",
      background: "var(--dsw-alias-bg-overlay)",
      boxShadow: "0 8px 24px rgba(0,0,0,.35)",
      zIndex: 60,
    };
    const mono = { fontFamily: "ui-monospace, monospace", fontSize: "11px" };
    const sectionTitle = { fontWeight: 600, marginBottom: 4, color: "var(--dsw-alias-label-primary)" };
    const secondary = { color: "var(--dsw-alias-label-secondary)" };
    const summaryCard = {
      ...font,
      padding: "8px 10px",
      borderRadius: "8px",
      border: "1px solid var(--dsw-alias-border-l1)",
      background: "var(--dsw-alias-bg-layer-1)",
      marginBottom: 10,
    };

    function useActivity() {
      const [state, setState] = useState({ loading: true, data: null });
      const reload = () => {
        fetch("/api/runtime-seam/activity")
          .then((res) => res.json())
          .then((body) => {
            if (body && body.ok) setState({ loading: false, data: body.data });
          })
          .catch(() => {});
      };
      useEffect(() => {
        reload();
        const timer = setInterval(reload, 5000);
        return () => clearInterval(timer);
      }, []);
      return { ...state, reload };
    }

    function postJson(path, payload) {
      return fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    // ---- "这次帮你做了什么" (docs/18 §3 layer 3) ----
    function summaryOf(entries) {
      const counts = { circuit: 0, guard: 0, delta: 0 };
      for (const entry of entries ?? []) {
        if (counts[entry.kind] !== undefined) counts[entry.kind] += 1;
      }
      const parts = [];
      if (counts.circuit > 0) parts.push(`stopped ${counts.circuit} no-progress retry loop(s)`);
      if (counts.guard > 0) parts.push(`blocked ${counts.guard} invalid action(s)`);
      if (counts.delta > 0) parts.push(`notified ${counts.delta} committed change(s)`);
      return parts.length > 0 ? `这次帮你做了什么：${parts.join(" · ")}` : "这次帮你做了什么：0 interventions — 默认沉默。";
    }

    function ActivityLine(entry) {
      const time = new Date(entry.t).toLocaleTimeString();
      const kind = entry.kind;
      const name =
        kind === "guard" ? "Guard" :
        kind === "circuit" ? "Circuit" :
        kind === "delta" ? "Delta" :
        kind === "reconcile" ? "Reconcile" :
        kind === "investigate" ? "Investigate" :
        kind === "goal" ? "目标" :
        kind === "goal-removed" ? "目标移除" :
        kind === "change" ? "Change" : kind;
      let body = null;
      if (kind === "guard") body = el("div", { style: mono }, entry.action + " · rev " + entry.revision);
      else if (kind === "circuit") body = el("div", { style: mono }, entry.tool + " 重复 " + entry.repeated + " 次 → " + entry.result);
      else if (kind === "delta") body = el("div", { style: mono }, entry.type + " " + (entry.path ?? ""));
      else if (kind === "goal") body = el("div", { style: mono }, entry.factPath + " → " + String(entry.desired) + "（" + (entry.state === "satisfied" ? "已满足" : "等待中") + "）");
      else if (kind === "change") body = el("div", { style: mono }, entry.path + " → rev " + entry.revision);
      return el("div", { key: entry.t + kind + Math.random(), style: { marginBottom: 6 } },
        el("div", { style: row }, el("strong", null, name), el("span", { style: secondary }, time)), body);
    }

    function ActivityList({ entries, empty }) {
      if (!entries || !entries.length) return el("div", { style: secondary }, empty ?? "暂无干预记录——默认沉默。");
      return el("div", null, entries.slice(0, 20).map(ActivityLine));
    }

    // ---- 输入行左侧 Runtime 控制 ----
    function RuntimeButton() {
      const { data } = useActivity();
      const [open, setOpen] = useState(false);
      const preset = data?.preset ?? "…";
      return el("div", { style: { position: "relative" } },
        el("button", { style: button, title: "Runtime", onClick: () => setOpen((v) => !v) },
          "Runtime · " + (MODE_LABEL[preset] ?? preset)),
        open ? el("div", { style: popover },
          el("div", { style: summaryCard }, summaryOf(data?.activity)),
          el("div", { style: sectionTitle }, "为什么 Runtime 介入？"),
          el(ActivityList, { entries: data?.activity })) : null);
    }

    // ---- 设置页 ----
    function CapabilityToggle({ caps, reload }) {
      const toggle = (key, current) => {
        const next = { ...caps };
        if (key === "delta") next.delta = current === "critical" ? "none" : "critical";
        else if (key === "exposure") next.exposure = current === "silent" ? "snapshot" : "silent";
        else next[key] = !current;
        postJson("/api/runtime-seam/config", { preset: "custom", capabilities: next }).then(reload);
      };
      const enabledOf = (key) => {
        if (key === "delta") return caps.delta === "critical";
        if (key === "exposure") return caps.exposure !== "silent";
        return Boolean(caps[key]);
      };
      return el("div", { style: { marginBottom: 10 } },
        el("div", { style: sectionTitle }, "自定义能力（勾选即生效，可增可减）"),
        CAPABILITY_GROUPS.map((group) => el("div", { key: group.title, style: { marginBottom: 8 } },
          el("div", { style: { ...secondary, marginBottom: 2 } }, group.title),
          group.items.map(({ key, label, factLayer }) => {
            if (factLayer) {
              return el("div", { key, style: { ...row, display: "flex", padding: "3px 0" } },
                el("span", { style: { color: "var(--dsw-alias-state-success-primary)" } }, "✓"),
                el("span", null, label),
                el("span", { style: secondary }, "（事实层，常开，不消耗模型）"));
            }
            const enabled = enabledOf(key);
            return el("label", { key, style: { ...row, display: "flex", padding: "3px 0", cursor: "pointer" } },
              el("input", {
                type: "checkbox",
                checked: enabled,
                onChange: () => toggle(key, enabled),
                style: { accentColor: "var(--dsw-alias-brand-primary)" },
              }),
              el("span", null, label));
          }))));
    }

    function CapabilitySummary({ caps }) {
      return el("div", { style: { marginBottom: 14 } },
        CAPABILITY_GROUPS.map((group) => {
          const items = group.items.map(({ key, label, factLayer }) => {
            if (factLayer) {
              return el("div", { key, style: { ...row, justifyContent: "space-between", padding: "3px 0" } },
                el("span", null, label),
                el("span", { style: { color: "var(--dsw-alias-state-success-primary)" } }, "✓ 常开"));
            }
            const enabled = key === "delta" ? caps.delta === "critical" : key === "exposure" ? caps.exposure !== "silent" : Boolean(caps[key]);
            return el("div", { key, style: { ...row, justifyContent: "space-between", padding: "3px 0" } },
              el("span", null, label),
              el("span", { style: enabled ? { color: "var(--dsw-alias-state-success-primary)" } : secondary }, enabled ? "✓" : "—"));
          });
          return el("div", { key: group.title, style: { marginBottom: 6 } },
            el("div", { style: { ...secondary, marginBottom: 2 } }, group.title),
            items);
        }));
    }

    function GoalSection({ goals }) {
      return el("div", { style: { marginBottom: 10 } },
        el("div", { style: sectionTitle }, "Runtime 目标"),
        goals && goals.length
          ? el("div", null, goals.map((goal) => el("div", { key: goal.factPath, style: { ...mono, marginBottom: 4 } },
              goal.factPath + " → " + String(goal.desired) + "  " +
              el("span", { style: { color: goal.state === "satisfied" ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-warn-primary)" } },
                goal.state === "satisfied" ? "✓ 已满足" : "… 等待中"))))
          : el("div", { style: secondary }, "未声明目标。可在 + 菜单选择 Runtime Goal，或输入 /runtime-goal 声明。"));
    }

    function RuntimeSettingsPage() {
      const { data, reload } = useActivity();
      const preset = data?.preset ?? "minimal";
      const caps = data?.capabilities ?? {};
      const sceneActive = (scene) => scene.preset === preset;
      return el("div", { style: { ...font, fontSize: "13px", maxWidth: 560 } },
        el("h3", null, "Runtime"),
        el("p", { style: secondary },
          "选择你的 Agent 拥有的确定性能力。Runtime 不是第二个 Agent：默认沉默，只在必须时介入。"),
        el("div", { style: { marginBottom: 4 } },
          el("div", { style: sectionTitle }, "场景预设（选一个即可，其余交给默认）"),
          el("div", { style: { ...row, flexWrap: "wrap", marginBottom: 12 } },
            SCENES.map((scene) => el("button", {
              key: scene.key,
              style: sceneActive(scene) ? activeButton : button,
              title: scene.desc,
              onClick: () => postJson("/api/runtime-seam/config", { preset: scene.preset }).then(reload),
            }, scene.label)))),
        el("div", { style: { marginBottom: 4 } },
          el("div", { style: sectionTitle }, "模式"),
          el("div", { style: { ...row, flexWrap: "wrap", marginBottom: 14 } },
            MODES.map((key) => el("button", {
              key,
              style: preset === key ? activeButton : button,
              onClick: () => postJson("/api/runtime-seam/config", { preset: key }).then(reload),
            }, MODE_LABEL[key])))),
        preset === "custom"
          ? el(CapabilityToggle, { caps, reload })
          : el(CapabilitySummary, { caps }),
        el(GoalSection, { goals: data?.goals }),
        el("div", { style: { marginBottom: 10 } },
          el("div", { style: sectionTitle }, "Runtime 介入记录"),
          el("div", { style: summaryCard }, summaryOf(data?.activity)),
          el(ActivityList, { entries: data?.activity })),
        el("div", { style: secondary },
          "Exposure 默认静默：Runtime 只在承诺过的变更或 circuit 开断时进入模型上下文。Custom 也可直接手写 settings.yaml，见 docs/custom-config.md。"));
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        // 槽位内容必须是组件函数（壳层注入 props；传元素会 React #130）。
        ctx.slots.inject("conversation.input.left", () =>
          ctx.slots.register(
            { name: "conversation.input.left", id: "dsh-runtime-seam-trigger", order: 0, label: "Runtime", registrant: "dsh-runtime-seam" },
            RuntimeButton,
          ));
        ctx.slots.inject("settings.section", () =>
          ctx.slots.register(
            { name: "settings.section", id: "dsh-runtime-seam-settings", order: 0, label: "Runtime", registrant: "dsh-runtime-seam" },
            RuntimeSettingsPage,
          ));
      },
    };
  },
});
