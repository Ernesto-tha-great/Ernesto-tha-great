-- Where did developers stop? For each group, the last call each developer made,
-- counted by route, status and key mode.
--
--   stalled: reached a first success, never reached a second one within :horizon
--   never:   made calls but never reached a first success
--
-- Parameters: :return_gap, :horizon, :as_of (unix seconds). Only developers
-- whose first call is at least :horizon before :as_of are counted, so people
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
         CASE WHEN f.developer_id IS NULL THEN 'never' ELSE 'stalled' END AS cohort
  FROM callers c
  LEFT JOIN first_success f ON f.developer_id = c.developer_id
  WHERE c.first_call <= :as_of - :horizon
    AND c.developer_id NOT IN (SELECT developer_id FROM returned)
),
last_calls AS (
  SELECT g.cohort, a.route, a.status, a.key_mode,
         ROW_NUMBER() OVER (PARTITION BY a.developer_id ORDER BY a.at DESC) AS rn
  FROM api_calls a JOIN groups g ON g.developer_id = a.developer_id
  WHERE a.route NOT IN (SELECT route FROM excluded_routes)
)
SELECT cohort, route, status, key_mode, COUNT(*) AS developers
FROM last_calls
WHERE rn = 1
GROUP BY cohort, route, status, key_mode
ORDER BY cohort, developers DESC;
