# DSH Runtime

[English](README.md) | [简体中文](README.zh-CN.md)

**An experimental Runtime / Harness capability set for DeepSeek Harness.**

> **Agent = Model + Harness**

This repository does not attempt to define a complete Universal Runtime.

It starts from a much simpler question:

> **When an Agent repeatedly runs into problems in a real environment, how much of it is already deterministic enough that the model should no longer be responsible for it?**

If a capability is genuinely needed, it can be loaded as a Plugin.

If not, it isn't loaded.

If you understand the problem differently, implement your own Plugin.

What is offered here is the thinnest possible landing point, plus a set of mechanisms and experimental material that have been validated in real DeepSeek Harness scenarios.

---

## Why does this project exist?

Today's Agents can already understand tasks, reason, call tools, explore environments, modify files, and complete complex work.

But in real runs, another class of problems keeps appearing:

* The Agent repeatedly re-discovers the same already-determined environment state;
* An action is deterministically invalid, yet the model keeps trying to execute it;
* A tool keeps returning the same error, and the Agent keeps retrying;
* A state is not yet satisfied, and the Agent can only probe / poll repeatedly;
* A project state already established in a previous Session is re-discovered from scratch in a new Session;
* The task completes, but invariants of the environment were broken along the way;
* A Plugin fails during load or startup, sometimes affecting the whole Host.

These problems do not all belong to the Model.

Very often, the program already knows the answer.

The issue is only that:

> **The answer still lives inside the Agent's reasoning space.**

So the model has to discover it, remember it, believe it, and constrain itself.

That is not necessarily the best allocation of responsibility.

---

# Starting from one question: what should no longer live in text?

Initially there was no complete design called Runtime.

A closer starting point was:

> What has become deterministic enough that it should no longer depend on Prompts, Context, or the model's own self-restraint?

Real DSH runs then exposed several very different answers:

```text
Deterministically not allowed
→ Guard

It will change in the future
→ Commitment + Delta

No progress anymore
→ Circuit

No change
→ Silence

Deterministic facts across Sessions
→ Persistence

The model needs to know
→ Exposure
```

So Runtime is not an answer that was defined up front.

It is closer to:

> **A natural landing point for a Plugin, once a class of deterministic capability has been extracted.**

---

# What Runtime is not

Runtime is not another Agent.

Not a new Reasoner.

Not "pushing more environment information into Context".

Not a unified architecture every DSH user must adopt.

And especially not:

```text
Runtime
→ collect all state
→ inject every turn
→ let the model remember
→ let the model decide whether to comply
```

Experiments explicitly suggest this direction does not always work.

We lean toward:

```text
Model
→ owns genuine uncertainty

Harness / Runtime
→ owns what the program can already determine
```

---

# Where does Runtime live?

Runtime mainly lives on the two boundaries of the Agent execution loop.

```text
                         Model
                          │
                        Reason
                          │
                          ▼
                  ┌───────────────┐
                  │ Runtime       │
                  │ Pre-Action    │
                  │               │
                  │ Guard         │
                  │ Circuit       │
                  └───────┬───────┘
                          │
                     allow / reject
                          │
                          ▼
                       Execute
                          │
                          ▼
                  ┌───────────────┐
                  │ Runtime       │
                  │ Post-Action   │
                  │               │
                  │ State         │
                  │ Delta         │
                  │ Commitment    │
                  └───────┬───────┘
                          │
                          ▼
                      next Reason
```

Therefore:

**Before execution**, Runtime can decide whether a deterministic action is allowed to enter the real world at all.

**After execution**, Runtime can observe whether reality changed in a way worth crossing the cognition boundary.

These two directions answer, respectively:

> **"Can this action happen?"**

and:

> **"What has reality changed into now?"**

---

# Mechanisms obtained from experiments so far

## 1. Guard: knowledge is not compliance

In a real DSH scenario, we constructed:

```text
required_by_host = true
```

The model, after having already probed this fact, still attempted to unload.

Without Runtime Guard:

```text
worldCorrect = 0%
```

With Guard:

```text
first rejection
→ the action never enters the executor

worldCorrect = 100%
```

This shows:

> **If the Harness can already determine that an action is invalid, the most reliable place for the constraint is the execution boundary — not the model context.**

---

## 2. Teaching-style rejection: the rejection itself becomes input for the next reasoning round

Guard does not simply return an opaque failure.

The experiments use a very small, deterministic rejection description:

```text
fact
predicate
temporal
next
```

In the controlled experiments, no `(fact, action)` combination ever produced a second teaching rejection.

So the current observation is:

> **One well-structured deterministic rejection lets the model re-plan in the next round, without handing enforcement back to the model.**

One caveat:

This is not a universal law that "a model permanently learns from one mistake".

It is a Harness behavior observed under controlled conditions.

---

## 3. Commitment + Delta: temporary errors are different from permanent ones

If:

```text
ready = false
```

but it will deterministically become:

```text
ready = true
```

then a plain Guard produces:

```text
reject
→ probe
→ probe
→ probe
```

In the experiment, we added:

```text
Commitment:
you will be notified when the state changes.
```

When the change actually happened:

```text
mounted → ready
```

only a:

```text
Delta
```

was sent.

Result:

```text
re-checks after rejection
3.0 → 1.67

payload
172k → 130k
```

Same direction on v4pro.

So:

> **"Not true now" and "never true" should be different Runtime semantics.**

---

## 4. Circuit: repeated failure does not always need to be re-understood by the model

E4b targeted:

```text
same tool
+
same error fingerprint
+
no meaningful progress
```

Results:

| Metric              | No Circuit | Circuit | Circuit + Delta |
| ------------------- | ---------: | ------: | --------------: |
| Failed attempts     |       3.33 |    3.00 |        **2.00** |
| Attempts after open |       1.33 |    1.00 |           **0** |
| Steps               |       9.00 |    5.00 |        **3.67** |
| Payload             |    286,747 |  76,696 |      **53,005** |

Directionally:

```text
failed attempts   ↓ 40%
steps             ↓ 59%
payload           ↓ 81%
```

More importantly, the E7 creative task surfaced a loop that no one had designed for in advance:

```text
tool denied
→ retry
→ denied
→ retry
→ ...
```

This suggests Circuit is better understood as:

> **No-progress detection**

rather than a patch for one specific MCP / flaky error.

---

## 5. Silence: existing is not the same as being exposed

This is one of the most important principles here.

If Runtime state has not changed meaningfully:

```text
no change
→ no emission
```

Runtime can exist and observe the whole time, without telling the model over and over:

```text
"I'm still here."
"Still ready."
"Still ready."
"Still ready."
```

Therefore:

> **Runtime can be very active while the model-facing context stays quiet.**

---

## 6. Persistence: deterministic facts can survive across Sessions

In E6:

```text
baseline
→ no persistence

none
→ persisted, but silent by default

pickup
→ persisted + proactively injected
```

Results:

|          | Probes |  Payload |
| -------- | -----: | -------: |
| baseline |      7 |    1.51M |
| none     |   5.33 |    1.24M |
| pickup   |      5 | **732k** |

On v4pro:

```text
baseline
10.5 probes / 1.18M payload

pickup
3 probes / 133k payload
```

This yields an important distinction:

> **Persistence ≠ Exposure**

State may be retained.

That does not mean every Session should automatically inject it.

Even less that it should be repeated every time.

---

# We also validated some things that should NOT be done

These negative results are just as much a part of the project's outcome.

## Positive facts are not worth re-injecting

If the model can already see from the tool schema / current environment:

```text
tool surface
plugin state
```

re-injecting the same fact yields no stable benefit.

In some lifecycle scenarios it even triggers more re-checks.

---

## Injection is not Enforcement

In E3:

```text
ready → disabled
```

The model was explicitly told:

```text
disabled
```

and still kept calling.

Therefore:

> **Context can provide knowledge, but it cannot replace the execution boundary.**

---

## Provenance does not automatically buy trust

We tested whether:

```text
authority
revision
fingerprint
```

reduces re-checks after rejection.

Results:

```text
v4flash:
plain = 0
authority = 0.67

v4pro:
plain = 0.5
authority = 0.5
```

So the current conclusion:

> **Provenance does not purchase trust.**

These fields are better suited for:

```text
revision
freshness
reconciliation
arbitration
```

than as a hint of "believe me".

---

# The most important scenario experiment: does Runtime hurt creation?

We do not want Runtime to buy "stability" by reducing all behavior.

So we used an open-ended creation task requiring a real, runnable artifact.

Same model, same task, same environment — only the Harness composition changed:

|                  |    Off | Minimal |     Strict |
| ---------------- | -----: | ------: | ---------: |
| Steps            |     20 |      24 |         20 |
| Time             |   186s |    204s |       148s |
| Creative actions |     11 |  **21** |         12 |
| World broken     |  **Yes** |       No |          No |
| Artifact runs    |      ✓ |       ✓ |          ✓ |
| Input tokens     | 135.9k |  139.3k |  **83.6k** |
| Reasoning tokens |  31.8k |   29.3k |  **24.5k** |
| cacheRead        | 2.666M |  2.683M | **1.897M** |

The most important thing here is not any single N=1 percentage.

The more important structure is:

```text
creation still happens
+
deterministic overreach is blocked
+
deterministic dead ends can be cut
```

In another set of creative runs, adding Circuit preserved the model's creative path while pruning the repeated-error path.

So the more accurate statement is:

> **Runtime can separate execution waste from creation.**

It does not need to decide for the model:

```text
how to create
which approach to take
what to write
```

It only handles:

```text
this action is deterministically invalid
this path has no progress left
reality has actually changed
```

---

# Four quadrants: the user can be wrong, and the Harness can still protect reality

Putting Prompt correctness and Harness strength on the two axes:

|         | Prompt correct | Prompt wrong |
| ------- | -------------- | ------------ |
| Minimal | A              | B            |
| Strict  | C              | D            |

What we have so far:

### A: correct Prompt × Minimal

Task completes normally, worldCorrect.

### B: wrong Prompt × Minimal

The user asks to unload a Host-required plugin.

Result:

```text
rejection
+
world stays correct
```

Even the most minimal Runtime is enough to hold this boundary.

### C: correct Prompt × Strict

Creative action count:

```text
10 = 10
```

Strict was not observed to cut normal creation.

### D: wrong Prompt × Strict

The most memorable result:

```text
task success = 0
worldCorrect = 1
```

The user's goal itself was wrong.

The Harness did not:

```text
redefine the goal for the user
```

nor did it:

```text
let the wrong goal destroy reality
```

Instead:

```text
reject
→ preserve world
```

D1 further verified factual errors:

```text
the user believes ready
reality is not ready
```

Runtime let the wrong assumption be corrected by the real state, instead of letting the error enter execution directly.

So in this scenario, the clearest principle is:

> **A Harness should enforce reality, not replace user intent.**

---

# Cost: what really needs optimizing is the Agent trajectory

At first, we tended to think of Runtime cost as:

```text
Runtime added context
→ tokens increased
```

Real data changed this understanding.

DSH's real usage shows:

> **cacheReadTokens are a major part of Agent trajectory cost.**

One extra model turn is not just one extra reasoning pass.

It also means:

```text
submitting history again
+
re-reading the prefix KV
+
producing output / reasoning again
```

Therefore:

> **Eliminating one model turn that should never have happened usually matters more than optimizing the few hundred characters Runtime itself adds.**

After retroactively decoding the historical trajectories:

```text
E4b Circuit
→ cacheRead directionally down 55–62%

E6 pickup
→ about -63% on flash
→ about -89% on v4pro

E7 creative scenario
→ Circuit directionally down about 45%

mode-level Strict
→ cacheRead directionally down about 49% vs Off
```

These numbers come from different experiments, different scenarios, and small-sample runs, and should not be read as universal performance promises.

What is worth keeping is the cost structure:

```text
Better trajectory
→ fewer turns
→ fewer prefix reads
→ lower model-side cost
```

So the economic value of Runtime should not be measured only by:

> "How many tokens did Runtime itself emit?"

but rather by:

> **"How much unnecessary Agent work did it eliminate?"**

---

# Agent = Model + Harness

If:

$$
Agent = Model + Harness
$$

then Harness is not just "giving the model some tools".

It also decides:

```text
what may execute
what must not execute
what has happened
what needs to be announced
what does not need to be announced
which path has no progress left
which state should survive across Sessions
```

So a more complete understanding is:

```text
Model
→ uncertainty
→ reasoning
→ exploration
→ creation

Harness
→ deterministic state
→ execution boundary
→ progress
→ continuity
```

This does not mean the bigger the Harness, the better.

Quite the opposite:

> **A good Harness catches what is already determined, instead of constantly building new determinism-management systems.**

---

# Why does "everything is a Plugin" matter?

This project does not turn Runtime into a new centralized subsystem of DSH Core.

The reason is simple:

if a deterministic capability really deserves to exist, it should own its boundary as much as possible.

```text
DSH
 │
 ├── Plugin A
 ├── Plugin B
 ├── Runtime Plugin
 └── ...
```

Therefore:

> **One of the real values of the plugin model is giving "extracted determinism" an independent place to exist.**

This does not mean everything should be a Plugin.

It only allows us to:

```text
discover determinism
→ extract
→ implement independently
→ load on demand
→ disable independently
→ replace independently
```

instead of:

```text
discover a problem
→ modify Core
→ everyone must carry it
```

---

# We are not trying to define a Universal Runtime

This repository has only one very restrained goal:

> **Provide a thin enough Runtime extension point, plus a few reference mechanisms validated by real experiments.**

One future user may need:

```text
runtime-mcp
```

another may need:

```text
runtime-workspace
```

and still others may need:

```text
runtime-project
runtime-progress
runtime-lifecycle
```

None of these need to be pre-ordained by this repository.

Someone may even conclude:

> "This problem should not be solved by Runtime at all."

That is also a legitimate answer.

---

# Presets are compositions, not standards

The presets included here exist to lower the cost of the first try — not to define the "correct" Runtime.

Ultimately they can be understood as capability compositions:

```text
Minimal
→ the smallest deterministic landing point

Strict
→ a higher degree of Runtime responsibility

Goal
→ experimental capability for deterministic target states

Custom
→ compose it yourself
```

A preset should not become a new Agent type.

It is only:

> **A default combination of capabilities.**

---

# Modes and common scenarios

## Minimal (default)

**Scenario**: everyday sessions for most technical users — coding, debugging, small tooling. You want zero configuration, and you only want "things that are deterministically settled" to be handled by the program.

**What it does**: Guard (known-invalid action → one teaching rejection) + Circuit (repeated failure with no progress → open) + critical-change notifications (fulfilled commitments / circuit open-close). Silent the rest of the time.

> The default for everyday coding sessions — handles only what is deterministically settled, and stays silent otherwise.

## Strict

**Scenario**: high-stability environments — production configs, long-running sessions, multi-plugin collaboration. You need stronger enforcement and accept slightly reduced Agent freedom in exchange.

**What it does**: everything in Minimal + Persistence (deterministic facts retained across Sessions). Freshness / long-term stale authority has no evidence yet and stays off by default.

> High-stability environments — adds persistence on top of Minimal; stronger enforcement in exchange for slightly reduced agent freedom.

## Goal

**Scenario**: you know exactly what state the environment should be in — e.g. an MCP must be ready, a plugin must be active. You only want Runtime to guarantee that target state, not to do any strategic work for you.

**What it does**: narrow Goal = announce (notification on transitions) + guard (reject while unmet). Runtime-executed repair (reconcile) is Experimental and off by default; anything that requires "choosing an approach" goes back to the Agent.

> For an explicit target environment state — announce + guard only; never repairs, never chooses strategy (that stays with the Agent).

## Custom

**Scenario**: you want to compose capabilities yourself, or control them precisely through a config file.

**What it does**: Guard / Circuit / Critical delta / Persistence / Query / Goal — check whichever you want in the settings page, or hand-write `runtime-seam.capabilities` in `settings.yaml` (see `docs/custom-config.md`).

> Compose your own capability set — UI checkboxes and hand-written settings.yaml are equivalent.

## Off

**Scenario**: the baseline for comparison, or when you don't need any Runtime for now.

> No runtime at all — the experimental baseline.

---

# One very important principle: Runtime should stay silent most of the time

The existence of Runtime state does not mean Runtime must keep explaining itself to the model.

So we lean toward:

```text
No change
→ Silence

Known invalid
→ Guard

Future deterministic transition
→ Commitment + Delta

Repeated no-progress
→ Circuit
```

In other words:

> **Runtime may hold a lot of internal state, but it should not hold an equal amount of model-visible state.**

This is also why these boundaries matter so much:

```text
Persistence ≠ Exposure
Authority ≠ Intervention
Execution ≠ Report
```

---

# Prompts should have their own boundary of responsibility too

Much mature Agent engineering practice already emphasizes:

```text
Intent
Goal
Deliverable
Acceptance
```

This information is very important.

This project does not believe Prompts should be written weaker.

On the contrary:

> **The clearer the task goal, deliverable, and acceptance criteria, the better.**

But the Prompt defines:

```text
what I want to do
```

while the Harness can own:

```text
what reality is
which actions may enter reality
when reality changes
when continuing makes no sense anymore
```

So a cleaner division of responsibility is:

```text
Human
→ Intent / Goal / Acceptance

Model
→ Interpretation / Exploration / Creation

Harness
→ Deterministic reality

Host
→ Non-negotiable system boundaries
```

---

# Errors are allowed

The user can be wrong.

The model can misjudge.

A Plugin can be mis-implemented.

A good Harness does not mean it can find "the truly correct intent" for everyone.

It should rather guarantee:

> **Errors stay in the responsibility layer they belong to, and do not pierce a reality boundary that determinism could have protected.**

Therefore:

```text
User intent
may be wrong

Model reasoning
may be wrong

Deterministic world
must not be arbitrarily destroyed because the first two were wrong
```

This is also the core observation of quadrant D.

---

# Experimental method

The experiments here are not "prove a theory first, then force a scenario".

They are closer to this loop:

```text
real DSH problem
       ↓
real trajectory
       ↓
observe friction
       ↓
find the part that is already deterministic
       ↓
propose a minimal mechanism
       ↓
A/B / controlled experiment
       ↓
keep / discard
```

For example, E7 started from:

```text
flaky retry
```

but reading the trajectory event by event also revealed:

```text
deny
→ retry
→ deny
→ retry
```

which produced a second kind of no-progress pattern.

Discoveries like this are part of the experiment.

Therefore:

> **A trajectory is not just an experiment result; it is also the input for the next experiment.**

---

# Evidence and limitations

This repository contains the full experimental material, historical trajectories, and real token usage data.

Completed so far:

```text
100+ session runs
2 models
real DSH Host
isolated profiles
real usage reconstruction
```

But many behavior experiments are still small-sample per scenario.

So we explicitly distinguish:

### Mechanism-level conclusions

For example:

```text
Guard can block before execution.
Circuit can prevent repeated execution.
State changes can trigger Delta.
```

These are the strongest evidence.

### Scenario-level observations

For example:

```text
Strict shortened the trajectory in this creative scenario.
Pickup significantly reduced payload in this cross-Session scenario.
```

These are valuable real engineering results, but should not be extrapolated into universal laws.

### Conclusions not yet established

We will not announce, just because some result looks good:

```text
Runtime always improves agents.
Strict is always better.
More state is always useful.
More provenance creates more trust.
```

On the contrary, the experiments already produced counterexamples in those directions.

---

# Community problems

This project comes from real DeepSeek Harness friction.

The community problems mapped to the current experiments include, among others:

```text
MCP stale / expired sessions
Plugin lifecycle drift
Workspace / ownership boundaries
Repeated deterministic failures
Tool retry loops
Long-session execution waste
Cross-session project state
Plugin load-time failure isolation
```

For the specific issue/discussion mapping, see:

```text
evidence/community-map.md
```

This project does not advertise any single Plugin as the one answer to these problems.

The goal is only:

> **To align real problems with Harness capabilities that have already been validated.**

---

# Plugin Contribution

If you want to contribute a Runtime / Harness capability, first answer:

```text
1. What real DSH problem does this capability solve?

2. Which part is already deterministic?

3. Why should this part no longer be the model's responsibility?

4. When should Runtime intervene?

5. When should it stay silent?

6. How does Runtime state decide stale / changed?

7. If the Plugin itself fails, can it avoid dragging down the Host?

8. Can the Plugin be disabled / uninstalled / recovered?
```

The most important question:

> **Is this abstraction forced out by real friction?**

If the answer is only:

> "Maybe we'll need it someday."

then it is better not to add a new core abstraction yet.

The full checklist is in `docs/contribution.md`.

---

# Plugin safety boundary

A Runtime Plugin is still a DSH Plugin.

Therefore:

> **Runtime itself must not become a new single point of failure.**

At minimum, consider:

```text
boot-time failure
dependency mismatch
headless environment
disable / uninstall
state isolation
workspace boundary
credential handling
unrelated plugin survival
```

In particular:

> **Runtime is not the place to solve every Plugin failure.**

If a problem occurs in:

```text
Plugin discovery
Plugin activation
Host boot
```

then it likely belongs to the Host / Plugin lifecycle, not Runtime.

Those problems should be solved in Plugin contracts, Host isolation, and developer tooling.

---

# Repository structure

```text
dsh-runtime/
├── README.md
├── README.zh-CN.md
│
├── core/
│   └── runtime-seam/
│
├── presets/
│   ├── minimal/
│   ├── strict/
│   ├── goal/
│   └── custom/
│
├── plugins/
│   └── runtime-progress/
│
├── experiments/
│   ├── harness/
│   └── data/
│
├── evidence/
│   └── community-map.md
│
├── docs/
│   ├── adr/
│   ├── status/
│   └── bugs/
│
└── scripts/
```

Where:

```text
core/
```

should stay as stable as possible.

While:

```text
plugins/
experiments/
evidence/
```

should be allowed to keep growing with real usage.

---

# Current status

This is an **experimental project**.

Completed so far:

* Runtime seam prototype;
* Minimal / Strict / Goal / Custom preset skeletons;
* Guard / Circuit / State / Delta / Persistence experiments;
* cross-validation of the key mechanisms on flash + v4pro;
* real token / cacheRead reconstruction;
* four-quadrant Prompt × Harness scenario experiments;
* desensitized experimental material and local environment info;
* Plugin failure pitfalls and the contribution boundary.

The next focus is not to keep proving "whether Runtime has value".

It is:

> **To polish the mechanisms that already have evidence into Plugins that can truly be loaded, composed, disabled, and replaced.**

---

# Finally: why a Plugin?

Because we do not believe we already know what the final structure of an Agent should be.

This project only observed one very concrete fact:

> **In real Agent runs, some work is already deterministic enough that it is not worth occupying the model's reasoning space.**

If that work can be separated out, the most natural way is not to stuff it all back into Core.

It is:

```text
Real friction
      ↓
Deterministic part
      ↓
Capability
      ↓
Plugin
      ↓
Harness
```

Today it may be Runtime.

Tomorrow it may be something else.

We don't need to know in advance.

---

# A principle that is simple enough for now

```text
If the model still needs to judge,
let the model judge.

If the program already knows the answer,
don't make the model rediscover it.

If reality has deterministically said no,
don't let the model decide whether it can execute.

If reality has not changed,
don't tell the model.

If a path has no progress left,
don't let it continue forever.

If a state already exists,
that does not mean it must be re-injected.

If the user's intent may be wrong,
protect reality, but don't redefine the user's intent.
```

> **Agent = Model + Harness**

This repository only explores:

> **Which part the Harness should actually catch.**
