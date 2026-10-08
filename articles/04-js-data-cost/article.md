# The Mobile Data Cost of Web Pages: Pricing 35 Popular Websites in 50 Countries

*Developers measure bundles in kilobytes. The people loading them pay in money, and some of them pay in hours.*

**Ernest Nnamdi** · JavaScript · Web performance · Playwright

---

The first landing page I was properly proud of had a full-screen background video: eight seconds of developers laughing at laptops, looping forever. I'd compressed it in a way I described at the time as "pretty aggressive". It looked great on the office connection. Then a friend opened it on a bus, on a prepaid plan, and sent me a screenshot of their data balance with one word underneath: *"Why?"*

The video was 9 MB, and it started playing before anyone asked it to. I had measured that page. I knew its Largest Contentful Paint to a tenth of a second. I had never once asked what it cost to look at.

That's the question this article answers, for 50 popular websites, in 50 countries. I loaded each site twice in a real browser on an emulated phone: once as a first-time visitor and once as a returning one. I counted every byte, separated the JavaScript that ran from the JavaScript that didn't, and priced the result against mobile data prices and average incomes. Here's what came back:

- **35 of the 50 sites could be measured.** Fourteen blocked a headless browser and one timed out.
- **The median first visit downloaded 3.58 MB.** JavaScript was 45% of all the bytes, more than images, video and fonts put together.
- **About 57% of that JavaScript didn't run during load.**
- **1 GB of mobile data costs 34 hours of average work in Zimbabwe, 1.3 hours in Ethiopia, 8.4 minutes in the United States, and 2.7 seconds in Israel.**
- **For people who come back every day, the repeat visit is the real bill, not the first one.** The Google homepage is the clearest example.

Everything here is reproducible. The code, the data and a monthly re-measurement job are in [**github.com/Ernesto-tha-great/js-data-cost**](https://github.com/Ernesto-tha-great/js-data-cost):

```bash
git clone https://github.com/Ernesto-tha-great/js-data-cost.git
cd js-data-cost
npm install
npx playwright install chromium
npm test          # 12 tests, including a real browser against a local page
npm run report    # rebuilds every table and chart from the committed data
```

By the end, you'll have a CI check that fails a pull request when your page costs too much in the countries you care about.

## Table of contents

1. [Kilobytes are a taxi meter](#kilobytes-are-a-taxi-meter)
2. [Step 1: Count bytes the way a carrier would](#step-1-count-bytes-the-way-a-carrier-would)
3. [Step 2: Find the JavaScript that didn't run](#step-2-find-the-javascript-that-didnt-run)
4. [Step 3: Come back like a person would](#step-3-come-back-like-a-person-would)
5. [Step 4: Turn bytes into money, then into time](#step-4-turn-bytes-into-money-then-into-time)
6. [What 35 sites download](#what-35-sites-download)
7. [What it costs, in 50 countries](#what-it-costs-in-50-countries)
8. [The repeat visit is the real bill](#the-repeat-visit-is-the-real-bill)
9. [Three fixes, priced](#three-fixes-priced)
10. [A performance budget in money](#a-performance-budget-in-money)
12. [Run it yourself](#run-it-yourself)

## Kilobytes are a taxi meter

Loading a web page is like taking a taxi with the meter running. The passenger pays for every kilometre, but the driver picks the route. On the web, we're the drivers: we decide how many bytes a page needs. Our users are the passengers, and they pay per gigabyte. The rate on the meter depends on which city you're in, and a fare that's pocket change in one city is a day's lunch in another. A regular passenger costs less, because the driver knows the shortcuts. That's your cache.

Here's where the analogy breaks: in a taxi, the passenger can see the meter. Nobody loading your page can. So someone else has to watch it, and by the end of this article that someone will be a CI job.

![Each site is loaded twice in Chromium: a first visit with an empty cache, a trip to about:blank, then a repeat visit with the same cache. The measurements are joined with prices and income to produce the report, and the same steps power a budget check.](images/method.svg)

The measuring is done by [Playwright](https://playwright.dev) and a bit of the Chrome DevTools Protocol. It happens in three steps, and each one has a trap.

## Step 1: Count bytes the way a carrier would

The obvious tool is the browser's own [Resource Timing API](https://www.w3.org/TR/resource-timing/): every `PerformanceResourceTiming` entry has a `transferSize`. The trap is in the spec. For a cross-origin resource, `transferSize` is **zero** unless the server sends a `Timing-Allow-Origin` header. Many third-party scripts and ad servers don't (the big public CDNs mostly do). So measuring from inside the page undercounts exactly the bytes you have the least control over.

So measure from outside the page. Chrome's network stack reports, for every request, how many bytes actually came over the wire: the [`Network.loadingFinished`](https://chromedevtools.github.io/devtools-protocol/tot/Network/#event-loadingFinished) event's `encodedDataLength`. That number is compressed, includes headers, and doesn't care about origins. It leaves out uploads and TLS overhead, so it's close to what a carrier counts rather than identical, but it's the closest thing a browser has to the meter.

Playwright gives you a raw DevTools session, so a tracker is a few event listeners ([`src/measure.ts`](https://github.com/Ernesto-tha-great/js-data-cost/blob/main/src/measure.ts)):

```ts
class TransferTracker {
  private types = new Map<string, string>();
  private inflight = new Set<string>();
  private stats: LoadStats = { bytes: 0, requests: 0, byType: {} };
  lastActivity = Date.now();

  constructor(cdp: CDPSession) {
    cdp.on('Network.requestWillBeSent', (e) => {
      this.inflight.add(e.requestId);
      this.lastActivity = Date.now();
    });
    cdp.on('Network.responseReceived', (e) => {
      this.types.set(e.requestId, e.type ?? 'Other');
    });
    cdp.on('Network.loadingFinished', (e) => {
      this.inflight.delete(e.requestId);
      this.lastActivity = Date.now();
      const type = this.types.get(e.requestId) ?? 'Other';
      this.stats.bytes += e.encodedDataLength;
      this.stats.requests += 1;
      this.stats.byType[type] = (this.stats.byType[type] ?? 0) + e.encodedDataLength;
    });
    // loadingFailed also clears inflight
  }

  get busy(): boolean {
    return this.inflight.size > 0;
  }

  // takeStats() returns the counters and resets them
}
```

The second trap is deciding when a page has *finished* loading. The `load` event fires long before the analytics, the chat widget and the lazy hero image have finished arriving. Playwright's `networkidle` option looks like the answer, but its own docs mark it **discouraged**. It waits for 500 ms with no network connections, a gap that can open between two polls of a chatty page, or never open at all on a page that holds a connection. So the tracker keeps its own count of requests in flight, and a small loop waits for two seconds of silence, with a 15-second cap for the pages that never stop talking:

```ts
async function settle(tracker: TransferTracker, quietMs: number, maxMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (!tracker.busy && Date.now() - tracker.lastActivity >= quietMs) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
```

Each site gets a fresh browser context with Playwright's Moto G4 profile (a phone-sized screen and a phone's user agent) and `en-US` as the locale. Nothing scrolls, nothing clicks "accept", nobody logs in. What gets counted is what arrives before anyone touches the screen.

## Step 2: Find the JavaScript that didn't run

Counting JavaScript bytes is easy: they're the `Script` bucket in `byType`. Knowing how much of it *ran* needs V8's code coverage, which Playwright exposes for Chromium as `page.coverage`:

```ts
await page.coverage.startJSCoverage({ resetOnNavigation: false });
const response = await page.goto(site.url, { waitUntil: 'load', timeout: timeoutMs });
await settle(tracker, quietMs, maxSettleMs);
const coverage = await page.coverage.stopJSCoverage();
```

V8 reports coverage as ranges with execution counts. They nest: there's a range for the whole script, then one for each function inside it, then ranges for blocks whose count differs from their parent's, such as a branch that was never taken. The trap is that the outer range almost always has a count of 1, because the script *was* evaluated, even when most of the functions inside it never ran. Count only the top level and every script looks 100% used.

The fix is to paint the ranges in order, so each inner range overwrites its parent ([`src/coverage.ts`](https://github.com/Ernesto-tha-great/js-data-cost/blob/main/src/coverage.ts)):

```ts
export function executedBytes(entry: CoverageEntry): { total: number; used: number } {
  const total = entry.source?.length ?? 0;
  if (total === 0) return { total: 0, used: 0 };

  const ran = new Uint8Array(total);
  for (const fn of entry.functions) {
    for (const range of fn.ranges) {
      ran.fill(range.count > 0 ? 1 : 0, range.startOffset, Math.min(range.endOffset, total));
    }
  }

  let used = 0;
  for (const byte of ran) used += byte;
  return { total, used };
}
```

There's a unit test with a script that ran, a function inside it that didn't, and a branch inside a function that ran but was never taken. It checks that only the right 55 of 100 characters count as used.

This number comes with two caveats. First, coverage measures *source characters*, but the network delivered *compressed bytes*. I apply the unused share to the bytes on the wire, which makes the result an estimate. Second, "didn't run during load" isn't the same as "dead code". Some of it runs when someone opens a menu. The point is that it didn't need to arrive *first*.

## Step 3: Come back like a person would

A first visit is only half the story. Plenty of people open sites like these every day, and from the second visit on, the cache does most of the work. So after the first visit, the same browser context loads the site again, with the same cache.

The trap here cost me an evening, though not in the way I expected. My first local test page had an "image" that was really a few bytes of text with a `.jpg` name. Chrome gave up on it, so there was nothing to cache, and the repeat visit downloaded it again. I'd half-written a paragraph about caching not working before I worked out that the test was lying, not the cache. A cache can only keep what arrived whole. The fixture now uses a real script and stylesheet.

Between the two visits, the script takes a detour through `about:blank`, the way a person leaves and comes back. It isn't load-bearing: modern Chrome only revalidates the HTML on a reload anyway. It just keeps the second load an ordinary navigation:

```ts
// Leave and come back, like a person would. (Chrome only revalidates the
// HTML on a reload anyway; the detour keeps this an ordinary navigation.)
await page.goto('about:blank');
tracker.takeStats();
await page.goto(site.url, { waitUntil: 'load', timeout: timeoutMs });
await settle(tracker, quietMs, maxSettleMs);
result.warm = tracker.takeStats();
```

The test suite checks this against a local page with a cacheable script and stylesheet: on the repeat visit, only the HTML is downloaded again.

## Step 4: Turn bytes into money, then into time

Prices come from Cable.co.uk's [Worldwide Mobile Data Pricing](https://www.cable.co.uk/mobiles/worldwide-data-pricing/) table, which gives the average price of 1 GB across the plans on sale in 237 countries and territories. The latest edition it publishes is from 2023, and the fetch script records that. I price in binary gigabytes (2³⁰ bytes). Many carriers count that way. If yours counts 10⁹ bytes, everything below is about 7% more expensive.

My first version of the report divided a month of each site's cost by average monthly income. It printed **0.000%** for half the countries. That was true and useless: nobody uses only one website, and a percentage with three zeros after the point doesn't make anyone change a build config.

Time works better. The World Bank publishes [GNI per capita](https://data.worldbank.org/indicator/NY.GNP.PCAP.CD) for most countries (the figures here are for 2025, and 2024 for the United Arab Emirates). Spread over a 2,080-hour working year (40 hours a week, 52 weeks), that's an average hourly income, and any price can be turned into how long someone works to pay it ([`src/cost.ts`](https://github.com/Ernesto-tha-great/js-data-cost/blob/main/src/cost.ts)):

```ts
export const BYTES_PER_GB = 2 ** 30;
export const VISITS_PER_MONTH = 150; // five a day: 1 first visit, 149 repeat visits
export const WORK_HOURS_PER_YEAR = 2080;

export function costUsd(bytes: number, usdPerGb: number): number {
  return (bytes / BYTES_PER_GB) * usdPerGb;
}

export function monthlyBytes(coldBytes: number, warmBytes: number): number {
  return coldBytes + (VISITS_PER_MONTH - 1) * warmBytes;
}

export function workSeconds(usd: number, gniPerCapitaUsd: number): number {
  return usd / (gniPerCapitaUsd / WORK_HOURS_PER_YEAR / 3600);
}
```

GNI per capita is an average, not a wage, and it flatters any country with a wide gap between rich and poor. The real figure for the person on the bus is worse. Treat every work time below as a floor.

## What 35 sites download

The list of 50 sites is in [`sites.json`](https://github.com/Ernesto-tha-great/js-data-cost/blob/main/sites.json): search engines, social networks, shops, news, streaming, travel and developer tools. Fourteen of them wouldn't let a headless browser on a datacentre IP through: X, Reddit, LinkedIn, eBay, Stack Overflow, Medium and Canva were among the sites that served a bot wall. AliExpress timed out. All 15 are excluded rather than counted at the size of a "Just a moment..." page.

The run analysed here happened on 8 October 2026, on a GitHub Actions runner in Azure's East US 2 region, in Chromium 141.

![First-visit download size of 35 popular sites. Each bar is split into JavaScript that ran during load, JavaScript that didn't, and everything else. CNN is heaviest at 14.63 MB; the median is 3.58 MB.](images/site-weights.svg)

The median first visit was **3.58 MB**. The median repeat visit was **0.19 MB**, 19 times less. Across all 35 sites, JavaScript was the largest resource type by a distance:

| Resource type | Share of first-visit bytes |
|---|---:|
| Script | 45.3% |
| Image | 21.5% |
| Media (video, audio) | 10.6% |
| Font | 6.2% |
| Fetch (API calls) | 6.1% |
| Document (HTML) | 4.2% |
| Stylesheet | 2.7% |
| XHR (older API calls) | 2.6% |
| Everything else | 0.9% |

On 21 of the 35 sites, JavaScript was more than half of everything downloaded. The median site sent 1.46 MB of it, compressed, and an estimated **57%** of all the JavaScript didn't run during load. That's a quarter of all first-visit bytes (25.7%) arriving to do nothing yet.

The heaviest page wasn't heavy because of JavaScript, though. CNN's homepage downloaded 14.63 MB, and 11.38 MB of that was video, downloaded before anyone pressed play. That's my landing page from the opening, at scale, and it's why the first fix later on is about video.

## What it costs, in 50 countries

![How long someone on average income works to pay for 1 GB of mobile data in 50 countries, on a log scale: from 34 hours in Zimbabwe to 2.7 seconds in Israel.](images/work-time.svg)

The chart has a log scale because nothing else fits. The most expensive gigabyte, in Zimbabwe, costs about 46,000 times more work than the cheapest, in Israel. Both ends are unusual prices, so here's a fairer comparison: leave Zimbabwe out, and a gigabyte in Tanzania still costs about 1,860 times more work than one in Israel. Here's a slice of the [full table](https://github.com/Ernesto-tha-great/js-data-cost/blob/main/results/report.md):

| Country | 1 GB | 1 GB in work time | Median site, first visit | CNN, first visit |
|---|---:|---:|---:|---:|
| Zimbabwe | $43.75 | 34 h | 6.8 min | 28 min |
| Ethiopia | $0.68 | 1.3 h | 15 s | 1.0 min |
| South Africa | $1.81 | 36 min | 7.2 s | 29 s |
| Kenya | $0.59 | 33 min | 6.7 s | 27 s |
| United States | $6.00 | 8.4 min | 1.7 s | 6.9 s |
| India | $0.16 | 7.2 min | 1.4 s | 5.9 s |
| Brazil | $0.40 | 4.7 min | 0.9 s | 3.9 s |
| Germany | $2.14 | 4.4 min | 0.9 s | 3.6 s |
| United Kingdom | $0.62 | 1.4 min | 0.3 s | 1.2 s |
| Israel | $0.02 | 2.7 s | < 0.1 s | < 0.1 s |

A cheap gigabyte isn't the same as an affordable one. Data in Ethiopia costs about a ninth of the US price, yet the same gigabyte takes nine times more work, because incomes differ far more than prices do. Zimbabwe's price is an outlier in the source data, so check it before you quote it. Even leaving Zimbabwe out, loading CNN's homepage once costs about a minute of work in Ethiopia.

A few seconds per page sounds harmless, and for one person and one page it is. Teams don't ship to one person, though. The report also prices the median site's unused JavaScript (0.94 MB per first visit) per **million first visits**, which is a number a product team can hold in its head:

| Users in… | What a million first visits spend on JavaScript that didn't run |
|---|---:|
| Kenya | $514 |
| South Africa | $1,577 |
| Germany | $1,865 |
| United States | $5,229 |
| Zimbabwe | $38,127 |

None of that appears on any dashboard you own. Your users pay it, a fraction of a cent at a time.

## The repeat visit is the real bill

This is the finding I didn't expect. To price "using a site", the report models a month as five visits a day: one first visit and 149 repeat visits. Under that model, across all 35 sites, **94% of a month's bytes come from repeat visits**. Even at one visit a day, it's still about three quarters.

So the question that matters for regular users isn't "how big is the first visit?" It's "what does a repeat visit download *again*?" Ranked by a month of use, the list reshuffles:

| Site | First visit | Repeat visit | A month (5 visits a day) | Biggest thing downloaded again |
|---|---:|---:|---:|---|
| Figma | 5.78 MB | 2.69 MB | 406 MB | 2.58 MB of XHR |
| Yahoo | 5.74 MB | 2.01 MB | 305 MB | 1.16 MB of script |
| Nike | 5.84 MB | 1.04 MB | 161 MB | 0.60 MB of images |
| WhatsApp | 1.69 MB | 0.97 MB | 146 MB | 0.92 MB of images |
| CNN | 14.63 MB | 0.63 MB | 108 MB | 0.62 MB of HTML |
| Google | 0.93 MB | 0.69 MB | 104 MB | 0.68 MB of script |

Google's homepage is one of the lightest first visits in the study, and a month of it costs about as much as a month of CNN, the heaviest. The reason is that its repeat visit downloads 0.68 MB of script again.

I haven't dug into *why* each of these sites downloads things again. Some of it is personalised and deliberately uncacheable, and some of it is probably a trade-off someone made for a good reason. The point is that a team watching first-visit size would never see any of it.

## Three fixes, priced

These are upper bounds calculated from the measurements: what each fix would save if it worked perfectly. They aren't experiments on other people's sites, and I can't tell you what each team's constraints are.

**1. Don't autoplay video on the first screen.** CNN's 11.38 MB of video was 78% of its first visit. Without it, the page drops to 3.25 MB, and the cost in Kenya falls from 27 seconds of work to about 6. The fix is a single attribute and a decision:

```html
<video controls preload="none" poster="/clips/launch-poster.jpg">
  <source src="/clips/launch.mp4" type="video/mp4" />
</video>
```

`preload="none"` tells the browser not to fetch anything until someone presses play, and the poster image stands in until then. Drop `autoplay` too, which overrides it. (I'd like to say I did this to my landing page right away. I did it a week later, after the second screenshot.)

**2. Ship what runs; fetch the rest when it's needed.** Across the 35 sites, about 35 MB of JavaScript arrived and didn't run during load. A dynamic `import()` moves code out of the first download and into the moment someone needs it:

```js
editButton.addEventListener('click', async () => {
  const { openEditor } = await import('./editor.js');
  openEditor();
}, { once: true });
```

Vite and webpack turn that into a separate file by default; esbuild does it with `splitting: true`. Run the coverage step against your own page to find candidates: anything big that shows up as unused during load is one.

**3. Make repeat visits nearly free.** Give fingerprinted assets (files whose names change when their contents do, like `app.3f9a2c.js`) a long cache lifetime, and let only the HTML revalidate:

```http
# app.3f9a2c.js, styles.81b0e4.css, fonts, images
Cache-Control: public, max-age=31536000, immutable

# the HTML document
Cache-Control: no-cache
```

The long `max-age` does the work. `immutable` only matters when someone refreshes: it stops Firefox and Safari from revalidating, and Chrome already skips that for everything but the HTML.

The report works out the upper bound for every site: the month if every script, image, font, stylesheet and video file on the repeat visit came from the cache. Google's month would drop from 104 MB to about 4 MB, and Yahoo's from 305 MB to about 105 MB (the rest is API calls and HTML). Figma's wouldn't move at all, because what it downloads again is 2.58 MB of API data, and no cache header fixes that. That's a design conversation, not a config change.

## A performance budget in money

Performance budgets usually say things like "the main bundle must be under 170 KB". That's a fine rule, but it doesn't mean much to anyone outside the team. "A first visit must cost less than five seconds of work in Kenya, India and Brazil" means something to a product manager, and you can enforce it.

`npm run budget` runs Steps 1 to 3 against any URL, prices the result, and exits with 1 when the page costs more than you allowed. You can set limits in dollars for a first visit, in seconds of work for a first visit, or in dollars for a month of use:

```json
{
  "url": "https://en.wikipedia.org/wiki/Main_Page",
  "budgets": [
    { "country": "Kenya", "maxFirstVisitWorkSeconds": 5, "maxMonthlyUsd": 0.05 },
    { "country": "India", "maxFirstVisitWorkSeconds": 5, "maxMonthlyUsd": 0.05 },
    { "country": "Brazil", "maxFirstVisitWorkSeconds": 5, "maxMonthlyUsd": 0.05 }
  ]
}
```

The check itself is a pure function, so it's tested without a browser ([`src/budget.ts`](https://github.com/Ernesto-tha-great/js-data-cost/blob/main/src/budget.ts)):

```ts
export function checkBudget(load: { coldBytes: number; warmBytes: number }, lines: readonly BudgetLine[], market: Market): BudgetResult[] {
  return lines.map((line) => {
    const price = market.priceFor(line.country);
    if (price === undefined) {
      return { country: line.country, firstVisitUsd: null, firstVisitWorkSeconds: null, monthlyUsd: null, failures: ['no price data'] };
    }
    const firstVisitUsd = costUsd(load.coldBytes, price);
    const monthlyUsd = costUsd(monthlyBytes(load.coldBytes, load.warmBytes), price);
    const income = market.incomeFor(line.country);
    const firstVisitWorkSeconds = income ? workSeconds(firstVisitUsd, income.gni) : null;

    const failures: string[] = [];
    if (line.maxFirstVisitUsd !== undefined && firstVisitUsd > line.maxFirstVisitUsd) failures.push('first visit');
    if (line.maxFirstVisitWorkSeconds !== undefined) {
      if (firstVisitWorkSeconds === null) failures.push('no income data');
      else if (firstVisitWorkSeconds > line.maxFirstVisitWorkSeconds) failures.push('work time');
    }
    if (line.maxMonthlyUsd !== undefined && monthlyUsd > line.maxMonthlyUsd) failures.push('month');
    return { country: line.country, firstVisitUsd, firstVisitWorkSeconds, monthlyUsd, failures };
  });
}
```

The repo runs it on every pull request ([`.github/workflows/budget.yml`](https://github.com/Ernesto-tha-great/js-data-cost/blob/main/.github/workflows/budget.yml), trimmed):

```yaml
name: budget
on:
  pull_request:

jobs:
  budget:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run budget -- budget.example.json
```

To use it in your own project, copy `src/`, `scripts/budget.ts`, `countries.json` and `data/`, add the `budget` script from `package.json`, install `playwright` and `tsx`, and write your own `budget.json`. Point its `url` at a preview deployment of the pull request rather than at production. Otherwise you're measuring the code you already shipped.

Here's the same budget, run in GitHub Actions, against Wikipedia's Main Page and then against CNN's homepage:

```text
https://en.wikipedia.org/wiki/Main_Page
first visit 0.59 MB, repeat visit 0.18 MB

✓ Kenya           first visit 0.03¢ (1.1 s of work), a month $0.02
✓ India           first visit < 0.01¢ (0.2 s of work), a month 0.41¢
✓ Brazil          first visit 0.02¢ (0.2 s of work), a month $0.01
```

```text
https://www.cnn.com/
first visit 17.03 MB, repeat visit 0.01 MB

✗ Kenya           first visit 0.94¢ (32 s of work), a month $0.01  over budget: work time
✗ India           first visit 0.25¢ (6.9 s of work), a month 0.28¢  over budget: work time
✓ Brazil          first visit 0.63¢ (4.5 s of work), a month 0.70¢
```

Look at CNN's numbers next to the study's: 17.03 MB here against 14.63 MB in the measurement run about 20 minutes earlier, and a repeat visit of 0.01 MB instead of 0.63 MB. Wikipedia moved too, from 0.63 MB to 0.59 MB. Pages with video and ads change from one load to the next. If you budget a page like that, measure it a few times and budget against the median, or the check will fail at random and people will learn to ignore it.

## Run it yourself

```bash
git clone https://github.com/Ernesto-tha-great/js-data-cost.git
cd js-data-cost
npm install
npx playwright install chromium

npm test                                   # 12 tests
npm run fetch:prices && npm run fetch:income
npm run measure                            # all 50 sites, about 15 minutes
npm run measure -- wikipedia               # just one site, saved to its own file
npm run report

cp budget.example.json budget.json         # point it at your page
npm run budget -- budget.json
```

I started this because of one video on one landing page. I finished it with a CI check that would have caught that video before my friend did.
