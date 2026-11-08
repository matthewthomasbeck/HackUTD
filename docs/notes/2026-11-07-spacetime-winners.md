# SpacetimeDB track winners at Cal Hacks 13.0

Source: the three Devpost pages Cayden shared on 2026-11-07, read in Chrome the same day.
All three won "[Spacetime] Best Use of Spacetime" at Cal Hacks 13.0.
None of them uses physical hardware.

## skyFall (4 people)

https://devpost.com/software/skyfall-uca4i9 (live at isitfalling.us)

- A live 3D globe of satellites and rocket bodies that are about to re-enter, with probabilistic re-entry windows, debris survival per component, and impact zones.
- SpacetimeDB is the whole backend and the orchestrator: one TypeScript module with 32 tables, 29 reducers, 4 procedures, and 6 schedules.
  There is no other server, database, or message queue.
- Scheduled procedures make outbound HTTP calls from inside the database to ingest NOAA and CelesTrak data.
- A job queue with leases: workers take jobs, a sweep reducer requeues expired leases every 2 seconds, and workers are stateless.
- Failover is a database rule: CPU workers get no jobs while a healthy GPU worker exists.
  They measured 7 seconds from killing the GPU worker to the next finished job.
- Results chain: a published forecast queues a debris job when the re-entry chance in 72 h is at least 20%.
- Self-scoring: when the official decay date arrives, the module scores the last forecast against it.
- The client subscribes to tables directly, with no polling and no API layer.
- GPU Monte Carlo physics on an ASUS Ascent GX10, with concrete throughput numbers on the page.
- They label every number as real, modeled, or assumed, and show uncertainty honestly.

## Vouch (3 people)

https://devpost.com/software/vouch-7i3bft

- Agent-reviewed refund claims: a customer records a video, agents investigate it, and the merchant gets an evidence-backed recommendation.
- SpacetimeDB holds the shared state and enforces the rules: authorization, controller approval for refunds above $500, separation of propose, decide, and post, and no duplicate score updates.
- Scheduled reducers run a simulated economy inside the database: 10,000 shoppers and 100 merchants.
- Agents (Factory Droid, CREAO) use custom tools such as `get_case` and `recommend_refund`, but they have no payment authority.
  A rejection goes to a human instead of an automatic denial.
- Every finding cites an artifact and a time window, so a merchant can verify it.
- Progress shows through database rows, and browser subscriptions keep every view in sync.
- Measured: one recorded review finished in 155 seconds.

## Pacioli (2 people)

https://devpost.com/software/pacioli

- Automated bookkeeping on one live collaborative canvas.
  A Bookkeeper agent sorts transactions, matches bills, and posts to the ledger, with a reason for each call.
- Only unsure decisions reach a person ("Needs you"), with evidence and a suggested answer.
  The person's answers become patterns that the agent uses next time.
- SpacetimeDB gives real-time sync for the collaborative canvas.
- Mock bank data comes from Capital One's Nessie, and the agents run on Factory's Droid API.

## What the three have in common

- SpacetimeDB is the core of the product, not storage on the side.
  Server logic, scheduling, and rules live in reducers.
- Agents propose actions, and database rules bound what they can do.
  People handle the uncertain or high-risk cases.
- Every view is a live subscription, so the demo updates in real time.
- Simulated data at scale (a 10,000-shopper economy, mock bank data) or live public data stands in for real customers.
- The pages give measured numbers (7 s failover, 155 s review, particle throughput).
