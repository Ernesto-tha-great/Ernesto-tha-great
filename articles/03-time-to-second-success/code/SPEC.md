# Time to Second Success: metric definition (v0.1)

A short, opinionated definition you can implement in an afternoon and argue about in a meeting. The point is that everyone on the team computes the same number.

## Events you need

| Event | Fields | Notes |
|---|---|---|
| `signup` | `developer_id`, `at` | When the account (or workspace) was created |
| `api_call` | `developer_id`, `at`, `method`, `route`, `status`, `key_mode`, `sdk` | `route` is the **template** (`/v1/labels/:id`), not the raw path |
| `nudge` | `developer_id`, `at`, `kind` | Anything you sent to bring them back: email, in-app message, a DevRel DM |

`developer_id` should be the account the API key belongs to, not the key itself. People rotate keys.

## Definitions

**Meaningful call.** Any `api_call` that is not on the excluded list. Exclude calls that prove nothing about building with your API: health checks, `GET /me`, token exchange.

**Success.** A meaningful call with a `2xx` status.

**First success (FS).** The developer's earliest success.

**Second success (SS).** The developer's earliest success that happens **at least `return_gap` after FS** (default: 24 hours) and **within `horizon` of FS** (default: 30 days).

The gap is what makes it a *second* success and not just the rest of the first session. A developer who makes twelve calls in their first sitting has had one good afternoon, not two.

**Prompted.** A second success is *prompted* if you sent that developer a nudge in the `nudge_window` before it (default: 72 hours). Otherwise it's *unprompted*.

## The numbers

| Metric | Definition |
|---|---|
| **TTFS** | `FS - signup`, for developers who reached FS. Report p50 and p90. |
| **SSR30** (second-success rate) | Developers with an SS within the horizon ÷ developers with an FS. Only count developers whose FS is at least `horizon` old, or the rate is biased low. |
| **Unprompted SSR30** | Same, counting only unprompted second successes. |
| **TTSS** | `SS - FS`, for developers who reached SS. Report p50 and p90. |

SSR30 is the headline. TTSS tells you how long the decision takes, and TTFS tells you how long the door is.

## Drop-off cliffs

For developers who reached FS but never reached SS, take the **last call they made**. Group by `route` and `status`. The top few rows are your cliffs: the specific step where people who had already succeeded once gave up.

Do the same for developers who signed up, made calls and never reached FS. Those are your onboarding cliffs.

## Defaults and why

| Parameter | Default | Why |
|---|---|---|
| `return_gap` | 24 h | Long enough to mean "came back another day", short enough not to miss weekend projects |
| `nudge_window` | 72 h | Most of an email's effect is gone within a few days |
| `horizon` | 30 days | Lines up with trial periods and monthly reporting |

Change them if your product needs it. Just change them for everyone, and write down the new values next to every number you report.

## Consent

These are product analytics about how people use your API. Say so in your privacy notice. In the UK and EU, if you also collect data client-side through an SDK (rather than from your own server logs), check whether you need consent under PECR or the ePrivacy rules. Server-side request logs you already keep for operating the API are usually the simpler path.
