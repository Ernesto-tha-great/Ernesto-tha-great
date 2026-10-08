# js-data-cost

What it costs to load popular websites on a phone, priced in mobile data and in minutes of work, across 50 countries.

Companion code for **[The Mobile Data Cost of Web Pages: Pricing 35 Popular Websites in 50 Countries](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/04-js-data-cost/article.md)**.

![First-visit download size of 35 popular sites, split into JavaScript that ran, JavaScript that didn't, and everything else](docs/images/site-weights.svg)

**Latest results: [results/report.md](results/report.md).** A GitHub Actions workflow re-measures everything on the 1st of each month and commits the results.

## What it found (8 October 2026)

- 35 of 50 sites could be measured. Fourteen blocked a headless browser on a datacentre IP and one timed out.
- The median first visit downloaded **3.58 MB**. The median repeat visit downloaded **0.19 MB**.
- JavaScript was **45%** of first-visit bytes, more than any other type. About **57%** of that JavaScript didn't run during load.
- Five visits a day for a month means 1 first visit and 149 repeat visits. Under that model, **94%** of the bytes come from repeat visits. Google's 0.93 MB homepage downloaded 0.68 MB of script again on its repeat visit, so a month of it costs about as much as a month of CNN's 14.63 MB page.
- 1 GB of mobile data costs **34 hours** of average work in Zimbabwe, **1.3 hours** in Ethiopia, **8.4 minutes** in the United States and **2.7 seconds** in Israel.

![How long someone on average income works to pay for 1 GB of mobile data, in 50 countries](docs/images/work-time.svg)

## Run it

Needs Node 22 or newer.

```bash
git clone https://github.com/Ernesto-tha-great/js-data-cost.git
cd js-data-cost
npm install
npx playwright install chromium
npm test                  # 12 tests, including a real browser against a local fixture

npm run fetch:prices      # Cable.co.uk's price per GB → data/prices.csv
npm run fetch:income      # World Bank GNI per capita → data/income.csv
npm run measure           # all 50 sites, about 15 minutes
npm run measure -- wikipedia   # one site, saved to results/measurements.wikipedia.json
npm run report            # results/report.md, results/summary.json, docs/images/*.svg
```

The repo already contains the latest prices, income figures and measurements, so `npm run report` works straight after `npm install`.

## Put a price on your own page

`npm run budget` loads one URL the same way the study does, prices it in the countries you name, and exits with 1 if the page costs more than you allowed. You can set the limit three ways: dollars for a first visit, seconds of work for a first visit, or dollars for a month of use.

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

```bash
npm run budget -- budget.example.json                          # the URL in the file
npm run budget -- budget.example.json https://www.cnn.com/     # or any other page
```

```text
https://www.cnn.com/
first visit 17.03 MB, repeat visit 0.01 MB

✗ Kenya           first visit 0.94¢ (32 s of work), a month $0.01  over budget: work time
✗ India           first visit 0.25¢ (6.9 s of work), a month 0.28¢  over budget: work time
✓ Brazil          first visit 0.63¢ (4.5 s of work), a month 0.70¢
```

[`.github/workflows/budget.yml`](.github/workflows/budget.yml) runs it on every pull request. To use it in your own project, copy `src/`, `scripts/budget.ts`, `countries.json`, `data/` and your `budget.json`, add the `budget` script from `package.json`, and install `playwright` and `tsx`. Point `url` at a preview deployment of the pull request, not at production.

## How it measures

![Each site is loaded twice in Chromium: a first visit with an empty cache, a trip to about:blank, then a repeat visit with the same cache](docs/images/method.svg)

- **Bytes** are what Chrome's network stack received, headers included. They come from `encodedDataLength` on the DevTools protocol's `Network.loadingFinished` event, in [`src/measure.ts`](src/measure.ts). That's close to what a carrier counts, though it leaves out uploads and TLS overhead.
- **Unused JavaScript** comes from V8's precise coverage, collected with `page.coverage`, in [`src/coverage.ts`](src/coverage.ts). It's measured in source characters, and that ratio is applied to the compressed bytes on the wire, so treat it as an estimate.
- **The repeat visit** happens a few seconds after the first, in the same browser context, after a detour through `about:blank`, the way a person leaves and comes back.
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
