-- Where did developers stop? For each group, the last call each developer made,
-- counted by route, status and key mode.
--
--   stalled: reached a first success, but no second one within :horizon
--   never:   made calls but never reached a first success
--
-- Each developer's window starts at their first success (or, for "never", their
-- first call) and lasts :horizon. We look at the last call inside it, and only
-- count developers whose window has closed by :as_of (unix seconds), so people
-- who are still mid-evaluation don't show up as drop-offs.
WITH
successes AS (
  SELECT developer_id, unixepoch(at) AS t
  FROM api_calls
  WHERE status BETWEEN 200 AND 299
    AND route NOT IN (SELECT route FROM excluded_routes)
),
first_success AS (
  SELECT developer_id, MIN(t) AS t FROM successes GROUP BY developer_id
),
returned AS (
  SELECT DISTINCT s.developer_id
  FROM successes s JOIN first_success f ON f.developer_id = s.developer_id
  WHERE s.t >= f.t + :return_gap AND s.t <= f.t + :horizon
),
callers AS (
  SELECT developer_id, MIN(unixepoch(at)) AS first_call FROM api_calls GROUP BY developer_id
),
groups AS (
  SELECT c.developer_id,
         CASE WHEN f.developer_id IS NULL THEN 'never' ELSE 'stalled' END AS cohort,
         COALESCE(f.t, c.first_call) AS window_start
  FROM callers c
  LEFT JOIN first_success f ON f.developer_id = c.developer_id
  WHERE COALESCE(f.t, c.first_call) <= :as_of - :horizon
    AND c.developer_id NOT IN (SELECT developer_id FROM returned)
),
last_calls AS (
  SELECT g.cohort, a.route, a.status, a.key_mode,
         ROW_NUMBER() OVER (PARTITION BY a.developer_id ORDER BY a.at DESC) AS rn
  FROM api_calls a JOIN groups g ON g.developer_id = a.developer_id
  WHERE a.route NOT IN (SELECT route FROM excluded_routes)
    AND unixepoch(a.at) <= g.window_start + :horizon
)
SELECT cohort, route, status, key_mode AS keyMode, COUNT(*) AS developers
FROM last_calls
WHERE rn = 1
GROUP BY cohort, route, status, key_mode
ORDER BY cohort, developers DESC;
