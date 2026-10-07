# Five article drafts for a Tech Nation evidence trail

Ernest Nnamdi · Developer Relations Engineer · v2 (after review panel) · October 2026

**The through-line:** *building reliable software for unreliable conditions* — flaky networks, expensive data, APIs that talk to strangers, developers who don't come back. Five unrelated topics read like a content calendar. One theme, attacked from five angles, reads like expertise.

> These are briefs, not copy. Write every article yourself. LeadDev runs submissions through AI detection, and every editor on this list can smell a template. The descriptions are written as if the research is already done. Replace every number and finding with what you actually measure, and drop any claim your data doesn't support.

---

## 1. Every Request Is a Danfo

**Subtitle:** Testing offline-first React Native against real Lagos network traces.

**Description:** A danfo leaves the park when it's full, breaks down somewhere on Third Mainland Bridge, and you board the next one without paying twice. That's the whole job of an offline request queue: batch, survive the drop, retry without double-charging. I recorded network traces on real Lagos connections — dropped packets, captive portals, data bundles that quietly hit zero while NetInfo still says "connected" — and replayed them against four offline strategies in React Native. This piece shows which ones survived, why per-item idempotency keys matter only if the server honours them, what happens to your backoff timers when iOS suspends the app, and how to handle a batch where three requests succeed and two don't.

**Platform:** Smashing Magazine (outline first; needs two positive reviews to publish)
**Build first:** the traces (published as a dataset with a DOI so others can cite it) and an open-source replay harness. The library is a footnote; the data is the contribution.
**Tech Nation:** OC2, provided the dataset and harness are personal work, not your employer's.

---

## 2. Stop Serving Your Database Raw

**Subtitle:** How we reshaped a table-shaped GraphQL schema without breaking the mobile clients that never update.

**Description:** Our first GraphQL schema was the database with a query language bolted on: tables mirrored one-to-one, nullable everything, 400 queries to render one screen. Fixing the shape was the easy part. The hard part was the Android app from eighteen months ago that will never update. This is a migration case study: reshaping the schema around what clients actually request, batching with DataLoader (one query per level of the tree, not one in total), separating automatic persisted queries (caching) from trusted-document allowlists (security), and deprecating fields using per-app-version usage data instead of hope. With the numbers.

**Platform:** InfoQ (practitioner-written, peer-reviewed; the same company runs QCon London)
**Build first:** employer sign-off to name the system and publish the numbers; optionally, extract the schema-shape and cost rules into an open-source lint package.
**Tech Nation:** OC3 (significant technical contribution at a product company). Have your engineering lead's recommendation letter cite this work and its numbers.

---

## 3. The Second Hello World

**Subtitle:** Time to first call is the metric everyone tracks. Time to second success is the one that predicts whether developers stay.

**Description:** Every developer platform tracks how fast a newcomer makes their first API call. Almost none track whether they come back. "Time to Second Success" — the gap between a developer's first working call and their next one that wasn't triggered by a nudge email in the prior seven days — is activation and retention under a new name, and I'll say so. The argument is about ownership: platform and DevRel teams should be judged on it, not on signups. The piece covers how to instrument it with consent (UK and EU readers will ask), what it showed across 25 public APIs I onboarded to myself, and what engineering leaders should change when the number is bad.

**Platform:** LeadDev (London-based; audience is engineering leaders, so frame it around their decisions and what they cost the team)
**Build first:** an open spec and instrumentation template for the metric, plus the 25-API onboarding benchmark, published independently.
**Tech Nation:** writing about DevRel is your day job, so the article alone won't count as OC2. The public benchmark and spec can, especially if other teams adopt or cite the term. Follow it with a talk at DevRelCon or LeadDev London.

---

## 4. Your Bundle Size Is Billed in Naira

**Subtitle:** I measured what it costs a Nigerian user to open 50 popular African apps. Some of them cost more than lunch.

**Description:** Developers talk about bundle size in kilobytes. Users pay for it in naira. Using published data-bundle prices from Nigeria's major networks, I measured what a first load and a repeat visit cost for 50 widely used African fintech, commerce and media web apps — and how much of that money goes on JavaScript the user never runs. The piece names what's heavy, shows the three fixes that saved the most naira per kilobyte, and argues that African product teams should set performance budgets in local currency, not milliseconds. It builds on Tim Kadlec's What Does My Site Cost?, applied to the market where it matters most.

**Platform:** TechCabal (guest article or opinion, 800–1,500 words; the audience is operators, so lead with money, not webpack)
**Build first:** the dataset and methodology on GitHub, re-runnable by anyone.
**Tech Nation:** OC2 (original research that advances the ecosystem, outside your job). The real goal is for other outlets to report on the findings: press about you is mandatory-criterion evidence, and your own byline never is.

---

## 5. Webhooks Are Promises You Make to Strangers

**Subtitle:** The Webhooks Handbook: signing, retrying and apologising for HTTP calls you send to servers you've never met.

**Description:** A webhook is a promise — the kind your API makes, not the kind you `await`. Most APIs break it quietly: events arrive twice, out of order, or not at all, and the receiving developer finds out from an angry customer. This handbook builds both sides in Node.js and TypeScript to the Standard Webhooks spec:

- a transactional outbox, which fixes the "not at all" case
- HMAC signatures verified on the raw body with `timingSafeEqual`
- secret rotation
- replay protection
- SSRF guards for customer-supplied URLs
- retries with backoff
- idempotent consumers
- a reconciliation endpoint for the events you'll still miss

It promises at-least-once delivery, never "never lost". Every chapter ends with the failure it prevents.

**Platform:** freeCodeCamp News, handbook format. You must apply with three writing samples.
**Build first:** the reference repo, and merged contributions to the Standard Webhooks libraries. That project is multi-vendor (its steering committee includes Zapier, Twilio, ngrok, Supabase and Kong), so a merged PR is a form of third-party validation.
**Tech Nation:** OC2. Track npm dependents of the reference repo, and any translations of the handbook by freeCodeCamp's volunteers.

---

## Order of play

The bar to entry rises from top to bottom. You don't have prior bylines yet, so start where the bar is lowest.

| When | What |
|---|---|
| Now | Start your own Substack, in the spirit of Craft Overflow. It won't count as evidence on its own. It is your sample bank and proves a sustained record. Publish three short pieces drawn from the work below. |
| Months 1–2 | Build the artefacts: the Lagos traces, the webhooks repo, the naira-cost dataset. |
| Months 2–3 | Apply to freeCodeCamp with your Substack samples, then publish **#5**. |
| Months 3–4 | Send the outline for **#1** to Smashing. |
| Months 4–5 | Publish **#4** at TechCabal, then pitch the findings to other reporters and podcasts. |
| Months 5–7 | **#3** at LeadDev, followed by a talk proposal. |
| Months 6–8 | **#2** at InfoQ, once your employer has signed off. |
| Month 12+ | Apply, once there are at least 6 months of follow-on signals. |

Space the articles 6–8 weeks apart. If five land in one quarter, the assessor will read them as manufactured for the application.

**Keep an evidence log from day one.** Record each signal with its date and a screenshot:

- npm dependents and GitHub forks
- pickups in newsletters such as JavaScript Weekly, React Status and GraphQL Weekly
- citations of your datasets
- translations
- invited talks and podcasts
- teams adopting "Time to Second Success"

Two of your three recommendation letters should come from people outside your company who used your work.

**Expect Exceptional Promise, not Talent.** You have no publication record yet. Promise is the realistic route, and this plan is built for it.

## Voice cheat sheet (mogwai-style, not mogwai's sentences)

What to take from Justin Irabor (Craft Overflow):

- **Title and subtitle.** The title makes a claim; the subtitle winks. One joke per pair.
- **One analogy per article.** Map every part of it to a mechanism, and say in one sentence where it breaks.
- **Open with a confession.** Use a small, specific one: the bug you shipped, or the metric you trusted.
- **Lagos is the test lab, not the scenery.** Use latency, packet loss and naira prices, not traffic jokes. Explain local words like danfo once, then move on.
- **Go to primary sources.** Link the spec, RFC or EIP, quote it, and name its authors.
- **Wit in the margins, precision in the middle.** Keep the code, numbers and claims dry. Cut words like "production-grade", "leverage" and "robust".
- **At InfoQ and LeadDev, turn the jokes down.** Use the analogy in the intro and call back to it once. Put your numbers and method in the first 200 words. Write "we", and show the trade-offs.

Don't borrow his signatures: "An African X's Guide to…" framing, "Look, I get it" openers, "minimum viable [noun]", Picasso, Heinlein, or "one fumble at a time".

## What the review panel changed

| Reviewer | Flag | Change |
|---|---|---|
| Tech Nation assessor | Five unrelated topics read like a content push. | One theme across all five. |
| Tech Nation assessor | Your own bylines are never mandatory-criterion evidence. | Each piece now ships a citable artefact, and #4 is designed to earn press coverage. |
| Tech Nation assessor | DevRel writing is your day job, which weakens OC2. | Employer work goes under OC3 with a manager's letter; personal open source and data go under OC2. |
| Commissioning editors | Every pitch promised proof it didn't show. | A "build first" line on every draft. |
| Commissioning editors | The DataLoader claim, conflated persisted queries, NetInfo, iOS suspension and missing webhook safeguards. | All corrected in the descriptions above. |
| Commissioning editors | LogRocket and DigitalOcean were listed as backups. | Both removed. LogRocket's guest programme is closed, and DigitalOcean's has been paused to new authors (the most recent public note is from 2022). |
| Voice editor | The danfo analogy pointed the wrong way, and the buka analogy undercut its own point. | Danfo remapped; buka cut. |
| Voice editor | "Second Hello World" and "Time to Second Success" were used as competing names. | One name, used consistently. |
| All three | "Gas Is a UX Bug" was weak evidence and technically off. EIP-7702 doesn't remove seed phrases, and much Nigerian stablecoin volume moves on Tron or inside custodial apps, where users never see gas anyway. | Replaced with the naira-cost dataset (#4). If you revive it, pitch the contrarian version — "gas isn't the problem, on/off-ramps are" — and build a reference app first. |
