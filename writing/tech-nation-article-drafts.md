# Five article drafts for a Tech Nation evidence trail

Ernest Nnamdi · Developer Relations Engineer · v1 (pre-review)

---

## 1. Every Request Is a Danfo

**Subtitle:** Offline-first React Native for networks that are, frankly, going through something.

**Description:** A danfo does not leave the park until it is full, and the conductor will not refund you if it breaks down on Third Mainland Bridge. Your app's network requests should work the same way. This is a field guide to building React Native apps for users whose connection drops between Ikeja and Yaba: a persisted request queue, batching, exponential backoff with jitter, idempotency keys so a retry never charges anyone twice, and a conflict-resolution policy you can explain to a product manager. Every pattern is tested against network profiles recorded on real Lagos 3G, and the queue ships as an open-source library.

**Platform:** Smashing Magazine (mobile / React Native)
**Backup:** LogRocket Blog

---

## 2. Your GraphQL Schema Is a Menu, Not the Kitchen

**Subtitle:** What a buka taught me about API design, N+1 queries, and why customers shouldn't see your pots.

**Description:** At a good buka you point at the food, not at the pot. Most GraphQL schemas let the customer into the kitchen: database tables mirrored one-to-one, nullable everything, and a resolver tree that fires 400 queries to render one screen. This is the story of a schema redesign: moving from a table-shaped schema to a use-case-shaped one, killing N+1 with DataLoader, adding query cost limits, shipping persisted queries for mobile, and deprecating fields without breaking a single client. With before-and-after numbers.

**Platform:** InfoQ (Architecture & Design)
**Backup:** LogRocket Blog

---

## 3. The Second Hello World

**Subtitle:** Why DevRel's favourite metric is lying to you, and what to measure instead.

**Description:** Time to First Hello World is a first date. Everyone measures it. Nobody measures whether the developer calls back. This essay argues that DevRel teams optimise the wrong moment and proposes a replacement: Time to Second Success, the gap between a developer's first working call and their second, unprompted one. It covers how to instrument it (SDK telemetry, docs analytics, support-ticket tagging), what the numbers looked like on a real developer platform, and the three "drop-off cliffs" that show up in almost every onboarding flow.

**Platform:** LeadDev
**Backup:** InfoQ (Culture & Methods)

---

## 4. Gas Is a UX Bug

**Subtitle:** Account abstraction, stablecoins, and building for the user who will never say "wallet".

**Description:** In Lagos, people use stablecoins for the same reason they keep dollars under the mattress: the naira moves too much. But they quit at the seed phrase screen, and nobody wants to buy ETH to send USDT. This piece explains, for builders, how ERC-4337 smart accounts, paymasters and EIP-7702 remove gas and seed phrases from the user's view, what new risks they add (paymaster griefing, bundler centralisation, upgradeable-account footguns), and what African fintech teams should build first.

**Platform:** TechCabal (Opinion)
**Backup:** CoinDesk Opinion

---

## 5. Webhooks Are Promises You Make to Strangers

**Subtitle:** A handbook on signing, retrying and apologising for HTTP calls you send to servers you've never met.

**Description:** A webhook is a promise: "I'll tell you when something happens." Most APIs break that promise quietly. Events arrive twice, out of order, or not at all, and the receiving developer finds out from an angry customer. This handbook builds a production-grade webhook system in Node.js and TypeScript from both sides: HMAC signing and verification, replay protection, retries with backoff, idempotent consumers, ordering guarantees (and when not to promise them), a dead-letter queue, and a developer-facing replay dashboard. Every chapter ends with the failure mode it prevents.

**Platform:** freeCodeCamp News (handbook format)
**Backup:** DigitalOcean Community (Write for DOnations)
