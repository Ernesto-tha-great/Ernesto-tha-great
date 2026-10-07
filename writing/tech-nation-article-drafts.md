# Ten article drafts for a Tech Nation evidence trail

Ernest Nnamdi · Developer Relations Engineer · v3 · October 2026

**The through-line:** *reliable software built on unreliable parts*. The unreliable parts are flaky networks, strangers' servers, non-deterministic models, and developers who don't come back. Ten unrelated topics read like a content calendar. One theme, attacked from ten angles, reads like expertise.

> These are briefs, not copy. Write every article yourself. LeadDev and Towards Data Science both reject AI-written submissions, and every editor on this list can smell a template. The descriptions are written as if the research is already done. Replace every number and finding with what you actually measure, and drop any claim your data doesn't support.

---

# Part 1: Core engineering (1–5)

## 1. Treat Every Request Like Checked Luggage

**Subtitle:** Testing offline-first React Native against network traces recorded on trains, in lifts and on conference Wi-Fi.

**Description:** Checked luggage gets a tag, waits for the next flight if it misses one, and should never arrive twice. That's the whole job of an offline request queue:

- persist the request
- batch it with others
- survive the dropped connection
- retry without double-charging anyone

I recorded network traces in the places mobile apps actually break: underground trains, lifts, packed venues, captive-portal Wi-Fi, and phones that have hit their data cap while NetInfo still says "connected". Then I replayed the traces against four offline strategies in React Native. The piece shows:

- which strategies survived
- why per-item idempotency keys (the luggage tag) only work if the server honours them
- what happens to your backoff timers when iOS suspends the app
- how to handle a batch where three requests succeed and two don't

**Platform:** Smashing Magazine. Send an outline first; an article needs two positive reviews to publish.
**Build first:** publish the traces as a dataset with a DOI, so other people can cite them, and an open-source replay harness. The data is the contribution.
**Tech Nation:** OC2, provided the dataset and harness are personal work, not your employer's.

---

## 2. Stop Serving Your Database Raw

**Subtitle:** How we reshaped a table-shaped GraphQL schema without breaking the mobile clients that never update.

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

## 3. The Second Hello World

**Subtitle:** Time to first call is the metric everyone tracks. Time to second success is the one that predicts whether developers stay.

**Description:** Every developer platform tracks how fast a newcomer makes their first API call. Almost none track whether they come back. "Time to Second Success" is the gap between a developer's first working call and their next one that wasn't triggered by a nudge email in the prior seven days. It is activation and retention under a new name, and I'll say so.

The argument is about ownership: platform and DevRel teams should be judged on this metric, not on signups. The piece covers:

- how to instrument the metric with consent (UK and EU readers will ask)
- what it showed across 25 public APIs I onboarded to myself
- what engineering leaders should change when the number is bad

**Platform:** LeadDev, London-based. Its audience is engineering leaders, so frame the piece around their decisions and what they cost the team.
**Build first:** an open spec and instrumentation template for the metric, plus the 25-API onboarding benchmark, published independently.
**Tech Nation:** writing about DevRel is your day job, so the article alone won't count as OC2. The public benchmark and spec can, especially if other teams adopt or cite the term. Follow it with a talk at DevRelCon or LeadDev London.

---

## 4. The Kilobyte Tax

**Subtitle:** What it costs to open the web's most-used apps, priced in mobile data across 50 countries.

**Description:** Developers talk about bundle size in kilobytes. Users pay for it in money, and the price of a gigabyte varies enormously by country. Using published per-gigabyte mobile data prices (from ITU and cable.co.uk's annual comparison), I measured what a first load and a repeat visit cost for 50 widely used web apps. I also measured how much of that cost is JavaScript the user never runs.

The piece names the heaviest apps and shows the three fixes that saved the most money per kilobyte. It argues that teams should set performance budgets in currency as well as milliseconds. It builds on Tim Kadlec's What Does My Site Cost?, extended to apps, caching and unused code.

**Platform:** freeCodeCamp News. Its readership is global, and its volunteers translate popular articles.
**Build first:** the dataset and methodology on GitHub, re-runnable by anyone.
**Tech Nation:** OC2 (original research outside your job). The real goal is for other outlets to report on the findings: press *about* you counts towards the mandatory criterion, and your own byline never does.

---

## 5. Webhooks Are Promises You Make to Strangers

**Subtitle:** The Webhooks Handbook: signing, retrying and apologising for HTTP calls you send to servers you've never met.

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

**The rule for these five:** write as an independent tester. Don't let the company approve the piece before it runs, disclose any relationship, and publish what broke as well as what worked. That independence is what makes these pieces count for Tech Nation. It is also what a DevRel hiring manager wants to see: someone who can find the rough edges in their product and explain them kindly.

**Hiring signals** (checked 7 October 2026 via job aggregators; confirm on each careers page before applying):

| Company | Role | Posted | Where |
|---|---|---|---|
| Tessl | Member of DevRel Staff – Developer Advocate | 3 Sep 2026 (republished 21 Sep) | London (also Bay Area and New York variants) |
| LiveKit | Senior Developer Advocate, Social | 1 Sep 2026 | US remote |
| LiveKit | Staff Developer Advocate, Community & Events | 3 Jul 2026 | US |
| Arize AI | Developer Relations Education Engineer | 27 Aug 2026 | San Francisco Bay Area |
| Mastra | Product Advocate, Developer GTM | 19 Aug 2026 | Remote |

DataGrip is a JetBrains product rather than a startup, so it's here because you asked for it, not because of a hiring signal. If you meant **Datagrid**, the San Francisco AI-agents startup, say so and I'll swap the pitch.

Caveats on the other roles:

- **Mastra:** this role is sales-leaning, but the listing names developer relations as a growth path. Mastra also has a Founding Developer Marketer opening, with about 80% of the time spent on developer content.
- **Alternates if you'd rather swap one out:**
  - ElevenLabs has a remote Developer Relations Engineer role, but the newest dated copy is from June 2026.
  - Vercel has a Senior Developer Advocate, AI role, posted around August 2026.

---

## 6. Sheet Music for Robots

**Subtitle:** I wrote one spec for a webhook library, had three agents perform it five times each, and measured the drift.

**Description:** Tessl, the London startup founded by Snyk's Guy Podjarny, is betting that the spec, not the code, becomes the source of truth. If that's right, a spec is sheet music, the code is a performance, and every coding agent is a different orchestra.

I took the reference library from article 5, wrote its spec once, and had it implemented three ways:

- by an agent using Tessl's registry and spec-first workflow
- with GitHub's Spec Kit
- by plain prompting

I regenerated each implementation five times. Then I measured:

- test pass rate
- how much the code churned between regenerations
- which ambiguities the spec failed to pin down
- what each run cost in tokens

Where the analogy breaks: musicians don't silently invent a missing bar. Agents do.

**Platform:** InfoQ (AI, ML & Data Engineering). It already runs an active spec-driven development topic, so pitch the experiment, not the explainer.
**Build first:** publish the spec as a public package in Tessl's registry, plus the harness and the raw regeneration diffs.
**Tech Nation:** OC2. Tessl's London base also shows you engaging with the UK ecosystem.
**Hiring angle:** the London DevRel role mentions building out Tessl Academy, their learning hub. A rigorous, slightly sceptical experiment is exactly the kind of teaching content that hub needs.

---

## 7. Give Your Agent the Valet Key

**Subtitle:** Benchmarking DataGrip's new agent skills for text-to-SQL, on a database I was prepared to lose.

**Description:** A valet key starts the car but won't open the boot. That is roughly the access an AI agent should have to your database.

DataGrip 2026.2 ships three agent skills: connection management, text-to-SQL, and database tools. JetBrains says they make agents more accurate while using fewer tokens. I tested that claim with the same agent and the same 150 questions from a public text-to-SQL benchmark, run once with the skills and once without, measuring execution accuracy and token use.

Then I tested the part nobody benchmarks: what the agent tries to do with a write-capable connection, and which guardrails actually stop it. The candidates are read-only roles, the IDE's consent prompts, statement timeouts and transaction rollbacks. Where the analogy breaks: a valet can still crash the car. A read-only agent can still run the query that takes your database down, and only a timeout stops it.

**Platform:** Towards Data Science. Its editors ask for new methods or underserved areas, which this is.
**Build first:** the benchmark harness and results, plus a minimal "agent-safe" Postgres role template.
**Tech Nation:** OC2.

---

## 8. Wait, Let Me Finish

**Subtitle:** Where the half-second goes in a voice agent, measured end to end with LiveKit Agents for Node.js and a React Native client.

**Description:** Across ten languages, people take turns with gaps of a fraction of a second (Stivers et al., PNAS 2009). Voice agents miss that window in both directions: they either cut into your pause or leave you hanging.

I built the same agent in LiveKit Agents for Node.js, with a React Native client, and timed every hop from the end of the user's speech to the first audio frame back:

- endpointing delay
- speech-to-text finalisation
- model time to first token
- text-to-speech time to first byte
- network transport

Then I compared silence-based endpointing with LiveKit's audio turn-detector model at different minimum and maximum delays. I scored each setup on LiveKit's open end-of-turn benchmark, reporting p50/p95 latency and how often the agent interrupted.

**Platform:** Smashing Magazine. The piece is conversational UX as much as engineering, and the client is React Native.
**Build first:** an open-source latency-tracing kit that others can run on their own LiveKit agents. Send any fixes to their docs or examples upstream.
**Tech Nation:** OC2. Merged PRs to LiveKit's repos are third-party validation.
**Hiring angle:** the open Social role asks for someone "deep in the agentic AI world" who has built a voice agent. This is that, with receipts.

---

## 9. Who Marks the Examiner?

**Subtitle:** I hand-labelled 300 agent traces to see how often an LLM judge agrees with a human, using Arize Phoenix on a TypeScript agent.

**Description:** LLM-as-judge is now the default way to evaluate agents. But the judge is also a language model, with the position, verbosity and self-preference biases documented in the MT-Bench paper (Zheng et al., 2023).

Exam boards solved this decades ago with moderation: re-mark a sample of each marker's papers, then adjust. This piece does the same:

- trace a TypeScript support agent with Phoenix
- hand-label 300 traces
- measure agreement between the human labels and the judges (Cohen's kappa) across judge models, rubric styles, and pairwise versus pointwise grading

It publishes the labelled set and a moderation loop you can run on your own judges. Where the analogy breaks: exam markers don't change overnight, but a judge does every time its provider ships a model update.

**Platform:** Towards Data Science.
**Build first:** the labelled dataset (with a DOI) and the moderation-loop code. Contribute any TypeScript gaps you hit back to Phoenix, which is open source.
**Tech Nation:** OC2.
**Hiring angle:** the Education Engineer role is about teaching developers to evaluate well, and this is a ready-made course module.

---

## 10. Your Agent Is a Distributed System Now

**Subtitle:** Chaos-testing a TypeScript agent with Mastra: rate limits, timeouts, and the tool call that sent the email twice.

**Description:** An agent loop is a distributed system in which one participant is non-deterministic and every tool call is a side effect. When the model times out halfway through, does your agent retry the tool call that already emailed the customer?

I built a TypeScript support agent with Mastra and injected failures:

- 429 rate-limit errors
- provider timeouts
- malformed tool output
- process restarts mid-run

I compared a naive agent loop with Mastra workflows that use step-level retries, suspend/resume and idempotent tool design, measuring completion rate and duplicate side effects. It's article 5 again, except the stranger is your own model.

**Platform:** LeadDev. Frame it for tech leads: what to demand from an agent framework before it touches production.
**Build first:** the chaos harness as an open-source package that works with any TypeScript agent framework, not just Mastra.
**Tech Nation:** OC2.
**Hiring angle:** Mastra's whole pitch is TypeScript agents that survive production. Showing where they do, and where they don't, is developer-marketing content with a spine.

---

## Order of play

Each AI piece goes stale fast, and the hiring windows are open now, so build the AI artefacts first. Don't publish the full articles on your own Substack, though. Smashing and Towards Data Science want unpublished work, and so will the others. Send hiring managers the artefact and a short lab-notes post instead, and save the full article for the editorial venue.

| When | What |
|---|---|
| Now | Start your Substack (your sample bank and sustained record). Build the Tessl, LiveKit and Arize artefacts. Post short lab notes on each, and send them with your applications. |
| Month 1 | Apply to freeCodeCamp with your Substack samples. Pitch **#6** to InfoQ. |
| Month 2 | **#5** (freeCodeCamp) and **#9** (Towards Data Science). |
| Month 3 | **#8** outline to Smashing. |
| Month 4 | **#7** (Towards Data Science). **#1** outline to Smashing. |
| Months 5–6 | **#10** (LeadDev) and **#4** (freeCodeCamp), then pitch #4's findings to reporters and podcasts. |
| Month 7 | **#3** (LeadDev), followed by a talk proposal. |
| Month 8 | **#2** (InfoQ), once your employer has signed off. |
| Month 12+ | Apply, once there are at least 6 months of follow-on signals. |

Publish roughly one piece a month, never two in the same fortnight. Ten pieces landing in one quarter would read as manufactured for the application.

**Platform spread:** two pieces each at Smashing, InfoQ, LeadDev, freeCodeCamp and Towards Data Science. Every one of them has editors who review before publishing, which Tech Nation's 2025 guidance treats as essential. Self-published Medium and LinkedIn posts carry little weight.

**Keep an evidence log from day one.** Record each signal with its date and a screenshot:

- npm dependents and GitHub forks
- merged upstream PRs (Standard Webhooks, LiveKit, Phoenix)
- pickups in newsletters such as JavaScript Weekly, React Status and GraphQL Weekly
- citations of your datasets
- translations
- invited talks and podcasts

Two of your three recommendation letters should come from people outside your company who used your work.

**Expect Exceptional Promise, not Talent.** You don't have a publication record yet, so Promise is the realistic route. This plan is built for it.

## Voice cheat sheet (mogwai-style, not mogwai's sentences)

What to take from Justin Irabor (Craft Overflow):

- **Title and subtitle.** The title makes a claim; the subtitle winks. One joke per pair.
- **One analogy per article.** Map every part of it to a mechanism, and say in one sentence where it breaks.
- **Open with a confession.** Use a small, specific one: the bug you shipped, or the metric you trusted.
- **Real conditions are the test lab, not the scenery.** That means latency, packet loss, token bills and p95s.
- **Go to primary sources.** Link the spec, paper or changelog, quote it, and name its authors.
- **Wit in the margins, precision in the middle.** Keep the code, numbers and claims dry. Cut words like "production-grade", "leverage" and "robust".
- **At InfoQ, LeadDev and Towards Data Science, turn the jokes down.** Use the analogy in the intro and call back to it once. Put your numbers and method in the first 200 words. Write "we", and show the trade-offs.

Don't borrow his signatures: "An African X's Guide to…" framing, "Look, I get it" openers, "minimum viable [noun]", Picasso, Heinlein, or "one fumble at a time".

## Review log

- **v1 → v2** (Tech Nation assessor, commissioning editors, voice editor):
  - unified the theme
  - added a "build first" artefact to every pitch
  - split evidence between OC2 and OC3
  - fixed the technical errors (DataLoader, persisted queries, NetInfo, iOS suspension, webhook safeguards)
  - dropped LogRocket (guest programme closed) and DigitalOcean (paused to new authors)
  - cut the account-abstraction pitch
- **v2 → v3** (your feedback):
  - removed every Nigeria-specific framing; Justin Irabor is now a style reference only
  - replaced the danfo analogy with checked luggage
  - widened the naira study to 50 countries
  - replaced TechCabal with freeCodeCamp
  - added five AI-startup pieces (Tessl, DataGrip, LiveKit, Arize AI, Mastra), choosing the last three for DevRel hiring since July 2026
