Results over 25 seeded runs per trace and strategy.

### conference-wifi (synthetic)

| Strategy | Actions | Exactly once | Duplicated | Lost | p50 delivery | p95 delivery |
|---|---:|---:|---:|---:|---:|---:|
| Fire and forget | 1139 | 67.0% | 0.0% | 33.0% | 1.1 s | 1.6 s |
| Retry in memory | 1139 | 91.7% | 8.3% | 0.0% | 1.5 s | 250.1 s |
| Durable queue, no tags | 1139 | 92.4% | 7.6% | 0.0% | 1.4 s | 232.0 s |
| Checked luggage | 1139 | 100.0% | 0.0% | 0.0% | 1.4 s | 217.5 s |

### data-cap (synthetic)

| Strategy | Actions | Exactly once | Duplicated | Lost | p50 delivery | p95 delivery |
|---|---:|---:|---:|---:|---:|---:|
| Fire and forget | 985 | 47.3% | 0.0% | 52.7% | 0.6 s | 1.1 s |
| Retry in memory | 985 | 100.0% | 0.0% | 0.0% | 29.6 s | 507.8 s |
| Durable queue, no tags | 985 | 100.0% | 0.0% | 0.0% | 25.7 s | 515.0 s |
| Checked luggage | 985 | 100.0% | 0.0% | 0.0% | 29.9 s | 510.7 s |

### lift (synthetic)

| Strategy | Actions | Exactly once | Duplicated | Lost | p50 delivery | p95 delivery |
|---|---:|---:|---:|---:|---:|---:|
| Fire and forget | 469 | 85.7% | 0.0% | 14.3% | 0.6 s | 1.1 s |
| Retry in memory | 469 | 97.9% | 2.1% | 0.0% | 0.7 s | 48.1 s |
| Durable queue, no tags | 469 | 97.0% | 3.0% | 0.0% | 0.7 s | 47.3 s |
| Checked luggage | 469 | 100.0% | 0.0% | 0.0% | 0.7 s | 46.2 s |

### underground-commute (synthetic)

| Strategy | Actions | Exactly once | Duplicated | Lost | p50 delivery | p95 delivery |
|---|---:|---:|---:|---:|---:|---:|
| Fire and forget | 1217 | 35.5% | 0.0% | 64.5% | 0.6 s | 1.5 s |
| Retry in memory | 1217 | 73.8% | 2.5% | 23.7% | 16.6 s | 139.4 s |
| Durable queue, no tags | 1217 | 94.4% | 5.6% | 0.0% | 70.2 s | 579.7 s |
| Checked luggage | 1217 | 100.0% | 0.0% | 0.0% | 52.2 s | 553.6 s |
