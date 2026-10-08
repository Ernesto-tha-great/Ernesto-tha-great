Each scenario run 30 times. Database: in-memory SQLite, 1 ms per statement, pool of 10.

| Scenario | SQL statements | Median | p95 |
|---|---:|---:|---:|
| Android 2.3 on v1 (all 100 orders) | 401 | 59.4 ms | 63.9 ms |
| Android 2.3 on v2, app unchanged (all 100 orders) | 3 | 7.8 ms | 8.5 ms |
| iOS 3.1 on v2 (first 20 orders) | 4 | 7.1 ms | 7.6 ms |
