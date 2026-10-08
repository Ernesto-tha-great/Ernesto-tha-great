-- One row per developer: signup, first success, second success, and whether
-- the second success was prompted by a nudge. All times are unix seconds.
--
-- Parameters: :return_gap, :nudge_window, :horizon (seconds).
-- Postgres: store the times as timestamptz instead of TEXT, replace
-- unixepoch(x) with extract(epoch from x), and use $1, $2, $3 for the
-- parameters. cliffs.sql needs the same changes. In schema.sql,
-- INSERT OR IGNORE becomes INSERT ... ON CONFLICT DO NOTHING.
WITH
successes AS (
  SELECT developer_id, unixepoch(at) AS t
  FROM api_calls
  WHERE status BETWEEN 200 AND 299
    AND route NOT IN (SELECT route FROM excluded_routes)
),
first_success AS (
  SELECT developer_id, MIN(t) AS t
  FROM successes
  GROUP BY developer_id
),
second_success AS (
  SELECT s.developer_id, MIN(s.t) AS t
  FROM successes s
  JOIN first_success f ON f.developer_id = s.developer_id
  WHERE s.t >= f.t + :return_gap
    AND s.t <= f.t + :horizon
  GROUP BY s.developer_id
)
SELECT
  d.id                                  AS developer_id,
  unixepoch(d.signed_up_at)             AS signed_up,
  f.t                                   AS first_success,
  ss.t                                  AS second_success,
  CASE WHEN ss.t IS NULL THEN NULL
       ELSE EXISTS (
         SELECT 1 FROM nudges n
         WHERE n.developer_id = d.id
           AND unixepoch(n.at) BETWEEN ss.t - :nudge_window AND ss.t
       )
  END                                   AS prompted
FROM developers d
LEFT JOIN first_success f  ON f.developer_id = d.id
LEFT JOIN second_success ss ON ss.developer_id = d.id
ORDER BY d.id;
