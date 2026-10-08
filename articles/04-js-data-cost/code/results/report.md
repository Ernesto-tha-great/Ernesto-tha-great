# Results

Measured 2026-10-08 from a GitHub Actions runner (ubuntu-latest), Moto G4 emulation (Playwright), en-US, Chromium 141.0.7390.37.
Prices: Cable.co.uk Worldwide Mobile Data Pricing, 2023 edition. Income: World Bank GNI per capita (Atlas method), most recent year.

35 of 50 sites were usable. Median first visit: **3.58 MB**. Median repeat visit: **0.19 MB**, 19× less.
JavaScript was 45.3% of all bytes on first visits. An estimated 25.7% of all bytes were JavaScript that didn't run during load: 57% of the JavaScript.

## Sites (first visit, heaviest first)

| Site | First visit | Repeat visit | JavaScript | JS that didn't run during load | Requests |
|---|---:|---:|---:|---:|---:|
| CNN | 14.63 MB | 0.63 MB | 1.32 MB | 71% | 66 |
| Microsoft | 10.80 MB | 0.03 MB | 3.14 MB | 41% | 285 |
| Pinterest | 7.19 MB | 0.64 MB | 3.04 MB | 57% | 167 |
| Booking.com | 6.61 MB | 0.59 MB | 4.91 MB | 66% | 288 |
| Amazon | 6.27 MB | 0.48 MB | 0.95 MB | 54% | 238 |
| Airbnb | 6.18 MB | 0.19 MB | 3.45 MB | 52% | 238 |
| ESPN | 5.86 MB | 0.27 MB | 3.14 MB | 55% | 201 |
| Nike | 5.84 MB | 1.04 MB | 4.72 MB | 49% | 310 |
| Figma | 5.78 MB | 2.69 MB | 1.38 MB | 58% | 196 |
| Yahoo | 5.74 MB | 2.01 MB | 3.54 MB | 48% | 1105 |
| Spotify | 5.20 MB | 0.10 MB | 1.58 MB | 59% | 143 |
| GitHub | 4.64 MB | 0.12 MB | 1.86 MB | 69% | 162 |
| TikTok | 4.58 MB | 0.19 MB | 2.50 MB | 59% | 188 |
| Zoom | 4.32 MB | 0.13 MB | 2.49 MB | 57% | 284 |
| Duolingo | 3.79 MB | 0.05 MB | 2.28 MB | 58% | 154 |
| Walmart | 3.63 MB | 0.40 MB | 2.88 MB | 68% | 311 |
| Twitch | 3.61 MB | 0.09 MB | 0.84 MB | 37% | 153 |
| Netflix | 3.58 MB | 0.23 MB | 1.93 MB | 49% | 108 |
| Uber | 3.36 MB | 0.13 MB | 1.46 MB | 63% | 97 |
| Notion | 3.26 MB | 0.18 MB | 2.23 MB | 48% | 222 |
| The Guardian | 2.60 MB | 0.14 MB | 2.02 MB | 50% | 174 |
| Instagram | 2.55 MB | 0.12 MB | 2.20 MB | 78% | 41 |
| BBC News | 2.13 MB | 0.09 MB | 1.36 MB | 63% | 107 |
| PayPal | 2.06 MB | 0.18 MB | 1.27 MB | 57% | 132 |
| IKEA | 1.82 MB | 0.20 MB | 0.30 MB | 61% | 84 |
| Apple | 1.73 MB | 0.42 MB | 0.42 MB | 54% | 43 |
| WhatsApp | 1.69 MB | 0.97 MB | 0.39 MB | 61% | 41 |
| DuckDuckGo | 1.62 MB | 0.01 MB | 0.51 MB | 53% | 68 |
| YouTube | 1.34 MB | 0.19 MB | 1.12 MB | 62% | 60 |
| ChatGPT | 1.11 MB | 0.15 MB | 0.83 MB | 56% | 174 |
| Google | 0.93 MB | 0.69 MB | 0.77 MB | 62% | 40 |
| Bing | 0.86 MB | 0.09 MB | 0.04 MB | 70% | 111 |
| Facebook | 0.82 MB | 0.06 MB | 0.55 MB | 61% | 48 |
| Wikipedia | 0.63 MB | 0.32 MB | 0.35 MB | 48% | 28 |
| IMDb | 0.45 MB | 0.10 MB | 0.41 MB | 53% | 14 |

Excluded: X (blocked (403, "")); Reddit (blocked (403, "")); LinkedIn (blocked (403, "Attention Required! | Cloudflare")); eBay (blocked (403, "Error Page | eBay")); AliExpress (page.goto: Timeout 45000ms exceeded.); Etsy (blocked (403, "etsy.com")); Tripadvisor (blocked (403, "tripadvisor.com")); The New York Times (blocked (403, "nytimes.com")); Reuters (blocked (401, "reuters.com")); The Weather Channel (blocked (429, "Vercel Security Checkpoint")); Stack Overflow (blocked (403, "Just a moment...")); Medium (blocked (403, "Just a moment...")); Quora (blocked (403, "Just a moment...")); Canva (blocked (403, "Just a moment...")); Zara (blocked (403, "Access Denied")).

## Countries: what a first visit costs

Work time is the cost divided by average hourly income: GNI per capita spread over 2,080 working hours a year.
The median site's first visit is 3.58 MB; the heaviest, CNN, is 14.63 MB. The median site ships 0.94 MB of JavaScript that doesn't run during load.

| Country | 1 GB | 1 GB in work time | Median site, first visit | CNN, first visit | Unused JS, per million first visits |
|---|---:|---:|---:|---:|---:|
| Zimbabwe | $43.75 | 34 h | $0.15 · 6.8 min | $0.60 · 28 min | $38,127 |
| Tanzania | $0.84 | 1.4 h | 0.28¢ · 17 s | $0.01 · 1.1 min | $732 |
| Ethiopia | $0.68 | 1.3 h | 0.23¢ · 15 s | 0.93¢ · 1.0 min | $593 |
| South Africa | $1.81 | 36 min | 0.60¢ · 7.2 s | $0.02 · 29 s | $1,577 |
| Nigeria | $0.39 | 36 min | 0.13¢ · 7.2 s | 0.53¢ · 29 s | $340 |
| Nepal | $0.43 | 34 min | 0.14¢ · 6.8 s | 0.59¢ · 28 s | $375 |
| Kenya | $0.59 | 33 min | 0.20¢ · 6.7 s | 0.80¢ · 27 s | $514 |
| Egypt | $0.65 | 25 min | 0.22¢ · 5.0 s | 0.89¢ · 20 s | $566 |
| Ghana | $0.40 | 19 min | 0.13¢ · 3.8 s | 0.54¢ · 16 s | $349 |
| Mexico | $2.03 | 18 min | 0.68¢ · 3.7 s | $0.03 · 15 s | $1,769 |
| Morocco | $0.63 | 18 min | 0.21¢ · 3.6 s | 0.86¢ · 15 s | $549 |
| South Korea | $5.01 | 17 min | $0.02 · 3.3 s | $0.07 · 13 s | $4,366 |
| New Zealand | $5.89 | 16 min | $0.02 · 3.2 s | $0.08 · 13 s | $5,133 |
| Philippines | $0.59 | 15 min | 0.20¢ · 3.0 s | 0.80¢ · 12 s | $514 |
| Canada | $5.37 | 12 min | $0.02 · 2.4 s | $0.07 · 9.7 s | $4,680 |
| Japan | $3.48 | 11 min | $0.01 · 2.3 s | $0.05 · 9.3 s | $3,033 |
| United Arab Emirates | $4.61 | 11 min | $0.02 · 2.2 s | $0.06 · 9.1 s | $4,017 |
| Bangladesh | $0.23 | 10 min | 0.08¢ · 2.0 s | 0.31¢ · 8.3 s | $200 |
| Pakistan | $0.12 | 10.0 min | 0.04¢ · 2.0 s | 0.16¢ · 8.2 s | $105 |
| Argentina | $1.11 | 9.5 min | 0.37¢ · 1.9 s | $0.02 · 7.7 s | $967 |
| United States | $6.00 | 8.4 min | $0.02 · 1.7 s | $0.08 · 6.9 s | $5,229 |
| Switzerland | $7.29 | 8.2 min | $0.02 · 1.6 s | $0.10 · 6.7 s | $6,353 |
| Portugal | $1.79 | 7.5 min | 0.60¢ · 1.5 s | $0.02 · 6.1 s | $1,560 |
| Vietnam | $0.29 | 7.3 min | 0.10¢ · 1.5 s | 0.40¢ · 6.0 s | $253 |
| India | $0.16 | 7.2 min | 0.05¢ · 1.4 s | 0.22¢ · 5.9 s | $139 |
| Indonesia | $0.28 | 6.8 min | 0.09¢ · 1.4 s | 0.38¢ · 5.6 s | $244 |
| Sri Lanka | $0.25 | 6.7 min | 0.08¢ · 1.3 s | 0.34¢ · 5.5 s | $218 |
| Peru | $0.45 | 6.7 min | 0.15¢ · 1.3 s | 0.61¢ · 5.4 s | $392 |
| Thailand | $0.41 | 6.7 min | 0.14¢ · 1.3 s | 0.56¢ · 5.4 s | $357 |
| Ukraine | $0.27 | 6.1 min | 0.09¢ · 1.2 s | 0.37¢ · 5.0 s | $235 |
| Norway | $4.07 | 5.2 min | $0.01 · 1.0 s | $0.06 · 4.3 s | $3,547 |
| Saudi Arabia | $1.49 | 5.2 min | 0.50¢ · 1.0 s | $0.02 · 4.2 s | $1,298 |
| Brazil | $0.40 | 4.7 min | 0.13¢ · 0.9 s | 0.54¢ · 3.9 s | $349 |
| Chile | $0.64 | 4.7 min | 0.21¢ · 0.9 s | 0.87¢ · 3.8 s | $558 |
| Sweden | $2.33 | 4.6 min | 0.78¢ · 0.9 s | $0.03 · 3.8 s | $2,031 |
| Germany | $2.14 | 4.4 min | 0.71¢ · 0.9 s | $0.03 · 3.6 s | $1,865 |
| Turkey | $0.44 | 3.4 min | 0.15¢ · 0.7 s | 0.60¢ · 2.8 s | $383 |
| China | $0.38 | 3.3 min | 0.13¢ · 0.7 s | 0.52¢ · 2.7 s | $331 |
| Colombia | $0.20 | 3.2 min | 0.07¢ · 0.6 s | 0.27¢ · 2.6 s | $174 |
| Netherlands | $1.61 | 2.9 min | 0.54¢ · 0.6 s | $0.02 · 2.4 s | $1,403 |
| Malaysia | $0.28 | 2.8 min | 0.09¢ · 0.6 s | 0.38¢ · 2.3 s | $244 |
| Ireland | $1.50 | 2.1 min | 0.50¢ · 0.4 s | $0.02 · 1.8 s | $1,307 |
| Poland | $0.37 | 1.8 min | 0.12¢ · 0.4 s | 0.50¢ · 1.5 s | $322 |
| Spain | $0.48 | 1.6 min | 0.16¢ · 0.3 s | 0.65¢ · 1.3 s | $418 |
| United Kingdom | $0.62 | 1.4 min | 0.21¢ · 0.3 s | 0.84¢ · 1.2 s | $540 |
| Singapore | $0.63 | 58 s | 0.21¢ · 0.2 s | 0.86¢ · 0.8 s | $549 |
| Australia | $0.44 | 51 s | 0.15¢ · 0.2 s | 0.60¢ · 0.7 s | $383 |
| France | $0.20 | 31 s | 0.07¢ · 0.1 s | 0.27¢ · 0.4 s | $174 |
| Italy | $0.09 | 16 s | 0.03¢ · < 0.1 s | 0.12¢ · 0.2 s | $78.43 |
| Israel | $0.02 | 2.7 s | < 0.01¢ · < 0.1 s | 0.03¢ · < 0.1 s | $17.43 |

1 GB costs 46,201× more work in Zimbabwe than in Israel. Without Zimbabwe, the gap is 1,858× (Tanzania against Israel).

## What the bytes are

| Resource type | Share of first-visit bytes |
|---|---:|
| Script | 45.3% |
| Image | 21.5% |
| Media | 10.6% |
| Font | 6.2% |
| Fetch | 6.1% |
| Document | 4.2% |
| Stylesheet | 2.7% |
| XHR | 2.6% |
| Other | 0.8% |
| Everything else | 0.1% |

JavaScript was more than half of the first visit on 21 of 35 sites. The median site downloaded 1.46 MB of it. In total, 35.29 MB of JavaScript didn't run during load.
Video and audio over 100 KB on a first visit: CNN 11.38 MB, Amazon 1.82 MB, Airbnb 0.25 MB, TikTok 0.98 MB. Without it, CNN would be 3.25 MB instead of 14.63 MB (78% less).

## A month of use

A month is 5 visits a day for 30 days: 1 first visit and 149 repeat visits. Repeat visits are 94% of all those bytes (75% at one visit a day).
The last column is an upper bound: the month if every script, image, font, stylesheet, media byte on the repeat visit came from cache.

| Site | First visit | Repeat visit | A month | Most re-downloaded on a repeat visit | A month, if cacheable types were cached |
|---|---:|---:|---:|---|---:|
| Figma | 5.78 MB | 2.69 MB | 406 MB | 2.58 MB XHR | 406 MB |
| Yahoo | 5.74 MB | 2.01 MB | 305 MB | 1.16 MB Script | 105 MB |
| Nike | 5.84 MB | 1.04 MB | 161 MB | 0.60 MB Image | 18 MB |
| WhatsApp | 1.69 MB | 0.97 MB | 146 MB | 0.92 MB Image | 10 MB |
| CNN | 14.63 MB | 0.63 MB | 108 MB | 0.62 MB Document | 107 MB |
| Google | 0.93 MB | 0.69 MB | 104 MB | 0.68 MB Script | 4 MB |
| Pinterest | 7.19 MB | 0.64 MB | 103 MB | 0.47 MB Document | 88 MB |
| Booking.com | 6.61 MB | 0.59 MB | 94 MB | 0.33 MB Script | 43 MB |
| Amazon | 6.27 MB | 0.48 MB | 77 MB | 0.30 MB XHR | 53 MB |
| Apple | 1.73 MB | 0.42 MB | 64 MB | 0.38 MB Script | 2 MB |
| Walmart | 3.63 MB | 0.40 MB | 64 MB | 0.28 MB Script | 21 MB |
| Wikipedia | 0.63 MB | 0.32 MB | 48 MB | 0.17 MB Script | 9 MB |



