---
title: "Backend Learning Notes 01: Concurrency Prerequisites (Why Simultaneous Requests Corrupt Data)"
description: "Starting from the race in \"check, then write\", understand unique constraints, transactions, MVCC and isolation levels, lost updates, and how they work together in point charging."
translation:
  mode: auto
  sourceHash: "sha256:f50dd5cd7ef4375059acc37c9121f6d73a7ef30eb2fe6bd3902666d33578b0b8"
  generatedHash: "sha256:e7fbd256cd1b1d428b8df0f8a217bc8097fd3b676c2669f56df017bcc386712f"
  rulesVersion: 1
---

This is stage 1 of the backend learning path, focused on the database knowledge that concurrency problems require. The examples come from the conversational AIGC agent project I worked on during my internship: users pay with "points" to generate images, and the backend keeps the books in PostgreSQL.

## 0. Goals and the Core Question

The whole note answers one question: **when several requests operate on the same data at the same time, how do you keep the business rules intact?**

Afterwards you should be able to:

1. explain why "check, then write" fails under concurrency, and why a unique constraint does not;
2. explain what a transaction guarantees and what it does **not** guarantee;
3. use MVCC and snapshots to explain the difference between READ COMMITTED and REPEATABLE READ;
4. draw a timeline of a "lost update", and choose between a conditional update, `SELECT … FOR UPDATE` and a higher isolation level;
5. explain what transactions, unique constraints and row locks each take care of in the charging flow, and why a slow external call must not run inside a transaction that holds a row lock.

The shift in thinking to make: in algorithm exercises, a variable stays the same unless you change it yourself; **in a backend, the database is mutable state shared by many requests, and any value you read can go stale at any moment.** Idempotency, leases and task queues in later stages all build on this.

## 1. Race Conditions

### 1.1 Serial and Concurrent Execution

Suppose the AIGC platform has a user with a balance of 10 points, and each image costs 8 points.

Following the way we usually write Python programs, the charging logic looks like this:

```python
# fetch the user's balance; if it is enough, deduct and generate the image
balance = get_balance(user_id)        # read
if balance >= 8:                      # check
    save_balance(user_id, balance - 8)  # write
    generate_image()
```

If the program runs **serially**, this code is perfectly fine.

```
request A: reads 10 → enough → writes 2 → generates
request B: reads 2 → not enough → rejected
result: balance 2, 1 generation ✓
```

But a real backend does not run like this:

The same user can open two windows or submit from two conversations at once, and the backend handles requests with several coroutines, processes or even machines.

This means the steps of two requests can **interleave**:

| Time | Request A | Request B | Database balance |
| --- | --- | --- | ---: |
| t1 | Reads a balance of 10 | — | 10 |
| t2 | — | Reads a balance of 10 | 10 |
| t3 | Enough; writes back 2 | — | 2 |
| t4 | — | Enough; writes back 2 | 2 |

**Result:** both requests passed the check and each generated once. The two generations should have cost 16 points, but the balance only went from 10 to 2, so only 8 points were actually deducted. B's write overwrote A's charge; this is a "lost update".

Here each request is correct on its own, because **the bug is not in the logic of a single request but in the interaction between requests**. This is called a **race condition**.

### 1.2 TOCTOU: True When Checked, Stale When Used

The code above silently assumes:

Nobody else changes the balance between the read and the write.

This gap between "check" and "use" has its own name: **TOCTOU** (time of check to time of use).

Under concurrency this assumption does not hold. Even if the two lines are only 1 microsecond apart, the race exists, because **other requests may modify the data in that moment**.

This is also why concurrency bugs are hard to reproduce:

A hundred local test runs may pass, but in production, with more requests, two of them happen to interleave in a particular order and the problem appears.

A classic case of this kind of problem is duplicate sign-up.

```python
# check whether the email exists; if not, create a new account with it
row = db.execute("SELECT 1 FROM users WHERE email = %s", [email]).fetchone()
if row is None:
    db.execute("INSERT INTO users (email) VALUES (%s)", [email])
```

Two requests sign up with `a@x.com` at the same time → both find "not found" → both inserts succeed → two accounts with the same email.

### 1.3 Unique Constraints (UNIQUE): Let the Database Enforce the Rule

We can declare a rule to the database: **no matter how many requests arrive or how they interleave, two rows with the same email are never allowed.** It is backed by a unique index.

```sql
CREATE TABLE users (            -- create a table named users
  user_id BIGSERIAL PRIMARY KEY,-- an auto-incrementing big integer, used as the primary key
  email   TEXT NOT NULL UNIQUE  -- text; cannot be null; cannot repeat another user's
);
```

Now back to the sign-up case:

With UNIQUE on email, suppose A has inserted `a@x.com` but not committed yet, and B also inserts `a@x.com`.

When PostgreSQL checks the unique index, it finds the same email already inserted by A, but does not yet know whether that row will survive, so it makes B's INSERT wait. After A commits, B's insert fails with a unique violation, and Python catches `UniqueViolation` and returns "email already registered".

| Time | Transaction A | Transaction B |
| --- | --- | --- |
| t1 | Begins, inserts `a@x.com`, not committed yet | — |
| t2 | Still not committed | Begins, tries to insert `a@x.com`, waits for A's outcome |
| t3 (if A commits) | `COMMIT` | Stops waiting; the insert fails with `duplicate key` (the email is taken) |
| t3 (if A rolls back) | `ROLLBACK` | Stops waiting; the insert proceeds and succeeds |

So the Python backend can drop the separate SELECT, insert directly, and catch the conflict:

```python
import psycopg

try:
    with conn.transaction():
        # INSERT directly; the database checks automatically during the write.
        conn.execute("INSERT INTO users (email) VALUES (%s)", [email])
except psycopg.errors.UniqueViolation:
    return "邮箱已注册"
```

### 1.4 `ON CONFLICT`: A Conflict Is Not Always an Error

When two requests hit a uniqueness conflict, the database raises an exception by default.

But in some situations a repeated request is not an error, for example when a client resends the same request after a network timeout.

You can then declare how to handle the conflict instead of raising an exception:

```sql
-- try to register a@x.com: return the new user's ID on success, skip the insert if the email is taken
INSERT INTO users (email) VALUES ('a@x.com') -- try to insert a user row
ON CONFLICT (email) DO NOTHING  -- if the email unique constraint fires, skip
RETURNING user_id;     -- returns the new id on insert; empty means the email already exists
```

This is the foundation for **idempotency**, the topic of the next stage:

**running the same business request several times must not produce its business side effects several times.**

### 1.5 The Same Problem Elsewhere in the Project

| Scenario | With "check, then write" | What the project does |
| --- | --- | --- |
| Sign-up with the same email | Two accounts | `UNIQUE(email)` |
| A network retry accepts a generation twice | Two jobs, charged twice | `UNIQUE(source_message_id, step_id, revision, attempt_seq)` (stage 2) |
| Result handling runs twice | Charge confirmed twice | Ledger `UNIQUE(action_id, kind)` (stage 2) |
| A delivery event is consumed twice | Two messages in the conversation | Deduplicate by `event_id` (stage 3) |

## 2. Database Transactions

### 2.1 The Problem: A Crash Halfway Through

Set concurrency aside for a moment. Suppose the agent receives an image generation request and needs to do two things in the database:

① reserve 8 points; ② create a generation job.

In business terms the two belong together, but in the database they are two separate SQL statements.

```python
db.execute("UPDATE point_accounts ...")
db.execute("INSERT INTO generation_actions ...")
```

If the server crashes right after the first statement executes and commits, the user has paid but the system has no job.

```
① UPDATE reserve points  → succeeds and takes effect
   💥 the server crashes
② INSERT generation job  → never runs
```

Conversely, creating the job first and charging second can leave a created job that was never charged.

So we need the database to treat the two steps as one unit.

### 2.2 How It Works and How to Use It

In SQL, we wrap the two statements with BEGIN and COMMIT, and undo them with ROLLBACK on failure.

```sql
BEGIN;      -- start a transaction

UPDATE point_accounts
SET reserved_milli = reserved_milli + 8000
WHERE user_id = 1;  -- reserve 8 points for the user

INSERT INTO generation_actions (...) VALUES (...); -- record one generation

COMMIT;      -- commit; if any step fails midway → ROLLBACK, and neither takes effect
```

| Statement | Meaning |
| --- | --- |
| `BEGIN` | Start a transaction |
| `COMMIT` | Commit; all changes take effect |
| `ROLLBACK` | Roll back; undo this transaction's uncommitted changes |

In Python, psycopg provides `with conn.transaction():` to manage this.

Put both statements in the indented block: leaving it normally commits, and an exception rolls back.

The object `conn.transaction()` returns is called a context manager.

```python
with conn.transaction():
    conn.execute("UPDATE point_accounts ...")
    conn.execute("INSERT INTO generation_actions ...")
```

This is transaction **atomicity**. It does not mean the two statements physically run at the same instant; it means that **in the result that takes effect, these operations cannot be split apart**.

### 2.3 Limits: Transaction ≠ Lock ≠ Serial Execution

However, a transaction does not directly solve concurrency problems; this is the easiest point to misunderstand at this stage.

A transaction is a **logical unit** (its changes take effect together or are undone together), not a unit of execution that "owns the database".

The database does not wait for one transaction to finish before running the next; the steps of several transactions still interleave.

Suppose A and B both put the sign-up code in a transaction. At PostgreSQL's default level and without a unique constraint, the database ends up with two accounts with the same email.

```
time →   transaction A             transaction B
  t1   BEGIN
  t2   SELECT → not found
  t3                            BEGIN
  t4                            SELECT → not found
  t5   INSERT
  t6                            INSERT
  t7   COMMIT
  t8                            COMMIT
```

Both transactions ran to completion and no operation was left half done, so atomicity was not violated, yet the result is still wrong.

This shows another guarantee is needed to control how **transactions affect each other**: **isolation**.

### 2.4 ACID

| Property | Question it answers | Example in the charging scenario |
| --- | --- | --- |
| **A Atomicity** | What if it fails halfway? | Reserving points and creating the job must take effect together |
| C Consistency | Does the data satisfy the rules before and after? | The balance cannot go negative; a job cannot be duplicated |
| **I Isolation** | What do concurrent transactions see of each other? | Two generation requests must not decide based on the same stale balance |
| D Durability | What if the power fails after commit? | A committed charge can be recovered (via the write-ahead log, WAL) |

At this stage we need to master A and I:

**Atomicity handles failure inside one transaction; isolation handles interference between transactions.**

Also, consistency is not handed to you by the database. For example, the database does not know that "one image costs 8 points"; it only checks the constraints you declare. Business rules are kept by constraints, atomicity, isolation and your code together.

## 3. MVCC and Isolation Levels

### 3.1 Prerequisite: MVCC, Multiple Versions and Snapshots

PostgreSQL handles concurrent reads and writes with **MVCC** (Multi-Version Concurrency Control): when a row is modified, the old version does not disappear immediately. The database keeps both the old and new versions, and uses **visibility rules** to decide which version each transaction reads.

Suppose the balance was 10 points, and transaction A is deducting 8 but has not committed:

| Who reads | Sees | Why |
| --- | --- | --- |
| Transaction A itself | 2 | A transaction sees its own changes |
| A plain `SELECT` in transaction B | 10 | A's new version is uncommitted and invisible to others |

B can read the old version, 10 points, directly, **without waiting for A to commit**. So a plain SELECT and an UPDATE of the same row can run concurrently without waiting for each other.

Which version B sees depends on the **snapshot** it uses. A snapshot draws a time boundary for the read, and PostgreSQL uses it to decide whether other transactions' changes are visible. In this example, A had not committed when B took its snapshot, so B reads the old version, 10 points.

If A then commits and B queries again, does B read 2 or still 10? That depends on whether the second query takes a new snapshot or reuses the old one, which is what isolation levels, covered next, are about.

### 3.2 Three Read Anomalies

| Anomaly | In one sentence | Example |
| --- | --- | --- |
| Dirty read | Reading data someone else has **not yet committed** | Someone deducted money and later rolled back, but you decided based on the deducted balance. Never happens at any level in PostgreSQL |
| Non-repeatable read | Reading **the same row** twice in one transaction gives different contents | The first read shows a balance of 10; someone deducts and commits; the second read shows 2 |
| Phantom read | Running a query with **the same condition** twice in one transaction returns a different set of rows | The first query finds 1 running job; someone inserts and commits another; the second query finds 2 |

#### Dirty Read

| Time | Transaction A | Transaction B |
| --- | --- | --- |
| t1 | Changes the balance from 10 to 2, not committed | — |
| t2 | — | Reads a balance of 2 |
| t3 | Runs `ROLLBACK`; the balance returns to 10 | — |

**Result:** B read a balance that A had not committed and later undid.

#### Non-repeatable Read

| Time | Transaction A | Transaction B |
| --- | --- | --- |
| t1 | Runs `BEGIN` to start a transaction | — |
| t2 | First read of the balance: 10 | — |
| t3 | — | Deducts 8 and commits |
| t4 | Second read of the same account's balance: 2 | — |
| t5 | Runs `COMMIT` | — |

**Result:** within one transaction, A **read the same row twice** and got different balances.

#### Phantom Read

| Time | Transaction A | Transaction B |
| --- | --- | --- |
| t1 | First query for jobs returns `Task 001`, 1 row | — |
| t2 | — | Inserts a new job `Task 002` that matches the query, and commits |
| t3 | The same query again returns `Task 001` and `Task 002`, 2 rows | — |

**Result:** within one transaction, A **ran the same query twice**, and the second run had one more matching row.

The difference between a non-repeatable read and a dirty read: in a non-repeatable read, both values read are real committed data; the problem is that the view inside one transaction is not stable.

The difference between a non-repeatable read and a phantom read: in a non-repeatable read, the contents of the same row changed; in a phantom read, the set of rows matching the same condition changed.

### 3.3 Four Isolation Levels

| Isolation level | What PostgreSQL actually does |
| --- | --- |
| `READ UNCOMMITTED` | **Runs as RC.** In PostgreSQL, even at this level, other transactions' uncommitted changes are never visible. |
| `READ COMMITTED` (RC, default) | **Each non-transaction-control statement (such as `SELECT`) takes a new snapshot when it starts.** Within one transaction, a second query can see changes others committed between the two queries. |
| `REPEATABLE READ` (RR) | **The whole transaction reuses one snapshot.** It is taken when the first non-transaction-control statement starts, such as the first `SELECT`. Changes others commit later stay invisible to that snapshot, while the transaction's own changes are still visible. |
| `SERIALIZABLE` | Plain reads follow RR's snapshot rules, **plus checks on the read-write relationships between concurrent transactions**. If their results cannot be explained by some serial order, the database makes the transactions involved fail and roll back, and the application can retry the whole transaction. |

**Transaction-control statements:** `BEGIN`, `COMMIT`, `ROLLBACK`, `SET TRANSACTION`.

**Non-transaction-control statements:** `SELECT`, `UPDATE`, `INSERT`, `DELETE`, and so on.

Suppose the balance was 10 points and the only job was Task 001. The three rows below are three separate small experiments; A queries twice in one transaction and modifies nothing itself.

| When B changes what | What A sees under RC | What A sees under PostgreSQL RR |
| --- | --- | --- |
| **Dirty read**: B changes the balance to 2, and **has not committed** when A queries the second time | `10 → 10`. A new snapshot cannot see the uncommitted 2 either | `10 → 10` |
| **Non-repeatable read**: between the two queries B changes the balance to 2 **and commits** | `10 → 2`. The second snapshot sees the row's new value | `10 → 10`. It reuses the original snapshot |
| **Phantom read**: between the two queries B inserts a matching `Task 002` **and commits** | `1 row → 2 rows`. The second snapshot sees the newly matching row | `1 row → 1 row`. It reuses the original snapshot |

So RC prevents dirty reads because even a new snapshot only shows changes other transactions have committed. PostgreSQL's RR also prevents non-repeatable and phantom reads because the second query reuses the original snapshot.

The same snapshot rule decides both "what this row's value is" and "which rows match the condition".

| Level | Dirty read | Non-repeatable read | Phantom read | What PostgreSQL actually does |
| --- | --- | --- | --- | --- |
| READ UNCOMMITTED | Possible | Possible | Possible | Runs as READ COMMITTED |
| **READ COMMITTED** (RC) | No | Possible | Possible | **PostgreSQL default** |
| REPEATABLE READ (RR) | No | No | Allowed by the SQL standard | No phantom reads in PostgreSQL either; **MySQL InnoDB defaults to RR** |
| SERIALIZABLE | No | No | No | Guarantees that committed transactions have the same overall effect as running in some serial order, failing transactions when necessary |

The table summarizes the SQL standard; no need to memorize it. What matters is the difference between RC and RR.

### 3.4 RR Already Prevents All Three Read Anomalies, So Why SERIALIZABLE?

Suppose the business rule is "each user may have at most 1 running generation job". The user sends two generation requests at once, and transactions A and B each first count this user's running jobs, inserting their own job only if the count is 0. Assume this rule is enforced only by this query logic.

| Time | Transaction A | Transaction B |
| --- | --- | --- |
| t1 | Counts running jobs: 0 | — |
| t2 | — | Counts running jobs: also 0 |
| t3 | Inserts its own job `Task 001`, tries to commit | — |
| t4 | — | Inserts its own job `Task 002`, tries to commit |

**Under PostgreSQL's RR, both transactions may commit successfully.** When A and B took their snapshots there were no running jobs, so each counted 0. They then insert two different rows, possibly leaving 2 running jobs. Each transaction queried only once, and the business rule is still violated. RR gives each transaction a stable view for reading, but two transactions can still each decide based on the same initial state. This kind of anomaly is called **write skew**: two transactions read the same data and each writes a different row; each is valid on its own, but together they violate the rule.

**Under SERIALIZABLE, the two transactions cannot both commit with this outcome.** If A ran to completion and committed first, B's query would then see 1 job and not insert. If B ran first, A would see 1 too. In either serial order only one job is created. PostgreSQL lets the two transactions run concurrently but uses a serialization error to stop both from committing. The side that fails, if it retries, must re-run the whole transaction from counting the jobs.

## 4. Lost Updates and Concurrency Control

Suppose the user has a balance of 10 points, and two requests each ask to spend 8 points on an image at the same time.

The database stores integers in thousandths of a point, so the balance is 10000 and each deduction is 8000.

By the business rule, only one of the requests may go through.

### 4.1 The Two Writes Ran One After the Other, So Why Was a Deduction Lost?

The original code reads the balance with a plain SELECT, checks in Python whether it is enough and computes the new balance, then writes the computed value back to the database.

```python
bal = db.execute("SELECT balance_milli FROM point_accounts WHERE user_id = 1").fetchone()[0]
if bal >= 8000:
    db.execute("UPDATE point_accounts SET balance_milli = %s WHERE user_id = 1", [bal - 8000])
```

| Time | Transaction A | Transaction B |
| --- | --- | --- |
| t1 | Reads `10000`, enough, computes a new balance of `2000` | - |
| t2 | - | Also reads `10000`, enough, computes a new balance of `2000` |
| t3 | Sets the balance to `2000`, commits | - |
| t4 | - | Sets the balance to `2000`, commits |

Both requests passed the balance check, yet the balance dropped by only 8 points. Both requests tried to deduct, and one deduction is missing from the final balance. This is a **lost update**.

The problem is that **B writes a value computed at t2**. `bal` in Python is the balance read at that time, and it is still 10000 after A commits. What B finally sends to the database is just `SET balance_milli = 2000`, with no condition saying "the balance I read earlier was 10000".

UPDATE's row lock makes writes to the same row happen one at a time. In this timeline, A has already committed when B writes, so B updates directly. Even if B sends its UPDATE before A commits, it merely waits for A to release the lock and then still sets the balance to 2000. **The row lock orders the writes, but B's deduction check and computation were finished long before it took the lock.**

### 4.2 Conditional Update: Check the Balance and Deduct in One SQL Statement

Assuming no extra non-negative balance constraint, the three styles differ as follows. All amounts in the table are in the database's storage unit.

| Style | What B does after A commits | Final result |
| --- | --- | --- |
| `SET balance_milli = 2000` | Sets the balance to `2000` again | Both requests go through; one deduction is lost |
| `SET balance_milli = balance_milli - 8000` | Subtracts `8000` from the current `2000` | Both deductions take effect; the balance becomes `-6000` |
| The relative deduction plus `AND balance_milli >= 8000` | Checks the current balance and finds `2000` is not enough | Only A goes through; `2000` remains |

The relative update solves whether a deduction gets overwritten. The balance condition in `WHERE` solves whether this money can still be deducted right now. A real deduction needs both.

```sql
UPDATE point_accounts
SET balance_milli = balance_milli - 8000
WHERE user_id = 1 AND balance_milli >= 8000;
```

Under PostgreSQL's default READ COMMITTED, if B's UPDATE finds the row while A is modifying it, B waits. After A commits, PostgreSQL re-checks B's WHERE against the updated row. The balance is now 2000, the condition fails, and B updates 0 rows. If B's statement starts only after A commits, it sees 2000 from the beginning.

```python
cur = conn.execute(
    """UPDATE point_accounts
       SET balance_milli = balance_milli - 8000
       WHERE user_id = %s AND balance_milli >= 8000""",
    [user_id],
)
if cur.rowcount == 1:
    ...  # deducted
else:
    ...  # insufficient balance; if the account is not guaranteed to exist, it may also be missing
```

Python decides the statement's outcome from `cur.rowcount`. 1 row updated means the deduction was executed in the current transaction and takes effect once the transaction commits. 0 rows means nothing was deducted. If the business guarantees the account exists, this means insufficient balance; otherwise the account may also be missing.

### 4.3 SELECT … FOR UPDATE: Lock the Account First, Then Decide in Python

If the deduction rule is better written in Python, **lock the account row when reading the balance**, and do the read, check and write-back in the same transaction. The code below assumes the account exists.

```python
with conn.transaction():
    bal = conn.execute(
        "SELECT balance_milli FROM point_accounts WHERE user_id = %s FOR UPDATE",
        [user_id],
    ).fetchone()[0]
    if bal >= 8000:          # any complex Python check can go here
        conn.execute(
            "UPDATE point_accounts SET balance_milli = %s WHERE user_id = %s",
            [bal - 8000, user_id],
        )
```

Under READ COMMITTED, A reads 10000 with FOR UPDATE and locks the row. B's own SELECT … FOR UPDATE waits at the read. Only after A deducts and commits does B get the lock, read 2000, and decide in Python that the balance is insufficient. Writing back an absolute value is safe here, because from A's read to A's write-back no other transaction can modify the row.

| Time | Transaction A | Transaction B |
| --- | --- | --- |
| t1 | Runs `SELECT … FOR UPDATE`, reads `10000`, locks the account row | — |
| t2 | — | Runs `SELECT … FOR UPDATE`, waits for A to release the row lock |
| t3 | Runs `UPDATE` setting the balance to `2000`, then `COMMIT` releases the row lock | — |
| t4 | — | Gets the row lock and reads the latest balance, `2000`. Less than `8000`, so it rejects this generation request |

The scope of the lock decides what it protects:

- **It locks the account rows it found.** Locking user 1's account row does not stop user 2 from deducting from their own account. When no row is found there is nothing to lock, so preventing duplicate emails still relies on the unique constraint.

- **The lock lasts until the transaction ends.** Plain SELECTs can still read the visible version under MVCC. `UPDATE`, `DELETE` and conflicting locking reads on the same row must wait.

- **When the check uses other data, be explicit about how that data is protected.** For example, if you count concurrent jobs from the job table, every entry point that changes the job count must follow the same account-locking convention, or the job count needs its own concurrency control. The account row lock by itself only protects the account row.

Likewise, if another deduction path reads the balance with a plain SELECT and writes back a result computed from the old value, it can still overwrite other transactions' updates. Every path that modifies the balance must follow compatible write rules.

### 4.4 For Comparison: The Same Faulty Code Under REPEATABLE READ

Put the timeline from 4.1 under PostgreSQL's REPEATABLE READ. A and B both first read 10000, but after A commits, when B tries to update the same row from its snapshot, PostgreSQL raises a serialization failure caused by the concurrent update (SQLSTATE 40001). The application must roll back and retry the whole transaction from the start, so that the balance read and the deduction check run again. The retry then reads the 2000 that A committed.

This project handles deductions with the first two approaches. A conditional update moves the check to the database write, and `FOR UPDATE` moves the lock forward to the read. Both make sure the deduction decision is based on the row this write actually modifies.

## 5. Engineering Practice in the Agent Project

> The following uses one image generation request to show how acceptance, generation and settlement connect.

### 5.1 Why Split One Generation into Two Short Transactions?

The user has 10 points and starts a generation that needs 8. When the backend accepts it, it first sets aside 8 points for this job, so the user cannot spend them again in another conversation. What finally happens to those 8 points is known only after the generation result arrives.

If the whole process went into one transaction:

```python
with conn.transaction():
    lock_user_account()                   # SELECT … FOR UPDATE
    reserve_points()
    result = call_image_generation_api()  # takes, say, 30 seconds
    save_result(result)
```

then during the 30 seconds of waiting for the result:

1. **The account row stays locked.** The same user's other requests that also need to modify the account must wait for this transaction to end.

2. **The database connection stays occupied.** When many requests wait on generation results at once, the connection pool can run out and affect other users.

3. **The external call has its own outcome.** If the generation service has already accepted or billed the job and a later local write fails, the database rollback only undoes local changes. What already happened externally has to be handled separately by the application.

```python
with conn.transaction():    # short transaction: acceptance
    lock_user_account()     # lock the account
    reserve_points()        # freeze 8 points
    create_task()           # create the job; leaving the with block commits and releases the account row lock

# after a worker claims the committed job, it calls the service outside any transaction
# other requests can still check or modify the account, but can only spend the remaining 2 points
result = call_image_generation_api()

with conn.transaction():    # new short transaction: settlement
    settle_points(result)   # confirm the charge on success, unfreeze on an explicit failure
    update_task_status(result)  # update the job status
```

So **first commit "points frozen, job created" in the database, then let a worker call the generation service, and settle in a separate transaction once the result arrives.** After the first commit, the account row lock is released. Other requests can keep checking the balance; only 2 points are available to them now.

### 5.2 How Is One Request Accepted, Generated and Settled?

| Step | What the backend does | What each mechanism is responsible for |
| --- | --- | --- |
| **Accept the request** | The client sends a business request ID. The backend records the acceptance, checks the available balance, freezes the points and creates the job, then commits. | The **unique constraint** blocks repeated acceptance of the same request. A **conditional update or account row lock** stops different requests from claiming the same available balance at once. The **transaction** makes freezing the points and creating the job commit together. |
| **Call the generation service** | A worker claims the committed job and calls the external generation service after the claim transaction ends. | During the call, the database locks used for acceptance and claiming have all been released. |
| **Settle the job** | Confirm the charge on success, release the freeze on an explicit failure. The point change and the job status update are in the same short transaction. | The **transaction** makes settlement and the job status commit together. How to avoid settling twice when a result is processed repeatedly is covered with idempotency in stage 2. |
| **Deliver the result** | Notify the user of the stored result. | Reliable event delivery and deduplication by event ID are covered in stage 3. |

The easiest thing to confuse at acceptance is a **repeated request** versus **concurrent requests**.

The same request sent twice because of a network retry is handled by the business request ID and the unique constraint.

Two conversations each sending a request have different IDs and both pass the unique constraint; only then do the conditional update or row lock decide whether the balance is enough.

### 5.3 What Do Freezing, Confirming and Releasing Each Change?

The project increases the frozen amount `reserved_milli` at acceptance. **Available balance = balance − frozen amount.** Section 4 checked "is the balance enough to deduct"; acceptance here checks "is the available balance enough to freeze". The changes, shown in points:

| Moment | Balance | Frozen | Available |
| --- | ---: | ---: | ---: |
| Before the request | 10 | 0 | 10 |
| Accepted, 8 points frozen | 10 | 8 | 2 |
| Generation succeeded, charge confirmed | 2 | 0 | 2 |
| Generation explicitly failed, freeze released | 10 | 0 | 10 |

The last two rows are two branches from the "8 points frozen" state. On success, the balance and the frozen amount each drop by 8, so the available balance stays 2. On failure, only the frozen amount drops, and the 8 points set aside for this job become available again.

After splitting into two short transactions, the in-between states must be recoverable. For example, if acceptance has committed but no worker has started, the job is already stored and can still be claimed. Or if the external call times out, the generation service may already have accepted the job, so the freeze must not be released as an explicit failure yet. Later stages handle these cross-transaction problems, including job recovery, repeated settlement and result delivery.

## 6. Summary and Choosing a Technique

### 6.1 Three Questions to Ask About a Concurrency Problem

| Question | Consider first |
| --- | --- |
| Must several database operations succeed together? | A transaction |
| May a business object be created only once? | A unique constraint (UNIQUE) |
| Might several requests "read, then modify" the same data at once? | A conditional update, `SELECT … FOR UPDATE`, or a higher isolation level |

### 6.2 Choosing Among the Three Concurrency Controls

| Approach | Suits | Cost |
| --- | --- | --- |
| Conditional update | The check fits into one SQL `WHERE` | Hard to write when the check is complex; with 0 rows affected you must work out why yourself |
| `SELECT … FOR UPDATE` | The check is complex and needs Python | Other writers wait while the lock is held; the transaction must be short |
| Higher isolation level (RR / SERIALIZABLE) | Few conflicts, and you are willing to write retry logic | On conflict the whole transaction fails and must be retried |

### 6.3 Core Concepts

| Concept | Core idea |
| --- | --- |
| Race condition | The outcome depends on the order of concurrent execution |
| TOCTOU | A condition true at check time may be stale at use time |
| Unique constraint (UNIQUE) | The database guarantees uniqueness, making a concurrent inserter wait for the earlier one's outcome |
| Transaction | Groups several operations into one logical unit; not the same as serial execution |
| Atomicity | All take effect or none do; handles failure inside one transaction |
| Isolation | Controls what concurrent transactions see of each other |
| MVCC | Keeps multiple versions of data and uses visibility rules to decide who reads which version, so plain reads and writes do not block each other |
| READ COMMITTED | A new snapshot for every statement |
| REPEATABLE READ | The whole transaction reuses the snapshot from its first statement; concurrently modifying the same row raises a serialization error |
| Write skew | Two transactions write different rows based on the same data, and together violate a rule; RR cannot prevent it, SERIALIZABLE can |
| Lost update | A write computed from stale data overwrites someone else's update |
| Conditional update | Merges the check and the modification into one statement and lets the database coordinate |
| `SELECT … FOR UPDATE` | Takes the row lock at read time, protecting the whole "read, check, write" until the transaction ends |

## 7. Self-Test Questions

Answer each one yourself first, then expand the answer. The hands-on experiments are on the "Hands-on" card at the end of the note.

**1.** Two requests sign up with the same email at the same time. The code first runs `SELECT` to check whether it exists and runs `INSERT` if it does not, and the whole thing is inside a transaction. Why can the sign-up still be duplicated? Was atomicity violated? How do you fix it?

<details>
<summary>Answer</summary>

A transaction only guarantees that its own statements all take effect or none do; it does not make two transactions run serially. Under READ COMMITTED, each transaction finds "not found" and each insert succeeds. Both transactions ran to completion, so atomicity was not violated; what is missing is control over how transactions affect each other. Fix: add `UNIQUE` to `email`, insert directly, and catch `UniqueViolation`, or use `ON CONFLICT (email) DO NOTHING`.

</details>

**2.** With a unique constraint in place, A inserts `a@x.com` but has not committed, and B inserts `a@x.com` too. What happens to B? What is B's outcome if A commits, and if A rolls back?

<details>
<summary>Answer</summary>

B's insert waits, because A's outcome is not yet known. If A commits, B gets a unique violation; if A rolls back, B's insert proceeds and succeeds.

</details>

**3.** What is wrong with this code under concurrency? UPDATE already locks the row, so why did the lock not help? Rewrite it as a single SQL statement.

```python
n = db.execute("SELECT reserved_milli FROM point_accounts WHERE user_id=1").fetchone()[0]
db.execute("UPDATE point_accounts SET reserved_milli=%s WHERE user_id=1", [n + 500])
```

<details>
<summary>Answer</summary>

This is a lost update: both transactions read the same `n`, each adds 500 and writes back, so only 500 is added in the end. UPDATE's row lock protects only the write; `n + 500` was computed outside the lock from the old value, and once B gets the lock it still writes that stale value. Rewrite it as `UPDATE point_accounts SET reserved_milli = reserved_milli + 500 WHERE user_id = 1;`, so the database computes from the latest value.

</details>

**4.** If the deduction is written as `SET balance_milli = balance_milli - 8000`, is the charging logic correct?

<details>
<summary>Answer</summary>

Not entirely. A relative update solves the lost update but does not check the balance: after A's deduction leaves 2000, B's deduction makes it −6000, an overdraft. Add the check: `WHERE user_id = 1 AND balance_milli >= 8000`, and decide success or failure from the affected row count.

</details>

**5.** Transaction A has run the conditional update `UPDATE … SET balance_milli = balance_milli - 8000 WHERE user_id = 1 AND balance_milli >= 8000` on the account and not committed yet. Transaction B runs the same statement on the same account. Why does B wait? After A commits, why does B update 0 rows?

<details>
<summary>Answer</summary>

A's UPDATE took a row lock, and B wants to modify the same row, so it must wait until A finishes. After A commits, under READ COMMITTED, PostgreSQL re-checks B's `WHERE balance_milli >= 8000` against the row's latest version (a balance of 2000). The condition fails, so 0 rows are updated.

</details>

**6.** Transaction A has locked user 1's account with `SELECT … FOR UPDATE`. Transaction B reads this account with a plain `SELECT`. Is B blocked? What does it read? What about transaction C, which wants to UPDATE this row?

<details>
<summary>Answer</summary>

B is not blocked. A plain read reads the visible version directly under MVCC, which is the currently committed value; if A later modifies the row but has not committed, B still reads the value from before the change. C's UPDATE waits until A commits or rolls back.

</details>

**7.** `a@x.com` is not in the database. Inside a transaction you run `SELECT … WHERE email='a@x.com' FOR UPDATE`. Does this stop other transactions from inserting this email?

<details>
<summary>Answer</summary>

No. `FOR UPDATE` locks only the rows it finds; if it finds none, nothing is locked, and other transactions can still insert. Preventing duplicates needs a unique constraint.

</details>

**8.** Transaction A, under READ COMMITTED, first reads a balance of 10; another transaction deducts 8 and commits; what does A read the second time? What if A is under REPEATABLE READ? Under REPEATABLE READ, what happens if A then tries to deduct from this row?

<details>
<summary>Answer</summary>

Under READ COMMITTED it reads 2, because each statement uses a new snapshot. Under REPEATABLE READ it still reads 10, because it reuses the snapshot from the first read. If A then tries to deduct from this row, PostgreSQL raises `could not serialize access due to concurrent update` (SQLSTATE 40001); A must roll back and retry the whole transaction from the start.

</details>

**9.** In the example from 3.4, "each user may have at most 1 running job", why can REPEATABLE READ not prevent the violation while SERIALIZABLE can?

<details>
<summary>Answer</summary>

Under RR, neither A's nor B's snapshot contains a running job, so each counts 0; they insert two different rows and never modify the same row, so no concurrent-update error fires and both can commit. This is write skew. SERIALIZABLE checks the read-write dependencies between concurrent transactions: each transaction read the range of data the other writes into, which no serial order can explain, so one of them fails with a serialization error and rolls back, and on retry it counts 1 job.

</details>

**10.** Why must the 30-second image generation API call not go inside the deduction transaction that locks the account row?

<details>
<summary>Answer</summary>

There are three reasons. First, the account row stays locked for 30 seconds, and all of this user's other generation requests wait. Second, the transaction holds a database connection the whole time, so under high concurrency the connection pool runs out and other users are affected too. Third, a rollback cannot undo an external request already sent or costs already incurred. The right approach is to accept with a short transaction (freeze points, create the job), call the generation service outside the transaction, and settle in a new short transaction.

</details>
