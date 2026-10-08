# js-data-cost

What it costs to load a web page on a phone, priced in mobile data and in minutes of work, across 50 countries.

This is the finished code for my tutorial, **[The Mobile Data Cost of Web Pages: Pricing 35 Popular Websites in 50 Countries](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/04-js-data-cost/article.md)**. If you're following along, build it from the article, step by step. This repo is here so you can check your work, or skip ahead.

![First-visit download size of 35 popular sites, split into JavaScript that ran, JavaScript that didn't, and everything else](docs/images/site-weights.svg)

## Run it

You need Node.js 22 or newer.

```bash
git clone https://github.com/Ernesto-tha-great/js-data-cost.git
cd js-data-cost
npm install
npx playwright install chromium
npm test                       # 12 tests, including a real browser against a local page

npm run measure -- https://en.wikipedia.org/wiki/Main_Page
npm run fetch:prices           # Cable.co.uk's price per GB, saved to data/prices.csv
npm run fetch:income           # World Bank GNI per capita, saved to data/income.csv
npm run cost -- https://en.wikipedia.org/wiki/Main_Page Kenya India Brazil
npm run budget -- budget.json  # exits with 1 when the page costs too much
```

The repo already has prices and income data in `data/`, so `cost` and `budget` work straight after `npm install`.

## The 50-site study

The tutorial ends with what happened when I ran `measurePage` on 50 popular websites. That part uses three more files:

```bash
npm run study                  # all 50 sites in sites.json, about 15 minutes
npm run study -- wikipedia     # just the ones whose name matches
npm run report                 # results/report.md, results/summary.json, docs/images/*.svg
```

**Latest results: [results/report.md](results/report.md).** The [study workflow](.github/workflows/study.yml) re-runs the study on the 1st of each month and commits the results. The run the article describes happened on 8 October 2026.

![How long someone on average income works to pay for 1 GB of mobile data, in 50 countries](docs/images/work-time.svg)

## How it measures

![Each site is loaded twice in Chromium: a first visit with an empty cache, a trip to about:blank, then a repeat visit with the same cache](docs/images/method.svg)

- **Bytes** are what Chrome's network stack received, headers included: `encodedDataLength` on the DevTools protocol's `Network.loadingFinished` event, in [`src/measure.ts`](src/measure.ts). That's close to what a carrier counts, though it leaves out uploads and TLS overhead.
- **Unused JavaScript** comes from V8's precise coverage, collected with `page.coverage`, in [`src/coverage.ts`](src/coverage.ts). It's measured in source characters and applied to the compressed bytes on the wire, so treat it as an estimate.
- **The repeat visit** happens a few seconds after the first, in the same browser context, after a detour through `about:blank`.
- **Prices** are in binary gigabytes (1 GB = 2³⁰ bytes). **Work time** is the cost divided by GNI per capita spread over 2,080 working hours a year. See [`src/cost.ts`](src/cost.ts).

## Caveats

- **One place, one browser.** Every measurement comes from a GitHub Actions runner (the 8 October run was in Azure's East US 2 region), running headless Chromium with a Moto G4's screen and user agent. Sites serve different pages by region, and some serve different pages to bots.
- **Logged-out home pages, first screen only.** There's no scrolling, no consent clicks and no logging in. Real use downloads more.
- **"Didn't run during load" is not "dead code".** Some of it runs when someone taps something. The point is that it didn't need to arrive first.
- **Video makes some pages unstable.** CNN measured 14.63 MB in the study run and 17.03 MB in a budget run about 20 minutes later.
- **Prices are averages from 2023**, the latest edition Cable.co.uk publishes. Real people buy bundles, promotions and night plans. Zimbabwe's $43.75 per GB is an outlier in the source data, so check it before you quote it.
- **GNI per capita is an average, not a wage.** The figures are for 2025 (2024 for the United Arab Emirates). It flatters every country with a wide income gap. The 2,080-hour year is a convention, not a fact about anyone.

## Data sources and credits

- Cable.co.uk, [Worldwide Mobile Data Pricing](https://www.cable.co.uk/mobiles/worldwide-data-pricing/)
- World Bank, [GNI per capita, Atlas method (current US$)](https://data.worldbank.org/indicator/NY.GNP.PCAP.CD), indicator `NY.GNP.PCAP.CD`
- Tim Kadlec's [What Does My Site Cost?](https://whatdoesmysitecost.com), which did this first and inspired this project

## Licence

The code is MIT licensed. Prices and income data belong to their publishers and are used under their terms.
