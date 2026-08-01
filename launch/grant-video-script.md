# Grant video — what to record and what to say

**Target: 4:30, hard max 5:00.** They asked for two things: your actual code where Circle
products are wired in, and the product working. Nothing else matters — no intro music, no
logo animation, no slides. Just your screen and your voice.

**Record with:** Win + G (Game Bar) or OBS. Full screen, browser and VS Code at a zoom
where the code is readable on a laptop. Upload unlisted to YouTube, paste that link.

**Talk like you talk.** Don't read this word for word — it's what to cover, in order. If
you fumble a sentence, keep going. They're judging the code, not your delivery.

---

## PART 1 — The product, working (0:00 – 1:30)

**Screen: stubly.org**

> "This is Stubly. It's live on Arc testnet. You hire an AI agent to do a job, your USDC
> sits in escrow while it works, and you either get the work or you get your money back."

Scroll the shelf. Point at a green badge.

> "Seventeen agents. Each one has an on-chain identity in Circle's ERC-8004 registry —
> that badge links to the actual NFT on Arcscan."

**Go to /hire. Pick Site Audit. Type a URL. Click "Use PIN wallet."**

> "I want to show the buying flow with Circle's user-controlled wallets, because this is
> the part that matters for normal people. No extension, no seed phrase — this wallet was
> made with a six-digit PIN."

Do the three PIN prompts as they come.

> "Three PIN confirmations: create the order, approve the USDC, fund the escrow. Circle's
> Web SDK handles the signing — I never touch the user's keys."

**Land on the job page. Let it settle if it's fast, or cut to a finished one:
stubly.org/job?id=163256**

> "Funded, delivered, paid out. Every one of those stamps is a transaction on Arc."

---

## PART 2 — The code (1:30 – 4:00) ← the part they actually asked for

### 2a. The escrow — Circle's ERC-8183 (1:30 – 2:15)

**Open `chain/config.js`.** Point at the addresses.

> "I did not write my own escrow contract. This is Circle's ERC-8183 deployment on Arc —
> 0x0747 — and this is USDC at 0x3600. Every payment on Stubly goes through Circle's
> contract, not mine. Nobody at Stubly can touch a funded job."

**Open `chain/jobs.js`.** Scroll to `createJob`, `setBudget`, `fund`, `submit`,
`complete`, `reject`.

> "These are the six calls that move a job through its life. createJob opens it, the agent
> sets its price, the client funds the escrow, the agent submits a hash of the deliverable,
> and the evaluator either completes it — which pays the agent — or rejects it, which
> refunds the client."

Point at the `send` helper.

> "Every write gets simulated first with staticCall, so a revert costs me a log line
> instead of gas. And this retry logic exists because the public RPC on Arc returns
> malformed errors under load — I found that the hard way."

### 2b. Agent identity — Circle's ERC-8004 (2:15 – 2:45)

**Open `chain/registry.js`.**

> "This registers each agent in Circle's ERC-8004 IdentityRegistry. It mints an identity
> NFT whose metadata URI points at a public card on my domain."

**Open `site/agents/ids.json`,** then open a card in the browser:
`stubly.org/agents/launch-kit.json`

> "Seventeen agents, ids 856068 through 856136. Anyone — a person or another agent — can
> resolve that NFT and see what they're about to pay for before they pay."

### 2c. Circle Wallets (2:45 – 3:15)

**Open `site/api/circle.js`.**

> "This is the server side of Circle's user-controlled wallets. The API key stays here on
> the server; the browser only ever gets a short-lived user token and a challenge id."

Point at the `execute` action.

> "And this is how a PIN wallet pays for a job — a contract-execution challenge per step.
> The user approves it with their PIN in Circle's secure window, and Circle signs it. That's
> the flow you just watched me do."

### 2d. The agent that hires agents (3:15 – 4:00) ← lead with this if you're short on time

**Open `worker/agents/launch-kit.js`.**

> "This is the piece I haven't seen anywhere else on Arc. Launch Kit is an agent that
> doesn't do the work — it hires other agents."

Point at the `subcontract` function.

> "When someone hires it, it opens its own escrowed work orders against two other agents
> on the same Circle contract, funds them out of its own fee, waits for the deliverables,
> judges them, and settles each one. Same escrow, same rules, one level down."

**Switch to browser: stubly.org/job?id=163256** — scroll to the subcontract receipts.

> "Here's one that actually ran. Job 163256, two USDC. It hired Copy Pack and Thread
> Writer, paid each of them four-tenths of a USDC out of that fee. Three escrows, three
> payouts, all on chain."

---

## PART 3 — What's next (4:00 – 4:30)

**Screen: stubly.org/list**

> "Right now the seventeen agents are mine. The next milestone opens the shelf so outside
> builders register their own agent in the same ERC-8004 registry and get paid directly
> out of the same escrow.
>
> After that, agents become the customers — a public API with x402 payments through Circle
> Gateway, so an agent buys a job on its own without a person clicking anything.
>
> And then mainnet on day one, with fees switched on."

**End on the homepage.** Don't add an outro. Just stop.

---

## Checklist before you hit record

- [ ] `npm run watch` is running (or the job in part 1 will never settle)
- [ ] Your PIN wallet has faucet USDC in it
- [ ] VS Code font bumped up — they're watching this in a small window
- [ ] Close anything with your API keys visible: **do not show `.env` on screen**
- [ ] Do one throwaway take first. The second one is always better.
