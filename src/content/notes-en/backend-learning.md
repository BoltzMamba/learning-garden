---
title: "Backend Learning Notes"
description: "Learning high concurrency, distributed systems and middleware through a conversational AIGC agent project."
translation:
  mode: auto
  sourceHash: "sha256:58e00906e5117111008a0cd100ff76f62db1c2a576cc75825832ec661604b94e"
  generatedHash: "sha256:071c9caa143b2def04adbe31cc3e5bbb802c8e6b694a5034836d9b2c9d6696f9"
  rulesVersion: 1
---

## Background

During my internship I helped build a conversational AIGC agent: users ask the agent in a chat to generate images and videos, the agent hands the generation job to the backend, the backend passes it to a generation service, and the result is posted back into the conversation. Users pay with "points". There are three generation services: the first demo calls a third-party API (fal); in production, images go to the company infra team's GPU cluster, through an interface I designed; videos call the Wan API.

This backend has to guard against two classes of typical problems.

**Correctness**:

- network retries causing **duplicate orders and double charges**;
- several requests deducting points at the same time and causing an **overdraft**;
- a process crashing midway, so that **the points are charged but no image arrives**, or **the image arrives but the message is sent twice**;
- after the user changes the request, **an old result overwriting the new one**;
- notifications from external services that are **duplicated, out of order or untrustworthy**: a callback is sent twice, `running` arrives after `succeeded`, or the service reports "succeeded" but the output was never written.

**Capacity**:

- users concentrate their usage in one or two late-night hours, so **both the GPUs and the video API have queues**. The submission volume is modest, but each job occupies a resource for tens of seconds to several minutes;
- the product is growing fast, and the closer resource utilization gets to full load, **the more sharply waiting times grow**;
- with many jobs in flight, **status queries far outnumber submissions**;
- video is billed per second, so both the concurrency quota and the **cost** have limits.

How the GPUs queue and schedule work is the infra team's responsibility. I am responsible for the interface that connects to it: an explicit accept or reject, jobs that can always be found again, reliable completion notifications, and, based on these, the accounting and the feedback to users. But designing that interface well requires understanding how the queue on the other side works.

At the time I knew little about backend development, and much of the implementation relied on AI, which brought many limitations and risks. Now I am relearning the backend knowledge this project involves.

This series covers only the three tracks needed to understand this design: high concurrency (including queuing and capacity), distributed systems and middleware. Database migrations, containers, and login security are out of scope.

## Learning Path

| Stage | Topic | Afterwards you can answer |
| --- | --- | --- |
| 1 | Concurrency prerequisites: unique constraints, transactions, isolation levels, lost updates | Why "check, then write" fails under concurrency |
| 2 | High-concurrency control: row locks, conditional updates, deadlocks, `SKIP LOCKED`, idempotency, ledger invariants | How to avoid double charges and overdrafts |
| 3 | Distributed systems: partial failure, leases, fencing tokens, reconciliation, the transactional outbox, delivery semantics; deduplicating, ordering and verifying callbacks | What happens when a worker dies; how to keep a database write and a message consistent; why an external notification cannot be taken as fact |
| 4 | Queuing, rate limiting and capacity: Little's law and utilization, backpressure, common GPU queue implementations (priorities, fair scheduling, batching), token-bucket rate limiting, retry backoff and circuit breakers | How long the peak-hour wait is; why queries outnumber submissions; what to do when the queue is full |
| 5 | Middleware: message queues, Redis, the trade-offs of using PostgreSQL as a queue, object storage and signed URLs | Why use PostgreSQL as the task queue instead of Redis or an MQ |
| 6 | Putting it together: map every mechanism on the generation path to the problem it prevents, and explain why the interface with infra is designed the way it is | Explain end to end what one generation request goes through in the backend |

Tech stack: PostgreSQL 16, MinIO (S3-compatible object storage), Python 3.13, FastAPI.
