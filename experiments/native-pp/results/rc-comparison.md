# Runtime Continuation — first-round comparison (docs/19, generated)

| run | arm | modelCalls | steps | toolCalls | pwsh | intents | dispatched | discarded | reload(world) | aligned | turn | confounded | officialReplay | input | output | cacheRead | reasoning |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| rc-a1 | a | 16 | 14 | 29 | 4 | - | - | - | 1 | true | completed | no | yes | 23918 | 8396 | 449280 | 4868 |
| rc-a2 | a | 22 | 20 | 43 | 4 | - | - | - | 1 | true | completed | no | yes | 29548 | 12588 | 707328 | 6960 |
| rc-b1 | b | 14 | 13 | 31 | 3 | 1 | 1 | 0 | 1 | true | completed | no | REFUSED | 10202 | 6448 | 308736 | 2674 |
| rc-b2 | b | 16 | 15 | 23 | 7 | 1 | 1 | 0 | 1 | true | completed | no | REFUSED | 41482 | 13582 | 692480 | 8794 |
| rc-c1 | c | 21 | 19 | 52 | 6 | 1 | 0 | 1 | 0 | true | completed | no | REFUSED | 26826 | 16820 | 676352 | 10604 |
| rc-c2 | c | 14 | 12 | 30 | 3 | 1 | 0 | 1 | 0 | true | completed | no | REFUSED | 14170 | 11546 | 326400 | 8352 |
| rc-ctrl1 | ctrl | 7 | 6 | 7 | 1 | 0 | 0 | 0 | - | true | completed | no | yes | 3488 | 1360 | 110848 | 182 |

## Totals (7 official cells, retroactive decode-zstd, zero in-loop metering)

- input 149634 / output 70740 / cacheRead 3271424 / cacheWrite 0 / reasoning 42434

## Smoke cells (development, excluded from conclusions)

| run | arm | modelCalls | steps | toolCalls | intents | dispatched | reload(world) | aligned | turn |
|---|---|---|---|---|---|---|---|---|---|
| rc-smokeb1 | b | 12 | 10 | 25 | 0 | 0 | 1 | true | completed |
| rc-smokeb2 | b | 8 | 7 | 16 | 1 | 1 | 1 | true | error |
| rc-smokeb3 | b | 14 | 13 | 34 | 1 | 1 | 1 | true | completed |
| rc-smokeb4 | b | 16 | 15 | 26 | 1 | 1 | 2 | true | completed |
| rc-smokeb5 | b | 16 | 15 | 34 | 1 | 1 | 1 | true | completed |
