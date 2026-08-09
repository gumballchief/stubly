# Circle 2026 Cohort 2 — every field, ready to paste

**Everything is filled in.** Written the way you'd say it — plain, first person, no
pitch-deck voice. Copy each block into the matching field.

---

## Applicant Details

**Primary contact first name**
Yousof

**Primary contact last name**
Mohamed

**Email address**
gumballchief@gmail.com

**Company Legal Entity Name**
N/A — not incorporated. Solo builder.

**Company DBA / project name**
Stubly

**Founder names, roles, bios**
Yousof Mohamed — founder, sole builder. Self-taught developer, no CS degree. I build
and ship products end to end: Slovey (slovey.dev), a context layer for AI coding agents,
published on npm and running in production. Gold Protocol (gldfi.net), a Solidity
fee-distribution protocol with a full test suite, deployed and paying holders. Stubly is
the third. I do the contracts, the backend, the frontend and the design myself.

**Project website**
https://stubly.org

**Project X handle**
@Stublydotorg

**Project GitHub URL**
https://github.com/gumballchief

**Where are you and your founders located?**
Yousof Mohamed, Founder, Arlington, Texas, United States

**Where is your business located?**
United States

**Is your business incorporated?**
No

---

## Project Abstract

**Project Name** (80 max)
Stubly

**One-liner** (200 max)
A marketplace where anyone can hire an AI agent for a real job and pay in USDC held in
escrow on Arc — the agent gets paid when the work passes, or the buyer gets refunded.

**What problem are you solving and why is it important?**
Everyone keeps saying agents will transact with each other, but if you actually try to
hire one today there is nowhere to go. You can find a demo on a hackathon page, or an API
you have to trust with your card. There is no place where a normal person picks an agent,
pays, and knows what happens if the work comes back garbage.

The missing piece isn't payments. Circle already solved payments. The missing piece is
what sits between paying and trusting: who holds the money while the work happens, who
decides if the work was any good, and what happens when it wasn't. Without that, nobody
sends money to a machine they've never met, and the agent economy stays a demo.

**What is your solution to that problem?**
Stubly is the shop floor. You pick an agent, your USDC goes into escrow, the agent does
the job, a separate evaluator wallet checks the deliverable, and the contract either pays
the agent or refunds you. Nobody at Stubly can touch a funded job — the money is in
Circle's ERC-8183 contract, not in our account.

I deliberately did not write my own escrow. Circle already deployed ERC-8183 on Arc, so I
built on it. Same for identity: all 17 agents are registered in Circle's ERC-8004
IdentityRegistry, so before you pay one, you (or another agent) can verify what it is.

Two things are live that I haven't seen anywhere else:

1. An agent that hires agents. "Launch Kit" takes a job, then opens its own escrowed work
   orders with two other agents, funds them out of its own fee, judges what they deliver,
   and assembles the result. Three escrows, three payouts, all on chain. That's job 163256
   if you want to look at it.
2. You can pay without knowing what crypto is. Circle's user-controlled wallets let a
   buyer create a wallet with a 6-digit PIN and pay for a job with three PIN taps. No
   extension, no seed phrase. I tested it as a normal user, not as a developer.

**Why hasn't this problem been solved yet? What barriers existed?**
Honestly, because the pieces only just landed. ERC-8183 was proposed in early 2026 and
Circle deployed it on Arc after that. ERC-8004 identity is just as new. Before those
existed, anyone building this had to write and secure their own escrow and their own
identity system, and nobody wants to trust a stranger's escrow contract with money.

The other barrier is that this is unglamorous. Hackathons around Arc produced hundreds of
agent demos and almost all of them stopped the day prizes were paid, because the fun part
is the agent and the boring part is the marketplace: quoting, judging, refunds, receipts,
a real site people can use. I built the boring part.

**Why are you and your team uniquely suited to solve this problem?**
I ship. Stubly went from nothing to a live product with real settled jobs in two days,
including the contracts, the worker, the site, the brand and the video. Before this I
built Slovey, which is live and on npm, and Gold Protocol, a Solidity protocol with a full
test suite that pays real holders on a live chain — so on-chain money handling isn't new
to me.

Being solo is also why the buying experience is decent. There was nobody to hand the ugly
parts to, so I had to make the refunds, the judging and the PIN wallet actually work
instead of writing them into a roadmap.

---

## Product Alignment Track

**Is your project currently live in production?**
Yes

**Are you live on Arc?**
Yes

**Which other chains are you live on?**
None. Stubly is Arc-only by design. USDC as the gas token is what makes per-job pricing
readable — a job costs 1 USDC and the fee is a fraction of a cent, in the same unit. That
doesn't work the same way anywhere else.

**Which Circle products are currently integrated?**
☑ USDC ☑ Wallets ☑ Agent Stack ☑ Other

Other: Circle's ERC-8183 agentic-jobs contract on Arc testnet
(0x0747EEf0706327138c69792bF28Cd525089e4583) holds every payment on Stubly, and Circle's
ERC-8004 IdentityRegistry (0x8004A818BFB912233c491871b3d84c89A494BD9e) holds the identity
NFT for all 17 agents (ids #856068 to #856136). Wallets = user-controlled PIN wallets via
the Web SDK, used for both wallet creation and paying for jobs.

**Which Circle products do you plan to integrate?**
☑ Gateway ☑ Paymaster ☑ EURC ☑ Contracts

Next up is agents buying from Stubly programmatically: x402 + Nanopayments through Gateway
so an agent can pay per call instead of per job, and EURC so jobs can be priced in euros.

---

## Milestones

**$40,000 total, milestone-gated.** Three milestones ship the product ($15,000, mostly
time) and land on or before Arc mainnet on **September 16**. The fourth ($25,000) is a
different kind of work: turning the settlement layer under Stubly into something other Arc
teams build on.

**Milestone 1 — Open the shelf to outside agents ($5,000 · week 1)**
Self-serve listing: an outside builder registers in ERC-8004, applies through the site, and
gets paid to their own wallet out of the same escrow. The gate is mechanical — their endpoint
gets a real test job, judged by the same published rules that settle every paid job. Done when
5 third-party agents are listed and one outside payout has settled on Arc.

**Milestone 2 — Let agents be the customers, x402 API ($5,000 · weeks 2–3)**
Public API with x402 through Circle Gateway and Nanopayments, so an agent buys a job per call
with nobody clicking. Done when 100 orders have been placed by agents, not humans.

**Milestone 3 — Arc mainnet on day one, September 16 ($5,000)**
Redeploy against mainnet ERC-8183/8004, fee switch on, security pass over the money flow,
monitoring. Done when Stubly is on mainnet and 50 real orders have settled.

**Milestone 4 — The settlement layer other Arc teams build on ($25,000 · by October 31)**
Open-source SDK for ERC-8183 and ERC-8004 — full job lifecycle plus the production details
that are easy to get wrong (staticCall before send, nonce management, fee overrides, retries
against unreliable RPCs, the refund path). A judge others can verify or fork, keeping the
on-chain verdict fingerprint. EURC so jobs price in euros. Done when 3 independent teams have
shipped on the SDK, 1,000 mainnet jobs have settled, and euro pricing is live.

Why this one costs more: milestones 1–3 grow one marketplace. This one makes escrowed agent
work a primitive any Arc team can ship in an afternoon — and every team that does generates
ERC-8183 volume on Arc that Stubly never has to generate itself.

---

## Traction and Roadmap

**Current traction**
Everything here is on chain and checkable:
- 18+ work orders created and settled through Circle's ERC-8183 contract on Arc testnet
- 4 separate hirer wallets
- 17 agents live, each with an ERC-8004 identity NFT (#856068–#856136) resolving to a
  public card at stubly.org/agents/
- Two purchases made by a real buyer end to end: one with MetaMask, one paid entirely with
  a Circle PIN wallet by someone who never installed a wallet extension
- Job 163256: an agent autonomously hired two other agents, funded both escrows from its
  own fee, judged their deliverables and settled all three

No revenue yet — it's testnet, and fees are switched off on purpose while people try it.

**Analytics dashboard link**
N/A. There's no Dune coverage of Arc yet. Stubly counts its own numbers straight from the
chain — the counter on stubly.org reads live from the ERC-8183 contract, and every job is
public at stubly.org/job?id=163256 or on Arcscan.

**Are you funded?**
No. Self-funded. Total spend so far is a domain.

**Technical roadmap**
Weeks 1–3: open agent onboarding. A registration flow that walks an outside builder
through publishing an agent card, registering it in ERC-8004, and getting listed. Payouts
route to their wallet through the same escrow.

Weeks 4–7: agents as buyers. Public API with x402 payments, settled through Circle Gateway
and Nanopayments so an agent can pay sub-cent per call. This is where Stubly stops being a
website with agents on it and becomes infrastructure agents use.

Weeks 8–10: mainnet readiness. Platform fee switch in the settlement path, hosted worker
with retries so settlement doesn't depend on my machine, monitoring and alerting, and a
security pass over the whole flow before real money touches it.

**How will this grant support your roadmap?**
The two things I can't brute force alone are hosting that stays up and time. The grant
pays for a hosted worker and infrastructure so jobs settle 24/7 instead of while my PC is
on, and it buys me the runway to do milestone 2 properly instead of shipping a half API.
Milestone 3 is the one that matters to Circle: it puts Stubly on Arc mainnet on day one
with fees on, which turns testnet activity into actual USDC volume.

---

## Deck and Demo

**Video demo** — https://youtu.be/LMxC_JShWnk (unlisted, 4:52)

**Investor deck** — `launch/deck.html` → PDF at `~/Videos/Captures/Stubly deck.pdf`. Not hosted anywhere; Yousof chooses where it goes.

---

## Conflict of Interest
No

---

# Status

**Every field on the Questbook form is filled and saved as a draft.** Verified by reloading
the form: zero empty fields, all values persisted server-side.

Nothing is submitted. That's Yousof's call — the Submit Proposal button is the last step
and I deliberately did not press it.
