// dsh-runtime-seam client half (self-registering bundle).
// Two entries, both additive:
//   - conversation.input.left: the small Runtime control beside the composer chrome
//     (the "+"-row seat) — preset readout + "Why did Runtime intervene?" popover.
//   - settings.section: the Runtime page — preset picker, active capabilities,
//     intervention log, facts.
// All data comes from the host's /api/runtime-seam routes.
window.__ModuleLoader__.load({
  id: "dsh-runtime-seam",
  factory: (require) => {
    const React = require("react");
    const { useEffect, useState } = React;
    const el = React.createElement;

    const PRESETS = ["off", "minimal", "strict", "goal", "custom"];
    const PRESET_LABEL = { off: "Off", minimal: "Minimal", strict: "Strict", goal: "Goal", custom: "Custom" };

    const font = { fontFamily: "system-ui, sans-serif", fontSize: "12px" };
    const row = { display: "flex", gap: "8px", alignItems: "center" };
    const button = {
      ...font,
      padding: "2px 8px",
      borderRadius: "6px",
      border: "1px solid rgba(128,128,128,.35)",
      background: "transparent",
      color: "inherit",
      cursor: "pointer",
    };
    const popover = {
      ...font,
      position: "absolute",
      bottom: "110%",
      left: 0,
      width: "320px",
      maxHeight: "360px",
      overflow: "auto",
      padding: "10px",
      borderRadius: "10px",
      border: "1px solid rgba(128,128,128,.3)",
      background: "var(--dsh-color-bg, #1c1c1e)",
      boxShadow: "0 8px 24px rgba(0,0,0,.35)",
      zIndex: 60,
    };
    const mono = { fontFamily: "ui-monospace, monospace", fontSize: "11px" };

    function useActivity() {
      const [state, setState] = useState({ loading: true, data: null });
      useEffect(() => {
        let alive = true;
        const load = () => {
          fetch("/api/runtime-seam/activity")
            .then((res) => res.json())
            .then((body) => {
              if (alive && body && body.ok) setState({ loading: false, data: body.data });
            })
            .catch(() => {
              if (alive) setState({ loading: false, data: null });
            });
        };
        load();
        const timer = setInterval(load, 8000);
        return () => {
          alive = false;
          clearInterval(timer);
        };
      }, []);
      return state;
    }

    function setPreset(preset) {
      fetch("/api/runtime-seam/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preset }),
      }).catch(() => {});
    }

    function ActivityLine(entry) {
      const time = new Date(entry.t).toLocaleTimeString();
      const kind = entry.kind;
      if (kind === "guard") {
        return el("div", { key: entry.t + "guard", style: { marginBottom: 6 } },
          el("div", { style: row }, el("strong", null, "Guard"), el("span", { style: { opacity: .6 } }, time)),
          el("div", { style: mono }, "action: " + entry.action),
          el("div", { style: mono }, "revision: " + entry.revision));
      }
      if (kind === "circuit") {
        return el("div", { key: entry.t + "circuit", style: { marginBottom: 6 } },
          el("div", { style: row }, el("strong", null, "Circuit"), el("span", { style: { opacity: .6 } }, time)),
          el("div", { style: mono }, "tool: " + entry.tool + " repeated: " + entry.repeated),
          el("div", { style: mono }, "result: " + entry.result));
      }
      if (kind === "delta") {
        return el("div", { key: entry.t + "delta", style: { marginBottom: 6 } },
          el("div", { style: row }, el("strong", null, "Delta"), el("span", { style: { opacity: .6 } }, time)),
          el("div", { style: mono }, entry.kind + " " + (entry.path ?? "")));
      }
      if (kind === "change") {
        return el("div", { key: entry.t + "change", style: { marginBottom: 6 } },
          el("div", { style: row }, el("strong", null, "Change"), el("span", { style: { opacity: .6 } }, time)),
          el("div", { style: mono }, entry.path + " -> rev " + entry.revision));
      }
      return el("div", { key: entry.t + kind, style: { marginBottom: 6 } },
        el("span", { style: { opacity: .7 } }, kind + " " + time));
    }

    function ActivityList({ entries }) {
      if (!entries || !entries.length) return el("div", { style: { opacity: .6 } }, "No interventions yet — silence is the default.");
      return el("div", null, entries.slice(0, 20).map(ActivityLine));
    }

    function RuntimeButton() {
      const { data } = useActivity();
      const [open, setOpen] = useState(false);
      const preset = data?.preset ?? "…";
      return el("div", { style: { position: "relative" } },
        el("button", {
          style: { ...button, opacity: 0.85 },
          title: "Runtime",
          onClick: () => setOpen((value) => !value),
        }, "Runtime · " + (PRESET_LABEL[preset] ?? preset)),
        open
          ? el("div", { style: popover },
              el("div", { style: { marginBottom: 8, fontWeight: 600 } }, "Why did Runtime intervene?"),
              el(ActivityList, { entries: data?.activity }))
          : null);
    }

    function CapabilityRow({ name, enabled }) {
      return el("div", { style: { ...row, justifyContent: "space-between", padding: "4px 0" } },
        el("span", null, name),
        el("span", { style: { opacity: enabled ? 1 : 0.35 } }, enabled ? "✓" : "—"));
    }

    function RuntimeSettingsPage() {
      const { data } = useActivity();
      const preset = data?.preset ?? "minimal";
      const caps = data?.capabilities ?? {};
      return el("div", { style: { ...font, fontSize: "13px", maxWidth: 560 } },
        el("h3", null, "Runtime"),
        el("p", { style: { opacity: 0.75 } },
          "Choose which deterministic capabilities your Agent has. Enforcement is not talk: Runtime stays silent by default."),
        el("div", { style: { ...row, flexWrap: "wrap", marginBottom: 12 } },
          PRESETS.map((key) => el("button", {
            key,
            style: { ...button, fontWeight: preset === key ? 700 : 400, borderColor: preset === key ? "currentColor" : undefined },
            onClick: () => setPreset(key),
          }, PRESET_LABEL[key]))),
        el("div", { style: { marginBottom: 12 } },
          el("div", { style: { fontWeight: 600, marginBottom: 4 } }, "Active capabilities"),
          el(CapabilityRow, { name: "Guard (known-invalid action)", enabled: caps.guard }),
          el(CapabilityRow, { name: "Circuit (no-progress failure)", enabled: caps.circuit }),
          el(CapabilityRow, { name: "Critical delta (committed change)", enabled: caps.delta === "critical" }),
          el(CapabilityRow, { name: "Persistence", enabled: caps.persistence }),
          el(CapabilityRow, { name: "Goal / Reconcile", enabled: caps.goal })),
        el("div", { style: { fontWeight: 600, marginBottom: 4 } }, "Runtime activity"),
        el(ActivityList, { entries: data?.activity }),
        el("div", { style: { marginTop: 10, opacity: 0.6 } },
          "Exposure: silent by default. Runtime crosses the model boundary only on committed change or an open circuit."));
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        ctx.slots.inject("conversation.input.left", () =>
          ctx.slots.register(
            { name: "conversation.input.left", id: "dsh-runtime-seam-trigger", order: 0, label: "Runtime", registrant: "dsh-runtime-seam" },
            el(RuntimeButton),
          ));
        ctx.slots.inject("settings.section", () =>
          ctx.slots.register(
            { name: "settings.section", id: "dsh-runtime-seam-settings", order: 0, label: "Runtime", registrant: "dsh-runtime-seam" },
            el(RuntimeSettingsPage),
          ));
      },
    };
  },
});
