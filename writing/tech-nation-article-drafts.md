# Ten article drafts for a Tech Nation evidence trail

Ernest Nnamdi · Developer Relations Engineer · v5 · October 2026

**The through-line:** *reliable software built on unreliable parts*. The unreliable parts are flaky networks, strangers' servers, non-deterministic models, and developers who don't come back. Ten unrelated topics read like a content calendar. One theme, attacked from ten angles, reads like expertise.

> These are briefs, not copy. Write every article yourself. LeadDev and Towards Data Science both reject AI-written submissions, and every editor on this list can smell a template. The descriptions are written as if the research is already done. Replace every number and finding with what you actually measure, and drop any claim your data doesn't support.

---

# Part 1: Core engineering (1–5)

## 1. Offline-First in Practice: Building a Write Queue for React Native With TypeScript

**Subtitle:** Treat every request like checked luggage: tag it, queue it, and make sure it never arrives twice.

**Description:** Checked luggage gets a tag, waits for the next flight if it misses one, and should never arrive twice. That's the whole job of an offline request queue:

- persist the request
- batch it with others
- survive the dropped connection
- retry without double-charging anyone

I replayed recorded mobile traces from underground trains, lifts and packed venues against four offline strategies in React Native, using Mahimahi for replay. The traces build on earlier public commute datasets such as Riiser et al., MMSys 2013. I also scripted two failures that no trace captures: captive-portal Wi-Fi, and phones that have hit their data cap while NetInfo still says "connected".

The piece sorts what broke into a taxonomy:

- per-item idempotency keys (the luggage tag) only work if the server honours them
- backoff timers die when iOS suspends the app
- batches partly succeed

Where the analogy breaks: a retry doesn't move the bag. It copies it, and only the tag reveals the copy.

**Platform:** Smashing Magazine. Send an outline first; an article needs two positive reviews to publish.
**Build first:** the failure taxonomy and an open-source replay harness. Publish any traces you record yourself as a dataset with a DOI.
**Tech Nation:** OC2, provided this is personal work, not your employer's.

---

## 2. Migrating a GraphQL Schema Without Breaking Legacy Mobile Clients

**Subtitle:** DataLoader, persisted queries, and the Android build that will never update.

**Description:** Our first GraphQL schema was the database with a query language bolted on: tables mirrored one-to-one, nullable everything, 400 queries to render one screen. Fixing the shape was the easy part. The hard part was the Android app from eighteen months ago that will never update. This migration case study covers:

- reshaping the schema around what clients actually request
- batching with DataLoader, which issues one query per level of the tree, not one in total
- separating automatic persisted queries (caching) from trusted-document allowlists (security)
- deprecating fields using per-app-version usage data instead of hope

All with the numbers.

**Platform:** InfoQ. It is practitioner-written and peer-reviewed, and the same company runs QCon London.
**Build first:** get employer sign-off to name the system and publish the numbers. Optionally, extract the schema-shape and cost rules into an open-source lint package.
**Tech Nation:** OC3 (significant technical contribution at a product company). Have your engineering lead's recommendation letter cite this work and its numbers.

---

## 3. Time to Second Success: Measuring Developer Retention on API Platforms

**Subtitle:** Everyone tracks the first API call. The second one is where developers decide to stay.

**Description:** Every developer platform tracks how fast a newcomer makes their first API call. Almost none track whether they come back. "Time to Second Success" is the gap between a developer's first working call and their next one that wasn't triggered by a nudge email in the prior seven days. It is activation and retention under a new name, and I'll say so.

The argument is about ownership: platform and DevRel teams should be judged on this metric, not on signups. The piece covers:

- how to instrument the metric with consent (UK and EU readers will ask)
- what it showed across 25 public APIs I onboarded to myself
- what engineering leaders should change when the number is bad

**Platform:** LeadDev, London-based. Its audience is engineering leaders, so frame the piece around their decisions and what they cost the team.
**Build first:** an open spec and instrumentation template for the metric, plus the 25-API onboarding benchmark, published independently.
**Tech Nation:** writing about DevRel is your day job, so the article alone won't count as OC2. The public benchmark and spec can, especially if other teams adopt or cite the term.

---

## 4. The Mobile Data Cost of Web Pages: Pricing 35 Popular Websites in 50 Countries

**Subtitle:** Developers measure bundles in kilobytes. Users pay for them in money.

**Description:** Developers talk about bundle size in kilobytes. Users pay for it in money, and the price of a gigabyte varies enormously by country. Using one consistent source of per-gigabyte mobile data prices (cable.co.uk's latest worldwide comparison), I measured what a first load and a repeat visit cost for 50 widely used web apps. I also measured how much of that cost is JavaScript the user never runs. I report each cost two ways: in money, and in work time at average income (GNI per capita over a 2,080-hour year). Share of income was tried first and rounded to zero, which the article admits.

The piece names the heaviest apps and shows the three fixes that saved the most money per kilobyte. It argues that teams should set performance budgets in currency as well as milliseconds. It builds on Tim Kadlec's What Does My Site Cost?, extended to apps, caching and unused code.

**Platform:** freeCodeCamp News. Its readership is global, and its volunteers translate popular articles.
**Build first:** the dataset and methodology on GitHub, re-runnable by anyone.
**Tech Nation:** OC2 (original research outside your job). The real goal is for other outlets to report on the findings: press *about* you counts towards the mandatory criterion, and your own byline never does.

---

## 5. The Webhooks Handbook: Reliable Delivery With Node.js and TypeScript

**Subtitle:** Signing, retrying and apologising for HTTP calls you send to servers you've never met.

**Description:** A webhook is a promise: the kind your API makes, not the kind you `await`. Most APIs break it quietly. Events arrive twice, out of order, or not at all, and the receiving developer finds out from an angry customer. This handbook builds both sides in Node.js and TypeScript to the Standard Webhooks spec:

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
**Tech Nation:** OC2. Track npm dependents and any translations.

---

# Part 2: AI startups (6–10)

## Ground rules for these five

**Problem first, product second.** Each title names an engineering problem. Each test harness runs on at least two tools, and the startup's product is one of them. Five pieces about five companies that happen to be hiring would read like reviews and job-hunting. Five pieces about agent reliability that test real products read like research.

**Write as an independent tester.** Don't let the company approve the piece before it runs, and publish what broke as well as what worked.

**Conflict-of-interest rule:**

- **Disclose.** If you've applied to the company, say so in the piece, for example: "I've applied to X; they didn't review this."
- **Publish before your start date.** If you're hired, anything you write about that company's product after you start is day-job content: OC3 at best, never OC2. Your new colleagues also stop counting as outside referees.
- **Keep repos on your personal GitHub account.**
- **Keep the "hiring angle" notes below out of your Tech Nation application.**

### Hiring signals

Checked 7 October 2026 via job aggregators. Confirm each role on the company's careers page before applying.

| Company | Role | Posted | Location / right to work | Your odds |
|---|---|---|---|---|
| Tessl | Member of DevRel Staff – Developer Advocate | 3 Sep 2026 (republished 21 Sep) | London; you need UK right to work now, so ask whether they sponsor visas | Strong fit; London |
| Mastra | Founding Developer Marketer; Product Advocate, Developer GTM (19 Aug) | Aug 2026 | Remote, Americas or Europe time zones | Best odds, but one job board marks the Marketer role filled, so confirm both |
| Arize AI | Developer Relations Education Engineer | 27 Aug 2026 | Bay Area per the main listing, remote per a Wellfound copy; ask which | Plausible; wants recorded talks, videos or courses |
| LiveKit | Senior Developer Advocate, Social | 1 Sep 2026 | US only | Long shot: the role runs their social channels and needs a proven audience |

Cognition (Devin, Windsurf) posted its first Developer Relations Engineer role, which has been reposted since, and a Developer Community Manager role on 17 Jul 2026. Confirm the DevRel role is still open.

### Two-week proof kits

These go out with your applications, before any article runs:

| Company | Kit |
|---|---|
| Tessl | A Standard Webhooks skill published to their registry, with task-eval results; a 5-minute video; 2–3 docs PRs; a talk proposal to AI Native DevCon |
| Mastra | A template for their gallery; a 3-minute demo; a week of answering questions in their Discord |
| Arize AI | A recorded 20-minute workshop; a learner repo set up for coding agents (an AGENTS.md file and Phoenix's MCP server); a TypeScript docs PR |
| Cognition | The agent-PR gate as a public GitHub Action; a 3-minute video of a Devin PR going through it; a write-up of where Devin's PRs failed the gate and why |
| LiveKit | A voice agent people can actually call; a 60-second latency clip; a social thread; a PR to the agents-js examples |

---

## 6. How Much Spec Do AI Coding Agents Need? Measuring Drift With Tessl and GitHub Spec Kit

**Subtitle:** If the spec is sheet music, how much notation does it take before every agent plays the same piece?

**Description:** If the spec becomes the source of truth, as Tessl (the London startup founded by Snyk's Guy Podjarny) is betting, then a spec is sheet music and code is a performance. A prose spec is a lead sheet that every player interprets differently. Worked examples are like a recording to copy. Executable tests are the full score.

I wrote the webhook library from article 5 three ways: as prose, then as prose plus examples, then as prose plus executable tests. I kept the coding agent and model fixed. Each spec was implemented five times:

- with Tessl's spec-driven-development skill from their registry
- with GitHub Spec Kit
- with neither

For each run I measured test pass rate, churn between regenerations, and token cost.

This builds on Birgitta Böckeler's comparison of Kiro, Spec Kit and Tessl on martinfowler.com. Her piece compared tools. This one asks how much spec stops drift, a question that will outlive anyone's product pivot. Where the analogy breaks: musicians don't silently invent a missing bar. Agents do.

**Platform:** InfoQ (AI, ML & Data Engineering). It already runs a spec-driven development topic, so pitch the experiment, not the explainer.
**Build first:** the harness and raw diffs. Publish the webhook spec as a public skill in Tessl's registry, and run Tessl's task evals (the same task run with and without the skill) across Cursor, Codex and GitHub Copilot.
**Note:** Tessl's spec-to-code product isn't publicly available (reports say it's in closed beta or paused), so test only what readers can reproduce.
**Tech Nation:** OC2. Tessl's London base also shows you engaging with the UK ecosystem.

---

## 7. Guardrails for Autonomous Coding Agents: A CI Pipeline for Reviewing Devin Pull Requests

**Subtitle:** Treat the agent like a prolific new contributor: welcome the PRs, trust only the tests.

**Description:** Autonomous coding agents like Cognition's Devin take a ticket and come back with a pull request. That makes the agent the most prolific contributor on your team, and the one with the least context. This tutorial builds the pipeline that makes that safe:

- a ticket template the agent can actually finish
- a GitHub Action that hands labelled issues to Devin through its API
- a CI gate on every agent-authored PR: tests, a coverage delta, a diff-size budget, protected paths and a secret scan
- a summary comment that tells the human reviewer where to look

The same gate works for any agent that opens PRs, so the piece compares Devin with at least one other coding agent on the same tickets.

**Platform:** InfoQ (DevOps).
**Build first:** the gate as a reusable GitHub Action in its own repo.
**Tech Nation:** OC2.

---

## 8. Measuring Mouth-to-Ear Latency in Voice AI Agents With LiveKit and React Native

**Subtitle:** Where the half-second goes between the end of your sentence and the agent's first word.

**Description:** In a ten-language study of answers to yes/no questions, the most common gap between turns was 0–200 ms (Stivers et al., PNAS 2009). Voice agents miss that window in both directions: they either cut into your pause or leave you hanging.

Server-side numbers are well covered. LiveKit publishes its own end-of-turn benchmark, and agents-js already reports endpointing delay. What nobody shows is the user's side: the time from the end of your speech to the first sound you hear, on a real phone.

I built an agent in LiveKit Agents for Node.js with a React Native client. I measured that mouth-to-ear time hop by hop:

- endpointing
- speech-to-text
- model time to first token
- text-to-speech
- transport

I took the measurements on good Wi-Fi, then over the commute traces from article 1. I compared LiveKit's turn-detector model (v1-mini when self-hosted) with plain silence detection, and reported p50/p95 latency and false cut-ins. The piece leads with what the delays feel like to the user, and the engineering follows.

**Platform:** Smashing Magazine. Lead with conversational UX; the React Native client is the hook.
**Build first:** a client-side latency-tracing kit for React Native. Pin your agents-js version: the docs say dynamic endpointing is Python-only, but a forum post says agents-js 1.4.3 added it, so verify before you rely on it. Send fixes upstream as PRs.
**Tech Nation:** OC2. Merged PRs to LiveKit's repos are third-party validation.

---

## 9. Detecting LLM-as-a-Judge Drift Across Model Updates With Arize Phoenix

**Subtitle:** Your eval suite passed in March. Then someone replaced the examiner.

**Description:** Exam boards keep markers honest with moderation: re-mark a sample of their papers, then adjust. Exam boards also don't swap the examiner overnight. Model providers do it every few months, and an eval suite that passed in March can quietly mean something else by June.

I traced a TypeScript support agent with Phoenix and used Phoenix's annotation tools to collect labels:

- I hand-labelled 300 traces.
- A second person labelled 100 of them, so the judges have a human-versus-human baseline to beat.

Then I ran three or four judge configurations, including Phoenix's built-in eval templates, across successive versions of the same judge models. For each version I tracked agreement with the humans (Cohen's kappa, with confidence intervals) and which verdicts flipped.

The biases matter here:

- Position bias only affects pairwise grading, so these judges grade one answer at a time, with no comparison.
- Verbosity bias is documented in the MT-Bench paper (Zheng et al., 2023).
- Self-preference is better evidenced in Panickssery et al. (NeurIPS 2024).

The piece cites Shankar et al.'s "Who Validates the Validators?" (UIST 2024) and extends it over time.

**Platform:** Towards Data Science.
**Build first:** the labelled dataset (with a DOI) and a re-runnable drift check, plus any TypeScript gaps you hit, contributed back to Phoenix.
**Tech Nation:** OC2.

---

## 10. Durable Execution for TypeScript AI Agents: Chaos-Testing Mastra, AI SDK and LangGraph.js

**Subtitle:** What happens to the email your agent already sent when the process dies mid-run.

**Description:** An agent loop is a distributed system in which one participant is non-deterministic and every tool call is a side effect. When the process dies halfway through, does your agent re-send the email it already sent?

I gave the same support agent to three TypeScript stacks, each in its recommended production setup:

- Mastra, with persistent storage, step-level retries (off by default) and its opt-in durable recovery
- Vercel's AI SDK
- LangGraph.js, with a checkpointer

Then I injected the same failures into each: 429 rate-limit errors, provider timeouts, malformed tool output, and process kills mid-run. For each stack I counted completed runs and duplicate side effects.

Temporal, Inngest and Restate have argued for durable agents in general. This piece is the cross-framework count for TypeScript. It's article 5 again, except the stranger is your own model.

**Platform:** LeadDev. Lead with the decision a tech lead faces: what to demand from an agent framework before it touches production.
**Build first:** the chaos harness as an open-source package that works with any TypeScript agent framework.
**Tech Nation:** OC2.

---

## Order of play

| When | What |
|---|---|
| Weeks 0–2 | Start your Substack, which becomes your sample bank and sustained record. Build the proof kits for **Tessl and Mastra first** (best odds), then Arize; LiveKit only if you can work in the US. |
| Month 1 | Apply to freeCodeCamp with your Substack samples. Pitch **#6** to InfoQ. Send talk proposals to AI Native DevCon and local meetups. |
| Month 2 | **#5** (freeCodeCamp) and **#9** (Towards Data Science). Give your first meetup talk. |
| Month 3 | **#8** outline to Smashing. Pitch **#10** to LeadDev. |
| Month 4 | **#7** (InfoQ). **#1** outline to Smashing. |
| Months 5–6 | **#4** (freeCodeCamp), then pitch its findings to reporters and podcasts. |
| Month 7 | **#3** (LeadDev). |
| Month 8 | **#2** (InfoQ), once your employer has signed off. |
| Month 12+ | Apply, once there are at least 6 months of follow-on signals. |

**Pacing:** publish roughly one piece a month, never two in the same fortnight.

**Expect rejections:** starting from zero bylines, 6–7 acceptances out of 10 pitches is a good result. Re-pitch the rejected ones elsewhere; don't bunch them up.

**Platform spread:** three pieces at InfoQ, two each at Smashing, LeadDev and freeCodeCamp, and one at Towards Data Science. All five have editors who review before publishing, which Tech Nation's 2025 guidance treats as essential.

**Keep an evidence log from day one.** Record each signal with its date and a screenshot:

- npm dependents and GitHub forks
- merged upstream PRs (Standard Webhooks, LiveKit, Phoenix, Tessl's registry)
- pickups in newsletters such as JavaScript Weekly, React Status and GraphQL Weekly
- citations of your datasets
- translations
- talks and podcasts

Two of your three recommendation letters should come from people outside your company who used your work.

**Mandatory criterion:** this plan doesn't secure it yet. That criterion needs coverage *about* you, and right now that rests on hoped-for press for #4. Talks, podcast interviews and newsletter features about your tools all count towards it, so chase them from month 2.

**Expect Exceptional Promise, not Talent.** You don't have a publication record yet, so Promise is the realistic route. This plan is built for it.

## Voice

See [voice-guide.md](voice-guide.md). It's built from Ernest's published DZone and HackerNoon tutorials and Justin Irabor's Craft Overflow posts, and it replaces the earlier cheat sheet. Every article is a step-by-step code-along: the reader builds the project from an empty folder, and the repo is the finished version to check against.

## Review log

- **v1 → v2** (Tech Nation assessor, commissioning editors, voice editor):
  - unified the theme
  - added a "build first" artefact to every pitch
  - split evidence between OC2 and OC3
  - fixed the technical errors
  - dropped two closed platforms (LogRocket and DigitalOcean)
  - cut the account-abstraction pitch
- **v2 → v3** (your feedback):
  - removed the Nigeria-specific framing
  - added five AI-startup pieces, choosing the last three for DevRel hiring since July 2026
- **v3 → v4** (technical fact-checker; DevRel hiring-manager panel and Tech Nation assessor):
  - made the AI pieces problem-first, with each one testing at least two tools
  - added a conflict-of-interest rule, a right-to-work column and two-week proof kits
  - **#6:** now tests how much spec stops drift, using Tessl's public skills rather than its closed spec-to-code beta
  - **#7:** replaced the inverted valet-key analogy; the skills now run inside the IDE, on a corrected benchmark
  - **#8:** now measures the client side and drops the setup scoring that only LiveKit's own benchmark can do
  - **#9:** added a second human marker; the headline is now judge drift; the bias citations are corrected
  - **#10:** no more straw-man baseline; compares three frameworks, each in its production setup
  - **#1:** now uses Mahimahi to replay the traces
  - **#4:** now uses a single price source plus affordability
  - moved talks earlier and set realistic acceptance expectations
- **v4 → v5** (your feedback):
  - rewrote all ten titles as plain technical titles (technology + problem + method)
  - moved the analogies and wit into the subtitles
- **v5 → v6** (your feedback):
  - replaced DataGrip (#7) with Cognition's Devin
