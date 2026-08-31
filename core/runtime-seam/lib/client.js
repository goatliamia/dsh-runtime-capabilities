// dsh-runtime-seam client half (self-registering bundle).
// 三个入口（全部主题 token 化、文案中文化）：
//   - conversation.input.left：Runtime 控制（模式速览 + 介入原因弹层）
//   - conversation.input.dock：Runtime Goal 条（仿官方目标条：常驻可见、可增删）
//   - settings.section：Runtime 设置页（模式选择、Custom 能力勾选、目标、介入日志）
window.__ModuleLoader__.load({
  id: "dsh-runtime-seam",
  factory: (require) => {
    const React = require("react");
    const { useEffect, useState } = React;
    const el = React.createElement;

    const PRESETS = ["off", "minimal", "strict", "goal", "custom"];
    const PRESET_LABEL = { off: "Off", minimal: "Minimal", strict: "Strict", goal: "Goal", custom: "Custom" };
    const CAPABILITY_META = [
      { key: "guard", label: "Guard（已知非法的动作）" },
      { key: "circuit", label: "Circuit（重复失败无进展）" },
      { key: "delta", label: "Critical delta（承诺过的变更通知）" },
      { key: "persistence", label: "Persistence（事实跨会话持久化）" },
      { key: "query", label: "Query（权威应答）" },
      { key: "goal", label: "Goal / Reconcile" },
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
    const input = {
      ...font,
      width: "100%",
      boxSizing: "border-box",
      marginBottom: 6,
      padding: "4px 8px",
      borderRadius: "6px",
      border: "1px solid var(--dsw-alias-border-l1)",
      background: "var(--dsw-alias-bg-layer-1)",
    };
    const mono = { fontFamily: "ui-monospace, monospace", fontSize: "11px" };
    const sectionTitle = { fontWeight: 600, marginBottom: 4, color: "var(--dsw-alias-label-primary)" };
    const secondary = { color: "var(--dsw-alias-label-secondary)" };

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

    function ActivityLine(entry) {
      const time = new Date(entry.t).toLocaleTimeString();
      const kind = entry.kind;
      const name =
        kind === "guard" ? "Guard" :
        kind === "circuit" ? "Circuit" :
        kind === "delta" ? "Delta" :
        kind === "goal" ? "目标" :
        kind === "goal-removed" ? "目标移除" :
        kind === "change" ? "Change" : kind;
      let body = null;
      if (kind === "guard") body = el("div", { style: mono }, entry.action + " · rev " + entry.revision);
      else if (kind === "circuit") body = el("div", { style: mono }, entry.tool + " 重复 " + entry.repeated + " 次 → " + entry.result);
      else if (kind === "delta") body = el("div", { style: mono }, entry.kind + " " + (entry.path ?? ""));
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
          "Runtime · " + (PRESET_LABEL[preset] ?? preset)),
        open ? el("div", { style: popover },
          el("div", { style: sectionTitle }, "为什么 Runtime 介入？"),
          el(ActivityList, { entries: data?.activity })) : null);
    }

    // ---- 设置页 ----
    function CapabilityToggle({ caps, reload }) {
      const toggle = (key, current) => {
        const next = { ...caps };
        if (key === "delta") next.delta = current === "critical" ? "none" : "critical";
        else next[key] = !current;
        postJson("/api/runtime-seam/config", { preset: "custom", capabilities: next }).then(reload);
      };
      return el("div", { style: { marginBottom: 10 } },
        el("div", { style: sectionTitle }, "自定义能力（勾选即生效，可增可减）"),
        CAPABILITY_META.map(({ key, label }) => {
          const enabled = key === "delta" ? caps.delta === "critical" : Boolean(caps[key]);
          return el("label", { key, style: { ...row, display: "flex", padding: "3px 0", cursor: "pointer" } },
            el("input", {
              type: "checkbox",
              checked: enabled,
              onChange: () => toggle(key, enabled),
              style: { accentColor: "var(--dsw-alias-brand-primary)" },
            }),
            el("span", null, label));
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
      return el("div", { style: { ...font, fontSize: "13px", maxWidth: 560 } },
        el("h3", null, "Runtime"),
        el("p", { style: secondary },
          "选择你的 Agent 拥有的确定性能力。Runtime 不是第二个 Agent：默认沉默，只在必须时介入。"),
        el("div", { style: { ...row, flexWrap: "wrap", marginBottom: 14 } },
          PRESETS.map((key) => el("button", {
            key,
            style: preset === key ? activeButton : button,
            onClick: () => postJson("/api/runtime-seam/config", { preset: key }).then(reload),
          }, PRESET_LABEL[key]))),
        preset === "custom"
          ? el(CapabilityToggle, { caps, reload })
          : el("div", { style: { marginBottom: 14 } },
              CAPABILITY_META.map(({ key, label }) => {
                const enabled = key === "delta" ? caps.delta === "critical" : Boolean(caps[key]);
                return el("div", { key, style: { ...row, justifyContent: "space-between", padding: "3px 0" } },
                  el("span", null, label),
                  el("span", { style: enabled ? { color: "var(--dsw-alias-state-success-primary)" } : secondary }, enabled ? "✓" : "—"));
              })),
        el(GoalSection, { goals: data?.goals }),
        el("div", { style: { marginBottom: 10 } },
          el("div", { style: sectionTitle }, "Runtime 介入记录"),
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
