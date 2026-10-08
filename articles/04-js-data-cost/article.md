# The Mobile Data Cost of Web Pages: Pricing 35 Popular Websites in 50 Countries

*In this tutorial, we build a tool with Playwright that measures what a web page downloads, prices it in mobile data and in minutes of work across 50 countries, and fails a pull request when a page costs too much. Then we try it on 50 popular websites.*

**Ernest Nnamdi** · JavaScript · Web performance · Playwright · TypeScript

---

A while back, I flew to Nairobi to speak at a developer conference. Like I do on every trip, I bought a local SIM at the airport with a small data bundle to get me through the first couple of days. By lunch the next day, it was gone. I hadn't watched a single video. I'd checked the conference schedule, read a few news sites, opened some docs and replied to messages.

I've been building for the web for years, and I knew pages were getting heavier, in theory. I knew our Lighthouse scores. I knew how many kilobytes our main bundle was. But I had never once asked what any of it cost the person on the other end, in actual money.

The TL;DR of it is that we measure pages in kilobytes and milliseconds, and the people loading them pay per gigabyte. How much that hurts depends on where they live. A gigabyte that costs a few minutes of work in one country can cost hours in another.

In this tutorial, I'm going to show you how to build a small tool that measures exactly what a web page downloads, counted the way a carrier would count it, and puts a price on it in 50 countries: in dollars, and in how long someone on an average income has to work to pay for it. Then we'll turn it into a check that fails a pull request when a page costs too much. At the end, I'll show you what I found when I ran it on 50 popular websites.

### Okay, but isn't mobile data cheap now?

In some places, very. According to Cable.co.uk's [Worldwide Mobile Data Pricing](https://www.cable.co.uk/mobiles/worldwide-data-pricing/) table, 1 GB costs about $0.16 in India and $0.02 in Israel. It also costs $6.00 in the United States and $43.75 in Zimbabwe.

Price is only half of it, though. Think of a taxi with the meter running. The passenger pays for every kilometre, but the driver picks the route. On the web, we're the drivers: we decide how many bytes a page needs. Our users are the passengers, and the rate on the meter depends on where they are, and on what they earn. So to know what a page really costs someone, we need two numbers: what a gigabyte costs where they live, and what they earn.

### Sounds good, but why not just use Lighthouse?

Lighthouse is great, and you should keep using it. It'll tell you your total byte weight and flag JavaScript you don't use. What it won't do is come back to the page a second time to see what a returning visitor downloads, or tell you what any of it costs in Kenya. (Tim Kadlec's [What Does My Site Cost?](https://whatdoesmysitecost.com) has been pricing pages for years, and it inspired this project.) Our tool will do all of it, and it's small enough to understand completely.

That being said, let's get to building!

## Prerequisites

- Node.js 22 or newer
- Some familiarity with TypeScript
- A terminal (on Windows, use Git Bash or WSL)
- A GitHub repository, if you want to run the budget check on pull requests at the end

## What Are We Building?

We'll build:

- a script that loads any URL in Chromium, the way a phone would, and counts every byte it downloads
- a way to tell how much of that JavaScript actually ran
- a second visit to the same page, to see what a returning visitor downloads again
- two scripts that download mobile data prices and average incomes for 50 countries
- a script that prices any page in the countries you name, in dollars and in minutes of work
- a performance budget in money, and a GitHub Actions workflow that runs it on every pull request

Here's what the project will look like when we're done:

```text
js-data-cost/
  src/
    measure.ts          # loads a page twice and counts every byte
    coverage.ts         # how much of the JavaScript ran
    data.ts             # prices and incomes, by country
    cost.ts             # bytes to dollars to minutes of work
    budget.ts           # checks a page against a budget
  scripts/
    measure.ts          # measures one URL
    fetch-prices.ts     # the price of 1 GB in each country
    fetch-income.ts     # average income in each country
    cost.ts             # prices one URL in the countries you name
    budget.ts           # the budget check
  data/
    prices.csv          # the price of 1 GB, by country
    income.csv          # GNI per capita, by country
  countries.json        # our 50 countries
  budget.json           # your budget
  .github/workflows/
    budget.yml          # runs the budget check on pull requests
```

## Step 1: Setting Up Our Project

Let's start by creating a folder for the project and installing what we need.

```bash
mkdir js-data-cost
cd js-data-cost
npm init -y
npm install playwright
npm install --save-dev typescript tsx @types/node
npx playwright install chromium
```

That last command downloads the Chromium build Playwright drives. On Linux, if Chromium complains about missing libraries later, run `npx playwright install --with-deps chromium` instead.

Open the folder in your code editor. In package.json, add `"type": "module"` and replace the `scripts` section, so those two parts look like this (leave the rest of the file, like your dependencies, as it is):

```json
{
  "type": "module",
  "scripts": {
    "measure": "tsx scripts/measure.ts",
    "fetch:prices": "tsx scripts/fetch-prices.ts",
    "fetch:income": "tsx scripts/fetch-income.ts",
    "cost": "tsx scripts/cost.ts",
    "budget": "tsx scripts/budget.ts",
    "typecheck": "tsc --noEmit"
  }
}
```

Finally, create a tsconfig.json file in the root of the project:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "moduleDetection": "force",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "exclude": ["node_modules"]
}
```

## Step 2: Counting Bytes Like a Carrier Would

The first thing we need is an honest count of the bytes a page downloads. There are two traps here.

The first one is the obvious tool. Browsers have a [Resource Timing API](https://www.w3.org/TR/resource-timing/), and every entry in it has a `transferSize`. But for a resource from another origin, `transferSize` is zero unless that server sends a `Timing-Allow-Origin` header, and plenty of third-party scripts and ad servers don't. So if you measure from inside the page, you undercount exactly the bytes you have the least control over.

So we'll measure from outside the page instead. Chrome's DevTools Protocol fires a [`Network.loadingFinished`](https://chromedevtools.github.io/devtools-protocol/tot/Network/#event-loadingFinished) event for every request, and its `encodedDataLength` is described as the:

> Total number of bytes received for this request.

In other words, it's the compressed size that came over the network, headers included, from any origin. It leaves out uploads and TLS overhead, so it's close to what a carrier counts rather than identical, but it's the closest thing a browser has to the meter.

The second trap is knowing when a page has *finished* loading. The `load` event fires long before the analytics, the chat widget and the lazy hero image arrive. Playwright has a `networkidle` option that looks like the answer, but here's how [its own docs](https://playwright.dev/docs/api/class-page#page-goto) describe it:

> `'networkidle'` - **DISCOURAGED** consider operation to be finished when there are no network connections for at least `500` ms. Don't use this method for testing, rely on web assertions to assess readiness instead.

In other words, even Playwright doesn't trust it. A chatty page can go quiet for half a second between two requests, and a page that holds a connection open never goes quiet at all. So we'll keep our own count of the requests in flight, and wait for two seconds of silence, with a 15-second cap for the pages that never stop talking.

Create a folder called src, and in it, a file called measure.ts. Paste in the code below (it's also in [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/04-js-data-cost/gists/step-2-measure.ts)):

```ts
import { devices, type Browser, type CDPSession } from 'playwright';

export interface LoadStats {
  /** Bytes over the wire, headers included, as Chrome's network stack counted them. */
  bytes: number;
  requests: number;
  byType: Record<string, number>;
}

export interface PageMeasurement {
  url: string;
  finalUrl: string | null;
  status: number | null;
  title: string | null;
  /** Bot walls, error pages and "access denied" screens. */
  blocked: boolean;
  /** The first visit, with an empty cache. */
  cold: LoadStats | null;
  error?: string;
}

export interface MeasureOptions {
  timeoutMs?: number;
  /** How long the network has to be quiet before we call the page "loaded". */
  quietMs?: number;
  /** The longest we'll wait for quiet, for pages that never stop talking. */
  maxSettleMs?: number;
}

const BLOCKED = /access denied|just a moment|attention required|are you a robot|captcha|unusual traffic|blocked/i;

/** Counts every byte Chrome receives, by resource type, and keeps track of what's still in flight. */
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
    cdp.on('Network.loadingFailed', (e) => {
      this.inflight.delete(e.requestId);
      this.lastActivity = Date.now();
    });
  }

  get busy(): boolean {
    return this.inflight.size > 0;
  }

  /** Returns the counts so far and starts again from zero. */
  takeStats(): LoadStats {
    const stats = this.stats;
    this.stats = { bytes: 0, requests: 0, byType: {} };
    this.inflight.clear();
    return stats;
  }
}

/** Waits until nothing has been in flight for `quietMs`, or until `maxMs` is up. */
async function settle(tracker: TransferTracker, quietMs: number, maxMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (!tracker.busy && Date.now() - tracker.lastActivity >= quietMs) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/**
 * Loads a page the way someone on a phone would, with an empty cache. No
 * scrolling, no clicking "accept": just what arrives before anyone touches
 * the screen.
 */
export async function measurePage(browser: Browser, url: string, options: MeasureOptions = {}): Promise<PageMeasurement> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const quietMs = options.quietMs ?? 2_000;
  const maxSettleMs = options.maxSettleMs ?? 15_000;

  const context = await browser.newContext({ ...devices['Moto G4'], locale: 'en-US' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const tracker = new TransferTracker(cdp);

  const result: PageMeasurement = { url, finalUrl: null, status: null, title: null, blocked: false, cold: null };

  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    await settle(tracker, quietMs, maxSettleMs);

    result.status = response?.status() ?? null;
    result.finalUrl = page.url();
    result.title = await page.title();
    result.blocked = (result.status ?? 0) >= 400 || BLOCKED.test(result.title);
    result.cold = tracker.takeStats();
  } catch (err) {
    result.error = err instanceof Error ? err.message.split('\n')[0] : String(err);
  } finally {
    await context.close();
  }
  return result;
}
```

Let's go through it:

- `TransferTracker` listens to four events on a DevTools session. `requestWillBeSent` adds a request to the in-flight set, `responseReceived` remembers its type (Script, Image, Document and so on), and `loadingFinished` adds its `encodedDataLength` to the totals. `loadingFailed` just takes it out of the in-flight set.
- `settle` checks every 200 ms whether anything is still in flight, and returns once the network has been quiet for `quietMs`.
- `measurePage` opens a fresh browser context with Playwright's Moto G4 profile (a phone-sized screen and a phone's user agent) and `en-US` as the locale, loads the page, waits for it to settle and keeps the counts. We don't scroll, accept cookie banners or log in, so we only count what loads before anyone touches the screen.
- `BLOCKED` catches bot walls and error pages. Some sites don't like headless browsers, and you don't want to count a "Just a moment..." page as the real thing.

Now we need a way to run it. Create a folder called scripts, and in it, a file called measure.ts:

```ts
/**
 * Measures one page and prints what it downloaded.
 *
 *   npm run measure -- https://en.wikipedia.org/wiki/Main_Page
 */
import { chromium } from 'playwright';
import { measurePage, type LoadStats } from '../src/measure';

const url = process.argv[2];
if (!url) {
  console.error('Usage: npm run measure -- <url>');
  process.exit(1);
}

const browser = await chromium.launch();
const result = await measurePage(browser, url);
await browser.close();

if (result.error || !result.cold) {
  console.error(`Couldn't measure ${url}: ${result.error}`);
  process.exit(2);
}

const size = (bytes: number) => (bytes < 10_000 ? `${(bytes / 1e3).toFixed(1)} KB` : `${(bytes / 1e6).toFixed(2)} MB`);
const byType = (stats: LoadStats) =>
  Object.entries(stats.byType)
    .filter(([, bytes]) => bytes > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([type, bytes]) => `  ${type.padEnd(14)}${size(bytes).padStart(9)}`)
    .join('\n');

console.log(`${result.finalUrl} (${result.status}, "${result.title}")`);
if (result.blocked) console.log("This looks like a bot wall or an error page, not the real thing.");
console.log(`\nfirst visit    ${size(result.cold.bytes)} in ${result.cold.requests} requests`);
console.log(byType(result.cold));
```

Run `npm run typecheck` to make sure everything compiles. Apart from npm's own two lines at the top, it shouldn't print anything. You can do this after every step.

Now let's measure Wikipedia's Main Page:

```bash
npm run measure -- https://en.wikipedia.org/wiki/Main_Page
```

```text
https://en.wikipedia.org/wiki/Main_Page (200, "Wikipedia, the free encyclopedia")

first visit    0.58 MB in 30 requests
  Script          0.35 MB
  Image           0.15 MB
  Document        0.05 MB
  Stylesheet      0.03 MB
  Ping             2.6 KB
```

Your numbers will be a little different from mine, because websites change all the time and every run is a real visit. That's fine.

Depending on where you run it from, some sites will show you a bot wall instead of the real page. Here's what LinkedIn gave me when I ran it from a GitHub Actions runner:

```text
https://www.linkedin.com/ (403, "Attention Required! | Cloudflare")
This looks like a bot wall or an error page, not the real thing.

first visit    0.01 MB in 4 requests
  Stylesheet       4.5 KB
  Image            4.0 KB
  Document         2.3 KB
```

## Step 3: Finding the JavaScript That Didn't Run

Counting JavaScript bytes is easy now: they're the `Script` line. Knowing how much of that JavaScript actually *ran* needs V8's code coverage, which Playwright exposes for Chromium as `page.coverage`.

V8 reports coverage as ranges with execution counts, and they nest. There's a range for the whole script, then one for each function inside it, then ranges for blocks whose count differs from their parent's, like a branch that was never taken. The problem is that the outer range almost always has a count of 1, because the script *was* evaluated, even when most of the functions inside it never ran. Count only the top level, and every script looks 100% used.

The fix is to paint the ranges in order, so each inner range overwrites its parent. In the src folder, create coverage.ts and paste in the code from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/04-js-data-cost/gists/coverage.ts):

```ts
/** The shape Playwright's page.coverage.stopJSCoverage() returns (V8 block coverage). */
export interface CoverageRange {
  startOffset: number;
  endOffset: number;
  count: number;
}

export interface CoverageEntry {
  url: string;
  source?: string;
  functions: Array<{ ranges: CoverageRange[] }>;
}

/**
 * How much of a script actually ran. V8 reports nested ranges with the outer
 * range first, so painting them in order lets each inner range overwrite its
 * parent: a function that never ran is 0 even inside a script that did.
 */
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

export function summariseCoverage(entries: readonly CoverageEntry[]): { sourceBytes: number; usedBytes: number } {
  let sourceBytes = 0;
  let usedBytes = 0;
  for (const entry of entries) {
    const { total, used } = executedBytes(entry);
    sourceBytes += total;
    usedBytes += used;
  }
  return { sourceBytes, usedBytes };
}
```

`executedBytes` makes an array with one slot per character of the script, then goes through every range and marks its characters as ran (1) or didn't (0). Because inner ranges come after their parents, a function that never ran ends up as zeros even inside a script that did. `summariseCoverage` adds it up across every script on the page.

Now let's use it. At the top of src/measure.ts, add this import:

```ts
import { summariseCoverage } from './coverage';
```

In the `PageMeasurement` interface, add this right below `cold`:

```ts
  /** JavaScript on the first visit: bytes on the wire, and characters of source that did and didn't run. */
  js: { transferred: number; sourceBytes: number; usedBytes: number } | null;
```

Then replace the whole `measurePage` function, including the comment above it, with this:

```ts
/**
 * Loads a page the way someone on a phone would, with an empty cache. No
 * scrolling, no clicking "accept": just what arrives before anyone touches
 * the screen.
 */
export async function measurePage(browser: Browser, url: string, options: MeasureOptions = {}): Promise<PageMeasurement> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const quietMs = options.quietMs ?? 2_000;
  const maxSettleMs = options.maxSettleMs ?? 15_000;

  const context = await browser.newContext({ ...devices['Moto G4'], locale: 'en-US' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const tracker = new TransferTracker(cdp);

  const result: PageMeasurement = { url, finalUrl: null, status: null, title: null, blocked: false, cold: null, js: null };

  try {
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    const response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    await settle(tracker, quietMs, maxSettleMs);
    const coverage = await page.coverage.stopJSCoverage();

    result.status = response?.status() ?? null;
    result.finalUrl = page.url();
    result.title = await page.title();
    result.blocked = (result.status ?? 0) >= 400 || BLOCKED.test(result.title);
    result.cold = tracker.takeStats();
    result.js = { transferred: result.cold.byType.Script ?? 0, ...summariseCoverage(coverage) };
  } catch (err) {
    result.error = err instanceof Error ? err.message.split('\n')[0] : String(err);
  } finally {
    await context.close();
  }
  return result;
}
```

Two things changed: we start coverage before the page loads and stop it once it settles, and we save the totals in `result.js`, together with the bytes of script that came over the wire.

Finally, add this to the end of scripts/measure.ts:

```ts
if (result.js && result.js.sourceBytes > 0) {
  const unused = 1 - result.js.usedBytes / result.js.sourceBytes;
  console.log(`\nJavaScript     ${size(result.js.transferred)}, and about ${Math.round(unused * 100)}% of it didn't run during load`);
}
```

Run it again:

```bash
npm run measure -- https://en.wikipedia.org/wiki/Main_Page
```

```text
https://en.wikipedia.org/wiki/Main_Page (200, "Wikipedia, the free encyclopedia")

first visit    0.58 MB in 29 requests
  Script          0.35 MB
  Image           0.15 MB
  Document        0.05 MB
  Stylesheet      0.03 MB
  Ping             0.9 KB

JavaScript     0.35 MB, and about 48% of it didn't run during load
```

That percentage comes with two caveats. First, coverage counts *characters of source code* (including scripts written inline in the HTML), but the network delivered *compressed bytes*. We apply the share to the script bytes on the wire, which makes it an estimate. Second, "didn't run during load" isn't the same as "dead code". Some of it runs later, when someone opens a menu, so it could also be downloaded later.

## Step 4: Coming Back Like a Person Would

A first visit is only half the story. Plenty of people open the same sites every day, and from the second visit on, the browser cache does most of the work. So after the first visit, we'll leave the page and load it again, in the same browser context, with the same cache.

In the `PageMeasurement` interface, add this right below `cold`:

```ts
  /** The repeat visit, with whatever the first visit cached. */
  warm: LoadStats | null;
```

Then replace `measurePage` one more time, again including the comment above it:

```ts
/**
 * Loads a page twice, the way someone on a phone would: once with an empty
 * cache, then again with whatever the first visit cached. No scrolling, no
 * clicking "accept": just what arrives before anyone touches the screen.
 */
export async function measurePage(browser: Browser, url: string, options: MeasureOptions = {}): Promise<PageMeasurement> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const quietMs = options.quietMs ?? 2_000;
  const maxSettleMs = options.maxSettleMs ?? 15_000;

  const context = await browser.newContext({ ...devices['Moto G4'], locale: 'en-US' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const tracker = new TransferTracker(cdp);

  const result: PageMeasurement = { url, finalUrl: null, status: null, title: null, blocked: false, cold: null, warm: null, js: null };

  try {
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    const response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    await settle(tracker, quietMs, maxSettleMs);
    const coverage = await page.coverage.stopJSCoverage();

    result.status = response?.status() ?? null;
    result.finalUrl = page.url();
    result.title = await page.title();
    result.blocked = (result.status ?? 0) >= 400 || BLOCKED.test(result.title);
    result.cold = tracker.takeStats();
    result.js = { transferred: result.cold.byType.Script ?? 0, ...summariseCoverage(coverage) };

    // Leave and come back, like a person would.
    await page.goto('about:blank');
    tracker.takeStats();
    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    await settle(tracker, quietMs, maxSettleMs);
    result.warm = tracker.takeStats();
  } catch (err) {
    result.error = err instanceof Error ? err.message.split('\n')[0] : String(err);
  } finally {
    await context.close();
  }
  return result;
}
```

Between the two visits, we go to `about:blank`, the way a person leaves and comes back, and throw away anything the tracker counted in between. Then we load the page again and keep that count as `warm`.

And add this to the end of scripts/measure.ts:

```ts
if (result.warm) {
  console.log(`\nrepeat visit   ${size(result.warm.bytes)} in ${result.warm.requests} requests`);
  console.log(byType(result.warm));
}
```

Phew! That's the whole measuring part. Your src/measure.ts should now look like [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/04-js-data-cost/gists/measure.ts). Let's run it:

```bash
npm run measure -- https://en.wikipedia.org/wiki/Main_Page
```

```text
https://en.wikipedia.org/wiki/Main_Page (200, "Wikipedia, the free encyclopedia")

first visit    0.58 MB in 29 requests
  Script          0.35 MB
  Image           0.15 MB
  Document        0.05 MB
  Stylesheet      0.03 MB
  Ping             0.9 KB

JavaScript     0.35 MB, and about 48% of it didn't run during load

repeat visit   0.18 MB in 27 requests
  Script          0.12 MB
  Document        0.05 MB
  Image            8.1 KB
  Ping             1.5 KB
```

The requests on the repeat visit include the ones the browser answered from its cache. Those count zero bytes, because nothing came over the network. What's left is what a returning visitor actually downloads again.

Now let's try a heavier page. Here's CNN's homepage:

```bash
npm run measure -- https://www.cnn.com/
```

```text
https://www.cnn.com/ (200, "Breaking News, Latest News and Videos | CNN")

first visit    17.69 MB in 66 requests
  Media          11.88 MB
  Image           3.28 MB
  Script          1.35 MB
  Document        0.62 MB
  Font            0.44 MB
  Fetch           0.08 MB
  Stylesheet      0.04 MB
  XHR              3.4 KB

JavaScript     1.35 MB, and about 71% of it didn't run during load

repeat visit   0.63 MB in 57 requests
  Document        0.62 MB
  Image            9.7 KB
  Script           2.1 KB
  Fetch            1.8 KB
  XHR              0.6 KB
  Stylesheet       0.2 KB
```

Two things stand out. The first visit downloaded almost 12 MB of video before anyone pressed play. And on the repeat visit, the cache saved nearly everything except the HTML, but the HTML alone is 0.62 MB, and it comes down again on every visit. Keep an eye on that `Document` line. We'll come back to it.

## Step 5: Prices and Incomes

Now we need two numbers for every country: what 1 GB of mobile data costs, and what people earn.

For prices, we'll use Cable.co.uk's table, which gives the average price of 1 GB across the plans on sale in 237 countries and territories. For income, we'll use the World Bank's [GNI per capita](https://data.worldbank.org/indicator/NY.GNP.PCAP.CD) (gross national income divided by population, in US dollars).

First, we need our list of countries. In the root of the project, create countries.json and paste in the list from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/04-js-data-cost/gists/countries.json). It's 50 countries, each with its ISO code and name, like so:

```json
[
  { "iso3": "USA", "name": "United States" },
  { "iso3": "CAN", "name": "Canada" },
  ...
]
```

Next, in the scripts folder, create fetch-prices.ts and paste in the code from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/04-js-data-cost/gists/fetch-prices.ts):

```ts
/**
 * Downloads the average price of 1 GB of mobile data, per country, from
 * Cable.co.uk's Worldwide Mobile Data Pricing table and saves it to
 * data/prices.csv. The numbers are theirs, so credit them if you publish
 * anything based on them.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const SOURCE = 'https://www.cable.co.uk/mobiles/worldwide-data-pricing/';

const res = await fetch(SOURCE, {
  headers: { 'user-agent': 'Mozilla/5.0 (js-data-cost research; +https://github.com/Ernesto-tha-great/js-data-cost)' },
});
if (!res.ok) throw new Error(`${SOURCE} returned ${res.status}`);
const html = await res.text();

const table = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)]
  .map((match) => match[0])
  .find((candidate) => /Average price of 1GB/i.test(candidate) && /<td>\s*\d+\s*<\/td>/.test(candidate));
if (!table) throw new Error('Could not find the per-country price table. The page layout may have changed.');

const rows = [...table.matchAll(/<tr>\s*<td>\s*(\d+)\s*<\/td>\s*<td>([^<]+)<\/td>\s*<td>\s*([\d.]+)\s*<\/td>\s*<\/tr>/gi)].map((m) => ({
  rank: Number(m[1]),
  country: decode(m[2]!.trim()),
  usdPerGb: Number(m[3]),
}));
if (rows.length < 100) throw new Error(`Only parsed ${rows.length} rows; refusing to write a partial file.`);

const edition = html.match(/worldwide-data-pricing\/(\d{4})\//)?.[1] ?? 'unknown';

mkdirSync('data', { recursive: true });
writeFileSync('data/prices.csv', ['country,usd_per_gb', ...rows.map((r) => `"${r.country}",${r.usdPerGb}`)].join('\n') + '\n');
writeFileSync(
  'data/prices.meta.json',
  JSON.stringify({ source: SOURCE, edition, countries: rows.length, fetchedAt: new Date().toISOString() }, null, 2) + '\n',
);
console.log(`Saved ${rows.length} countries (edition ${edition}) to data/prices.csv`);

function decode(text: string): string {
  return text.replace(/&amp;/g, '&').replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"');
}
```

It downloads Cable.co.uk's page, finds the per-country table and saves it as data/prices.csv. It refuses to write anything if it finds fewer than 100 rows, so a change to their page layout can't quietly leave you with half a price list.

Then, in the scripts folder, create fetch-income.ts:

```ts
/**
 * Downloads GNI per capita (Atlas method, current US$) for our 50 countries
 * from the World Bank's open API, using the most recent year available for
 * each, and saves it to data/income.csv.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

interface Country { iso3: string; name: string }
interface WorldBankRow { countryiso3code: string; country: { value: string }; date: string; value: number | null }

const countries = JSON.parse(readFileSync('countries.json', 'utf8')) as Country[];
const url =
  `https://api.worldbank.org/v2/country/${countries.map((c) => c.iso3).join(';')}` +
  '/indicator/NY.GNP.PCAP.CD?format=json&mrnev=1&per_page=200';

const res = await fetch(url);
if (!res.ok) throw new Error(`World Bank API returned ${res.status}`);
const [, rows] = (await res.json()) as [unknown, WorldBankRow[] | null];
if (!rows?.length) throw new Error('World Bank API returned no rows');

const byIso = new Map(rows.filter((r) => r.value !== null).map((r) => [r.countryiso3code, r]));
const missing = countries.filter((c) => !byIso.has(c.iso3)).map((c) => c.iso3);
if (missing.length) console.warn(`No GNI per capita for: ${missing.join(', ')}`);

mkdirSync('data', { recursive: true });
writeFileSync(
  'data/income.csv',
  ['iso3,year,gni_per_capita_usd', ...countries.filter((c) => byIso.has(c.iso3)).map((c) => {
    const row = byIso.get(c.iso3)!;
    return `${c.iso3},${row.date},${row.value}`;
  })].join('\n') + '\n',
);
writeFileSync('data/income.meta.json', JSON.stringify({ source: url, indicator: 'NY.GNP.PCAP.CD', fetchedAt: new Date().toISOString() }, null, 2) + '\n');
console.log(`Saved GNI per capita for ${countries.length - missing.length} countries to data/income.csv`);
```

The `mrnev=1` parameter asks the World Bank API for the most recent year that actually has a value, so each country gets its latest figure. Run both:

```bash
npm run fetch:prices
npm run fetch:income
```

```text
Saved 237 countries (edition 2023) to data/prices.csv
Saved GNI per capita for 50 countries to data/income.csv
```

The two sources don't always spell country names the same way, so we need a small lookup that handles that. In the src folder, create data.ts and paste in the code from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/04-js-data-cost/gists/data.ts):

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Country {
  iso3: string;
  name: string;
}

// The price table and our country list don't always spell names the same way.
const ALIASES: Record<string, string[]> = {
  'United States': ['USA', 'United States of America'],
  'South Korea': ['Korea (South)', 'Korea, Republic of', 'Republic of Korea', 'Korea'],
  Netherlands: ['The Netherlands'],
  Vietnam: ['Viet Nam'],
  Tanzania: ['Tanzania, United Republic of'],
  Turkey: ['Türkiye', 'Turkiye'],
  'United Arab Emirates': ['UAE'],
};

export function readCsv(path: string): Array<Record<string, string>> {
  const [header, ...lines] = readFileSync(path, 'utf8').trim().split('\n');
  const keys = header!.split(',');
  return lines.map((line) => {
    const values = [...line.matchAll(/("([^"]*)"|[^,]*)(,|$)/g)].map((m) => m[2] ?? m[1]!).slice(0, keys.length);
    return Object.fromEntries(keys.map((k, i) => [k, values[i] ?? '']));
  });
}

/** Prices (data/prices.csv) and income (data/income.csv), looked up by the country names in countries.json. */
export function loadMarket(dir = '.') {
  const countries = JSON.parse(readFileSync(join(dir, 'countries.json'), 'utf8')) as Country[];
  const prices = readCsv(join(dir, 'data/prices.csv')).map((r) => ({ country: r.country!, usdPerGb: Number(r.usd_per_gb) }));
  const income = new Map(readCsv(join(dir, 'data/income.csv')).map((r) => [r.iso3!, { year: r.year!, gni: Number(r.gni_per_capita_usd) }]));

  const priceFor = (name: string): number | undefined => {
    const names = [name, ...(ALIASES[name] ?? [])].map((n) => n.toLowerCase());
    return prices.find((p) => names.includes(p.country.toLowerCase()))?.usdPerGb;
  };
  const incomeFor = (name: string): { year: string; gni: number } | undefined => {
    const country = countries.find((c) => c.name.toLowerCase() === name.toLowerCase());
    return country ? income.get(country.iso3) : undefined;
  };
  return { countries, priceFor, incomeFor };
}

export type Market = Pick<ReturnType<typeof loadMarket>, 'priceFor' | 'incomeFor'>;
```

`loadMarket` reads both CSV files and gives us two functions. `priceFor` finds a country's price by its name (or one of its aliases), and `incomeFor` looks the name up in countries.json and finds the income by its ISO code.

Before we use these, a caveat. GNI per capita is an average, not a wage, and it flatters any country with a wide gap between rich and poor. The real figure for most people is worse, so treat every work time we calculate as a floor.

## Step 6: Turning Bytes Into Money, Then Into Time

Here's where it comes together. In the src folder, create cost.ts and paste in the code from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/04-js-data-cost/gists/cost.ts):

```ts
/** Many carriers count data in binary gigabytes (1 GB = 1024 MB), so we price it the same way. */
export const BYTES_PER_GB = 2 ** 30;

/**
 * "Using a site" for a month: five visits a day for 30 days. The first visit
 * has an empty cache; the other 149 get whatever the cache saved.
 */
export const VISITS_PER_MONTH = 150;

/** A 40-hour week, 52 weeks a year. Only used to turn yearly income into an hourly figure. */
export const WORK_HOURS_PER_YEAR = 2080;

export function costUsd(bytes: number, usdPerGb: number): number {
  return (bytes / BYTES_PER_GB) * usdPerGb;
}

export function monthlyBytes(coldBytes: number, warmBytes: number): number {
  return coldBytes + (VISITS_PER_MONTH - 1) * warmBytes;
}

/**
 * How long someone on the country's average income works to earn `usd`:
 * GNI per capita spread evenly over a working year. It's an average, not a
 * wage, and it flatters every country with a wide income gap.
 */
export function workSeconds(usd: number, gniPerCapitaUsd: number): number {
  return usd / (gniPerCapitaUsd / WORK_HOURS_PER_YEAR / 3600);
}

export function formatDuration(seconds: number): string {
  if (seconds < 0.1) return '< 0.1 s';
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)} min`;
  const hours = minutes / 60;
  return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
}

export function formatUsd(usd: number): string {
  if (usd < 0.0001) return '< 0.01¢';
  return usd < 0.01 ? `${(usd * 100).toFixed(2)}¢` : `$${usd.toFixed(2)}`;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
```

Let's go through the numbers in here, because each one is a decision:

- `BYTES_PER_GB` is 2³⁰ bytes, because many carriers count in binary gigabytes. If yours counts 10⁹ bytes, everything is about 7% more expensive.
- `VISITS_PER_MONTH` is how we price "using a site": five visits a day for 30 days. The first visit has an empty cache and the other 149 get whatever the cache saved, which is why we measured the repeat visit.
- `WORK_HOURS_PER_YEAR` turns yearly income into an hourly one: 40 hours a week, 52 weeks a year.
- `workSeconds` divides a price by that hourly income, so any cost becomes "how long someone works to pay for it".

My first version of this divided a month of each site's cost by monthly income instead, and it printed **0.000%** for half the countries. Technically correct, but not very helpful: nobody is going to change a build config over a percentage with three zeros after the point. Minutes of work turned out to be much easier to understand.

Now, in the scripts folder, create another file called cost.ts and paste in the code from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/04-js-data-cost/gists/cost-script.ts):

```ts
/**
 * Measures one page and prices it in the countries you name.
 *
 *   npm run cost -- https://en.wikipedia.org/wiki/Main_Page Kenya India Brazil
 */
import { chromium } from 'playwright';
import { costUsd, formatDuration, formatUsd, monthlyBytes, workSeconds } from '../src/cost';
import { loadMarket } from '../src/data';
import { measurePage } from '../src/measure';

const [url, ...countries] = process.argv.slice(2);
if (!url || countries.length === 0) {
  console.error('Usage: npm run cost -- <url> <country> [more countries]');
  process.exit(1);
}

const browser = await chromium.launch();
const result = await measurePage(browser, url);
await browser.close();

if (result.error || result.blocked || !result.cold || !result.warm) {
  console.error(`Couldn't measure ${url}: ${result.error ?? `blocked (${result.status}, "${result.title}")`}`);
  process.exit(2);
}

const market = loadMarket();
const mb = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`;
const month = monthlyBytes(result.cold.bytes, result.warm.bytes);
console.log(`${url}\nfirst visit ${mb(result.cold.bytes)}, repeat visit ${mb(result.warm.bytes)}, a month ${mb(month)}\n`);

for (const country of countries) {
  const usdPerGb = market.priceFor(country);
  const income = market.incomeFor(country);
  if (usdPerGb === undefined || !income) {
    console.log(`${country.padEnd(16)}no price or income data`);
    continue;
  }
  const firstVisit = costUsd(result.cold.bytes, usdPerGb);
  const aMonth = costUsd(month, usdPerGb);
  console.log(
    `${country.padEnd(16)}1 GB $${usdPerGb.toFixed(2)}` +
      `   first visit ${formatUsd(firstVisit)} (${formatDuration(workSeconds(firstVisit, income.gni))} of work)` +
      `   a month ${formatUsd(aMonth)} (${formatDuration(workSeconds(aMonth, income.gni))} of work)`,
  );
}
```

It measures the page, then prints, for each country you name, the price of 1 GB, what a first visit costs and what a month of visits costs, in money and in work time. Let's price Wikipedia:

```bash
npm run cost -- https://en.wikipedia.org/wiki/Main_Page Kenya India Brazil Colombia Japan Germany "United States" "United Kingdom"
```

```text
https://en.wikipedia.org/wiki/Main_Page
first visit 0.58 MB, repeat visit 0.22 MB, a month 33.18 MB

Kenya           1 GB $0.59   first visit 0.03¢ (1.1 s of work)   a month $0.02 (1.0 min of work)
India           1 GB $0.16   first visit < 0.01¢ (0.2 s of work)   a month 0.49¢ (13 s of work)
Brazil          1 GB $0.40   first visit 0.02¢ (0.2 s of work)   a month $0.01 (8.8 s of work)
Colombia        1 GB $0.20   first visit 0.01¢ (0.1 s of work)   a month 0.62¢ (5.9 s of work)
Japan           1 GB $3.48   first visit 0.19¢ (0.4 s of work)   a month $0.11 (21 s of work)
Germany         1 GB $2.14   first visit 0.12¢ (0.1 s of work)   a month $0.07 (8.2 s of work)
United States   1 GB $6.00   first visit 0.33¢ (0.3 s of work)   a month $0.19 (16 s of work)
United Kingdom  1 GB $0.62   first visit 0.03¢ (< 0.1 s of work)   a month $0.02 (2.6 s of work)
```

Now CNN's homepage:

```bash
npm run cost -- https://www.cnn.com/ Kenya India Brazil Colombia Japan Germany "United States" "United Kingdom"
```

```text
https://www.cnn.com/
first visit 17.64 MB, repeat visit 0.63 MB, a month 111.65 MB

Kenya           1 GB $0.59   first visit 0.97¢ (33 s of work)   a month $0.06 (3.5 min of work)
India           1 GB $0.16   first visit 0.26¢ (7.1 s of work)   a month $0.02 (45 s of work)
Brazil          1 GB $0.40   first visit 0.66¢ (4.7 s of work)   a month $0.04 (30 s of work)
Colombia        1 GB $0.20   first visit 0.33¢ (3.1 s of work)   a month $0.02 (20 s of work)
Japan           1 GB $3.48   first visit $0.06 (11 s of work)   a month $0.36 (1.2 min of work)
Germany         1 GB $2.14   first visit $0.04 (4.4 s of work)   a month $0.22 (28 s of work)
United States   1 GB $6.00   first visit $0.10 (8.3 s of work)   a month $0.62 (53 s of work)
United Kingdom  1 GB $0.62   first visit $0.01 (1.4 s of work)   a month $0.06 (8.8 s of work)
```

Look at Kenya and the United States. Data in Kenya costs about a tenth of the US price, yet CNN's first visit takes four times as much work there: 33 seconds against 8.3. That's because incomes differ far more between the two countries than data prices do.

## Step 7: A Performance Budget in Money

Performance budgets usually say things like "the main bundle must be under 170 KB". That's a fine rule, but it doesn't mean much to anyone outside the team. "A first visit must cost less than five seconds of work in Kenya, India and Brazil" means something to a product manager, and we can enforce it.

In the src folder, create budget.ts and paste in the code from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/04-js-data-cost/gists/budget.ts):

```ts
import { costUsd, monthlyBytes, workSeconds } from './cost';
import type { Market } from './data';

export interface BudgetLine {
  country: string;
  /** The most one first visit (empty cache) may cost someone in this country. */
  maxFirstVisitUsd?: number;
  /** The same limit in work time: seconds of average income. Fairer across countries than dollars. */
  maxFirstVisitWorkSeconds?: number;
  /** The most a month of use (one first visit, 149 repeat visits) may cost. */
  maxMonthlyUsd?: number;
}

export interface BudgetResult {
  country: string;
  firstVisitUsd: number | null;
  firstVisitWorkSeconds: number | null;
  monthlyUsd: number | null;
  failures: string[];
}

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

A budget is a list of lines, one per country, and each line can set up to three limits: dollars for a first visit, seconds of work for a first visit, or dollars for a month of use. `checkBudget` prices the page for each line and lists every limit it breaks. It doesn't touch a browser, which is why the finished project can test it without one.

Next, in the scripts folder, create another budget.ts and paste in the code from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/04-js-data-cost/gists/budget-script.ts):

```ts
/**
 * A performance budget in money instead of kilobytes. Loads your page the
 * same way the study does, prices it in the countries you name, and exits 1
 * when it costs more than you said it could.
 *
 *   npm run budget -- budget.json                         # the URL in the file
 *   npm run budget -- budget.json https://example.com/    # or any other page
 *
 * Needs data/prices.csv and data/income.csv (npm run fetch:prices, npm run fetch:income).
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { checkBudget, type BudgetLine } from '../src/budget';
import { formatDuration, formatUsd } from '../src/cost';
import { loadMarket } from '../src/data';
import { measurePage } from '../src/measure';

const config = JSON.parse(readFileSync(process.argv[2] ?? 'budget.json', 'utf8')) as { url: string; budgets: BudgetLine[] };
const url = process.argv[3] ?? config.url;

const browser = await chromium.launch();
const result = await measurePage(browser, url);
await browser.close();

if (result.error || result.blocked || !result.cold || !result.warm) {
  console.error(`Couldn't measure ${url}: ${result.error ?? `blocked (${result.status}, "${result.title}")`}`);
  process.exit(2);
}

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`;
console.log(`${url}\nfirst visit ${mb(result.cold.bytes)}, repeat visit ${mb(result.warm.bytes)}\n`);

const results = checkBudget({ coldBytes: result.cold.bytes, warmBytes: result.warm.bytes }, config.budgets, loadMarket());
for (const r of results) {
  if (r.firstVisitUsd === null || r.monthlyUsd === null) {
    console.log(`✗ ${r.country.padEnd(15)} no price data`);
    continue;
  }
  const work = r.firstVisitWorkSeconds === null ? '' : ` (${formatDuration(r.firstVisitWorkSeconds)} of work)`;
  const verdict = r.failures.length ? `  over budget: ${r.failures.join(', ')}` : '';
  console.log(`${r.failures.length ? '✗' : '✓'} ${r.country.padEnd(15)} first visit ${formatUsd(r.firstVisitUsd)}${work}, a month ${formatUsd(r.monthlyUsd)}${verdict}`);
}
process.exit(results.some((r) => r.failures.length) ? 1 : 0);
```

It measures the page, runs the check and prints one line per country. The important part is the last line: it exits with 1 when any country is over budget, which is what makes a CI job go red.

Finally, create budget.json in the root of the project:

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

Let's run it against Wikipedia, and then against CNN:

```bash
npm run budget -- budget.json
echo "exit code $?"
npm run budget -- budget.json https://www.cnn.com/
echo "exit code $?"
```

```text
https://en.wikipedia.org/wiki/Main_Page
first visit 0.70 MB, repeat visit 0.18 MB

✓ Kenya           first visit 0.04¢ (1.3 s of work), a month $0.02
✓ India           first visit 0.01¢ (0.3 s of work), a month 0.41¢
✓ Brazil          first visit 0.03¢ (0.2 s of work), a month $0.01
exit code 0
https://www.cnn.com/
first visit 17.62 MB, repeat visit 0.01 MB

✗ Kenya           first visit 0.97¢ (33 s of work), a month $0.01  over budget: work time
✗ India           first visit 0.26¢ (7.1 s of work), a month 0.29¢  over budget: work time
✓ Brazil          first visit 0.66¢ (4.7 s of work), a month 0.73¢
exit code 1
```

Wikipedia passes. CNN doesn't, and the exit code says so.

Notice that CNN's repeat visit came out at 0.01 MB this time, against 0.63 MB a few minutes earlier. Pages with video and personalised HTML rarely measure the same way twice. That's one more reason to run your budget against your own page, where you control what changes.

To run it on every pull request, create a .github folder, a workflows folder inside it, and in there, budget.yml:

```yaml
name: budget

# A performance budget in money. Copy this into your own repo, point
# budget.json at your page, and a pull request that makes the page cost too
# much in the countries you named goes red.
on:
  pull_request:
  workflow_dispatch:
    inputs:
      url:
        description: Measure this URL instead of the one in budget.json
        required: false

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
      - run: npm run budget -- budget.json ${URL:+"$URL"}
        env:
          URL: ${{ inputs.url }}
```

The check reads the prices and incomes from the data folder, so make sure you commit data/ along with everything else. Push it to GitHub, and every pull request gets a budget check. In your own project, point `url` in budget.json at a preview deployment of the pull request rather than at production. Otherwise, you're measuring the code you already shipped.

## Testing It on 50 Websites

Once I had all this working, I wanted to know what the web as a whole looks like through it. So I made a list of 50 popular sites (search engines, social networks, shops, news, streaming, travel and developer tools), and ran `measurePage` on every one of them on a GitHub Actions runner, on 8 October 2026. The list and the two scripts that run it and build the report are in the [finished project](https://github.com/Ernesto-tha-great/js-data-cost): sites.json, scripts/study.ts and scripts/report.ts.

![Each site is loaded twice in Chromium: a first visit with an empty cache, a trip to about:blank, then a repeat visit with the same cache. The measurements are joined with prices and income to produce the report, and the same steps power the budget check.](images/method.svg)

Fourteen of the 50 served a bot wall to a headless browser on a datacentre IP (X, Reddit, LinkedIn, eBay, Stack Overflow, Medium and Canva among them), and AliExpress timed out. I left all 15 out rather than counting them at the size of a "Just a moment..." page, which leaves 35.

### What they download

![First-visit download size of 35 popular sites. Each bar is split into JavaScript that ran during load, JavaScript that didn't, and everything else. CNN is heaviest at 14.63 MB; the median is 3.58 MB.](images/site-weights.svg)

The median first visit was **3.58 MB**, and the median repeat visit was **0.19 MB**. JavaScript was the biggest resource type by a distance:

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

On 21 of the 35 sites, JavaScript was more than half of everything downloaded. The median site sent 1.46 MB of it, and about **57%** of all the JavaScript didn't run during load. That's about a quarter of all first-visit bytes.

The heaviest page wasn't heavy because of JavaScript, though. CNN's homepage downloaded 14.63 MB, and 11.38 MB of that was video, downloaded before anyone pressed play.

### What it costs

![How long someone on average income works to pay for 1 GB of mobile data in 50 countries, on a log scale: from 34 hours in Zimbabwe to 2.7 seconds in Israel.](images/work-time.svg)

The chart has a log scale because nothing else fits. 1 GB costs about 46,000 times more work in Zimbabwe than in Israel. Both ends are unusual prices (Zimbabwe's is an outlier in the source data, so check it before you quote it), but even without Zimbabwe, a gigabyte in Tanzania costs about 1,860 times more work than one in Israel. Here's a slice of the [full table](https://github.com/Ernesto-tha-great/js-data-cost/blob/main/results/report.md):

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

A few seconds of work per page doesn't sound like much, but it adds up across a product's users. The median site's unused JavaScript (0.94 MB per first visit) costs users in Kenya about $514 per million first visits, and users in the United States about $5,229.

### What repeat visits cost

This one I didn't expect. Remember, we price a month as one first visit and 149 repeat visits. Under that model, across all 35 sites, **94% of a month's bytes come from repeat visits**. Even at one visit a day, it's about three quarters.

So for people who use a site every day, what a repeat visit downloads *again* matters much more than the first visit. Ranked by a month of use, the list reshuffles:

| Site | First visit | Repeat visit | A month (5 visits a day) | Biggest thing downloaded again |
|---|---:|---:|---:|---|
| Figma | 5.78 MB | 2.69 MB | 406 MB | 2.58 MB of XHR |
| Yahoo | 5.74 MB | 2.01 MB | 305 MB | 1.16 MB of script |
| Nike | 5.84 MB | 1.04 MB | 161 MB | 0.60 MB of images |
| WhatsApp | 1.69 MB | 0.97 MB | 146 MB | 0.92 MB of images |
| CNN | 14.63 MB | 0.63 MB | 108 MB | 0.62 MB of HTML |
| Google | 0.93 MB | 0.69 MB | 104 MB | 0.68 MB of script |

CNN's row is the `Document` line we saw in Step 4. Google's is the strangest one: its homepage is one of the lightest first visits in the study, but in that run, a month of it cost about as much as a month of CNN, because its repeat visit downloaded 0.68 MB of script again. Repeat visits aren't stable, though. When I measured Google again a few hours later, its repeat visit was down to 0.12 MB.

I haven't dug into *why* each of these sites downloads things again. Some of it is personalised and deliberately uncacheable, and some of it is probably a trade-off someone made for a good reason. Either way, you'd only notice it by measuring the repeat visit.

### Three fixes, priced

If any of this is your site, here are the three fixes the numbers point at. The savings are upper bounds calculated from the measurements, not experiments on other people's sites.

**1. Don't autoplay video on the first screen.** Without its video, CNN's first visit drops from 14.63 MB to 3.25 MB, and its cost in Kenya falls from 27 seconds of work to about 6:

```html
<video controls preload="none" poster="/clips/launch-poster.jpg">
  <source src="/clips/launch.mp4" type="video/mp4" />
</video>
```

`preload="none"` tells the browser not to fetch anything until someone presses play, and the poster stands in until then. Drop `autoplay` too, because it overrides `preload`.

**2. Ship what runs, and fetch the rest when it's needed.** About 35 MB of JavaScript arrived across the 35 sites and didn't run during load. A dynamic `import()` moves code out of the first download and into the moment someone needs it:

```js
editButton.addEventListener('click', async () => {
  const { openEditor } = await import('./editor.js');
  openEditor();
}, { once: true });
```

Vite and webpack turn that into a separate file by default. Run Step 3 against your own page to find candidates.

**3. Make repeat visits nearly free.** Give fingerprinted assets (files whose names change when their contents do, like `app.3f9a2c.js`) a long cache lifetime, and let only the HTML revalidate:

```http
# app.3f9a2c.js, styles.81b0e4.css, fonts, images
Cache-Control: public, max-age=31536000, immutable

# the HTML document
Cache-Control: no-cache
```

In the study run, if every script, image, font, stylesheet and video on the repeat visit had come from the cache, Google's month would have dropped from 104 MB to about 4 MB. Figma's wouldn't move at all, because what it downloads again is 2.58 MB of API data, and no cache header fixes that.

## How It All Works

Let's review the whole thing:

1. `measurePage` opens Chromium as a phone, loads the page and counts every byte Chrome's network stack receives, by type, using `Network.loadingFinished`. It waits for two quiet seconds instead of trusting the `load` event.
2. While the page loads, V8's coverage records which code ran, and `executedBytes` paints the nested ranges so functions that never ran count as unused.
3. It leaves the page and comes back with the same cache, so we know what a returning visitor downloads again.
4. The fetch scripts save the price of 1 GB in 237 countries and GNI per capita for our 50, and `loadMarket` looks them up by name.
5. cost.ts turns bytes into dollars (in binary gigabytes) and dollars into seconds of work, for one visit and for a month of 150 visits.
6. The budget check runs all of that against your page and exits with 1 when it costs too much, so a pull request can go red.

## Conclusion

In this tutorial, we built a tool that counts what a page downloads the way a carrier would, works out how much of its JavaScript ran, checks what a returning visitor downloads again, and prices all of it in money and in work time. Then we made it fail a pull request when a page costs too much. On the 35 popular sites I could measure, repeat visits made up most of a month's data for anyone visiting every day.

You can find the complete project, including the 50-site study, [here](https://github.com/Ernesto-tha-great/js-data-cost). If you run into any issues while following along, drop a comment or reach out to me. Thanks for reading!
