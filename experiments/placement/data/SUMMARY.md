# Context-placement experiment (2026-09-01) — raw summary

Isolated home: `<HOME>\.dsh-place-exp` (profile `place`: dsh-base + dsh-headless + dsh-ctx-place), model deepseek-v4-flash, minimal preset, N=3 per arm, 21 headless runs total.

Probe: workspace file `tags.txt` = v2.1.0 (stale); injected fact = "RUNTIME FACT (authoritative, current): build tag is v3.0.0". Task: read tags.txt, write BUILD_TAG.txt, report.

## Arms

| arm | mechanism | valid runs | BUILD_TAG.txt |
|---|---|---|---|
| baseline | no fact | 3 | v2.1.0 ×3 |
| section | `systemPrompt.section()` order 50 | 3 (v2) | **v3.0.0 ×3** |
| context | `systemPrompt.context()` snapshot | 3 (v2) | v3.0.0 ×2, v2.1.0 ×1 |
| prestep | `agent/pre-step` every step | 3 | **v3.0.0 ×3** |
| prestep-once | `agent/pre-step` step 1 only | 3 | **v3.0.0 ×3** |

v1 section/context runs (6) had a silent mechanism failure (fact never reached the input, `factInTranscript=false`, behavior identical to baseline); they are excluded from the table above and treated as accidental extra baseline samples. v2 runs verified via apply-time `assemble()` self-check (ARM-OK in stdout).

## Token means (valid arms, 6 model calls in every run)

| arm | input | output | reasoning | cacheRead |
|---|---|---|---|---|
| baseline | 17,019 | 422 | 86 | 33,280 |
| section | 16,989 | 2,308 | 1,938 | 35,328 |
| context | 17,045 | 1,762 | 1,349 | 34,816 |
| prestep | 17,496 | 1,063 | 652 | 33,877 |
| prestep-once | 17,084 | 885 | 521 | 33,896 |

## Hypothesis verdicts

- H1 (fact in section → cacheRead worst): directionally yes (+2.0k) but NOT via prefix breakage — the static section text keeps the prefix identical; the extra cacheRead comes from contradiction-resolution reasoning. H1's mechanism premise was wrong for a static fact.
- H2 (context/prestep ≈ baseline cache): supported (+1.5k / +0.6k; absolute deltas small).
- H3 (utilization differs by position): NOT supported at N=3 — every placement was followed (one context miss). Labeled authority dominates position in this probe.

## New observation (not pre-hypothesized, directional, N=3)

Contradiction-resolution cost ordered by position: reasoning section (1938) > context (1349) > prestep (652) > prestep-once (521). The earlier the conflicting fact sits, the more deliberation it costs. One outlier (section-v2-r3: 3658 reasoning) and one context miss (context-v2-r1, the largest output of all runs) — the model did wrestle with the conflict, but resolution direction is not deterministic at this N.

## Unsupported claims

- No claim that one placement is "better" for utilization.
- No claim about recall/late-use of the fact (only immediate use measured).
- No claim about non-authoritative framing (the fact was labeled authoritative).

## Open questions

- v1 silent failure root cause not conclusively isolated (ctx.get at apply vs assembly logging); fixed by `inject: ['systemPrompt']` + self-check.
- Whether a NON-authoritative fact shows position sensitivity.
- Whether the fact is still usable several steps AFTER its injection (memory vs current state over time).
