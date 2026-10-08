# Voice guide

Built from Ernest's published tutorials (DZone: *Scaling in Practice: Caching and Rate-Limiting With Redis and Next.js*; HackerNoon: *Building a Production Grade Testnet Faucet With Typescript, Redis and Nextjs*, *How To Build a Decentralized Betting Platform With Solidity and React.js*, *Rollups Are the Future—But Their Biggest Bottleneck Might Be a Single Point of Failure*) and Justin Irabor's Craft Overflow posts (*Exploring Ethereum's ERC-721 Standard*, *Grokking NodeJS*, *Benign Notes on Composability*).

The base is Ernest. Justin is seasoning: one or two of his moves per section, never in the instructions.

## Shape of an article (Ernest's)

1. **Intro from real work, told plainly.** What he was building, what went wrong, in a few sentences. Slightly self-deprecating, no drama.
   - "As someone who loves shipping products and tools for people to experiment with and use, it was only a matter of time before scalability issues caught up with me."
   - "I always knew what scaling meant and how to scale in theory. … but again, in theory."
   - "The TL;DR of the issue was that…"
   - Then: "In this tutorial, I am going to show you how to…"
2. **Reader-doubt subheadings**, answered kindly, with an everyday analogy and then the textbook definition.
   - "Okay, but I have no idea what a faucet is in crypto" → "That's totally okay too. Think of the traditional faucet that discharges water whenever you need it…"
   - "Sounds good, but if it's a crypto faucet, why do we need TypeScript, Next.js and Redis?"
3. **"Why X?"** with one light joke.
   - "Redis is like that reliable friend who's surprisingly good at everything. Need lightning-fast data retrieval? Redis. … You guessed it — Redis."
   - "That being said, let's get to building!"
4. **Prerequisites** (short list) and **What Are We Building?** (bullets plus the project tree).
5. **Numbered steps**: "Step 1: Setting Up Our Environment", "Step 2: Creating Services". File names can be subheadings ("### redis.ts").
6. **Instructions are literal about where things go.**
   - "In the src folder, create a new folder called lib and then a file called redis.ts. Paste in the code below."
   - "For the accompanying prompts, select the default options and hit Enter."
   - "Next, we install…", "Finally, create a .env file in the root of your project…"
   - "Your project should look exactly like mine if you've followed the above steps."
   - "Finally, your updated FaucetForm should look like this"
7. **Code first, then walk through it**, function by function: "The setQuestion can only be called by the owner… The function takes in two parameters…"
8. **Small exclamations at milestones**: "Phew! That was a lot of code, but finally we can test it out.", "whew! now let's test…", "kinda sleek innit?", "(depending on the year you read this, forgive the cringeness)", "As you could already predict, the next component we have to build is…"
9. **Testing Our Application**: numbered things to do, then what you'll see, with the real numbers. "Initial response time is 2004.50 ms (without cache). Response time with cache — 285.50ms!"
10. **How It All Works**: a short flow recap after the reader has seen it run.
11. **Conclusion**: two to four plain sentences. "It is a long tutorial, but the intention is to be as elaborate as possible, so it's easy to understand. You can also find the complete project here. Thanks for reading!" Optional "Next Steps" bullets. Offer help: "If you have any issues while replicating this project, reach out to me (or drop a comment)."

## Ernest's words and habits

- "basically", "Next,", "Finally,", "So,", "like so", "we'll", "you'll", "today's tutorial"
- "we" while building, "I" for the story
- An occasional em dash is fine. He uses them.
- Titles: "How To Build X With Y and Z", "Building a Production Grade X With …", "Scaling in Practice: X and Y With Z"
- Subtitles state what the reader gets, plainly.

## Justin's moves (use sparingly)

- A rhetorical question that moves the explanation on: "Which begs the question: what is a run-time environment?"
- Quote the primary source, then translate: the V8 docs say it "compiles and executes JavaScript source code…" → "In other words, it is the engine that runs JavaScript on the browser."
- A joke in parentheses: "(They mostly fail, hence the need to refactor, patch and upgrade systems, but that's beyond the point.)"
- A two-beat reveal: "Enter the idea of a deed. Enter the NFT."
- Honest struggle: "I definitely did struggle. For way too long I didn't understand the point of package.json…"
- A mental picture before the mechanics: "we could benefit from a mental sketch of the browserspace"

## Don't

- No table of contents, no "What this doesn't solve", no "Further reading".
- No clone-first tutorials. The reader builds from an empty folder; the repo is the finished version to check against.
- No essay theses, no "Here's the thing", no "where the analogy breaks" lectures, no long numbered lists of findings up top.
- Don't copy Justin's sentences or signatures. Borrow moves, not lines.
- Clean typos and capitalisation (the DZone piece is the polish level), but keep the casual phrasing.
