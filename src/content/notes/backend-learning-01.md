---
title: "后端学习记录 01：并发前置——为什么同时到达会把数据弄错"
description: "从\"先查再写\"的竞态讲起，理解唯一约束、事务、MVCC 与隔离级别、丢失更新，以及它们在点数扣费里的配合。"
category: "knowledge"
tags: ["high-concurrency", "backend"]
published: "2026-11-26"
series: "backend-learning"
order: 10
experiments:
  - id: postgres-concurrency-anomalies
    category: ai-engineering
    status: planned
    public: true
    title: { zh: "两个 psql 窗口复现并发异常", en: "Reproduce Concurrency Anomalies in Two psql Windows" }
    description: { zh: "用 PostgreSQL 和两个 psql 窗口，亲手验证本文的每条时间线。准备：建表 acct(id INT PRIMARY KEY, bal INT NOT NULL) 并插入 (1, 10000)，建表 u(email TEXT UNIQUE)。psql 中不写 BEGIN 的语句会自动提交；每项开始前复位：UPDATE acct SET bal=10000; DELETE FROM u;", en: "Use PostgreSQL and two psql windows to verify every timeline in this note yourself. Setup: create acct(id INT PRIMARY KEY, bal INT NOT NULL) with the row (1, 10000), and u(email TEXT UNIQUE). In psql, statements outside BEGIN commit automatically; reset before each item: UPDATE acct SET bal=10000; DELETE FROM u;" }
    requirements:
      - { zh: "丢失更新：两个窗口都 BEGIN 后各读一次 bal，再先后执行 UPDATE acct SET bal=2000 WHERE id=1 并提交，确认两次扣款后余额仍是 2000", en: "Lost update: in both windows BEGIN and read bal, then run UPDATE acct SET bal=2000 WHERE id=1 and commit one after the other; confirm the balance is still 2000 after two deductions" }
      - { zh: "条件更新：两个窗口先后在事务里执行 UPDATE acct SET bal=bal-8000 WHERE id=1 AND bal>=8000，确认窗口 2 会等待，窗口 1 提交后窗口 2 显示 UPDATE 0", en: "Conditional update: run UPDATE acct SET bal=bal-8000 WHERE id=1 AND bal>=8000 inside a transaction in each window in turn; confirm window 2 waits, and shows UPDATE 0 after window 1 commits" }
      - { zh: "FOR UPDATE：把第一项的读取改成 SELECT … FOR UPDATE，确认窗口 2 卡在读取这一步、最后读到 2000；窗口 1 持锁时，窗口 2 的普通 SELECT 不会被阻塞", en: "FOR UPDATE: change the reads in the first item to SELECT … FOR UPDATE; confirm window 2 blocks at the read and finally reads 2000, and that a plain SELECT in window 2 is not blocked while window 1 holds the lock" }
      - { zh: "RC 与 RR：窗口 1 用 BEGIN ISOLATION LEVEL REPEATABLE READ 读一次余额，窗口 2 自动提交扣 8000，确认窗口 1 再读仍是 10000、接着更新这一行会报序列化错误；换成普通 BEGIN 重做并对比", en: "RC versus RR: in window 1 read the balance after BEGIN ISOLATION LEVEL REPEATABLE READ, deduct 8000 in window 2 with autocommit, and confirm window 1 still reads 10000 and gets a serialization error when it then updates the row; redo it with a plain BEGIN and compare" }
      - { zh: "唯一约束：两个窗口先后在事务里插入同一个邮箱，确认窗口 2 会等待；窗口 1 提交时窗口 2 报 duplicate key，窗口 1 回滚时窗口 2 插入成功", en: "Unique constraint: insert the same email inside a transaction in each window in turn; confirm window 2 waits, reports duplicate key if window 1 commits, and succeeds if window 1 rolls back" }
---

这是后端学习路线的第 1 阶段，主要学习并发问题需要的数据库知识。文中的例子来自我实习时参与开发的对话式 AIGC Agent 项目：用户用"点数"付费生成图片，后台用 PostgreSQL 记账。

## 0. 学习目标与核心问题

整篇只回答一个问题：**当多个请求同时操作同一份数据时，怎样保证业务规则仍然成立？**

学完能做到：

1. 说清楚"先查再写"在并发下为什么会失效，以及唯一约束为什么不会失效；
2. 说清楚事务保证了什么、**没有**保证什么；
3. 用 MVCC 和快照解释 READ COMMITTED 与 REPEATABLE READ 的区别；
4. 用时间线画出"丢失更新"，并能在条件更新、`SELECT … FOR UPDATE`、提高隔离级别之间做选择；
5. 说清楚扣费流程里事务、唯一约束和行锁各自负责什么，以及为什么耗时的外部调用不能放进持有行锁的事务。

需要建立的思维转变：写算法题时，一个变量只要自己没改，它就不会变；**在后端，数据库是很多请求共享的可变状态，你读到的值随时可能过期。** 后面阶段的幂等、租约、任务队列，都建立在这一点上。

## 1. 竞态条件（Race Condition）

### 1.1 串行与并发

假设 AIGC 平台存在这样一个用户，账户余额为 10 点，每次生成图片需要消耗 8 点。

按我们平时写 Python 程序的思维，扣款逻辑如下：

```python
# 后台得到用户的余额，如果充足，则进行扣款，并且生成图像
balance = get_balance(user_id)        # 读
if balance >= 8:                      # 检查
    save_balance(user_id, balance - 8)  # 写
    generate_image()
```

如果程序是**串行执行**的，这段代码完全没有问题。

```
请求 A：读到 10 → 判断够 → 写回 2 → 生成
请求 B：读到 2 → 判断不够 → 拒绝
结果：余额 2，生成 1 次 ✓
```

但真实的后端不是这样运行的：

同一个用户可以开两个窗口，或者在两个对话里同时提交；后端用多个协程、进程甚至多台机器处理请求。

这意味着两个请求的执行步骤可能发生**交错**：

| 时间 | 请求 A | 请求 B | 数据库余额 |
| --- | --- | --- | ---: |
| t1 | 读到余额 10 点 | — | 10 |
| t2 | — | 读到余额 10 点 | 10 |
| t3 | 判断余额足够，写回 2 | — | 2 |
| t4 | — | 判断余额足够，写回 2 | 2 |

**结果：** 两个请求都通过了检查，各生成一次。两次生成共应扣 16 点，但余额只从 10 点降到 2 点，实际只扣了 8 点。B 的写入覆盖了 A 的扣费结果，这就是「丢失更新」。

在这种情况下，每个请求单独看都没错，因为**错误不在于单个请求的逻辑，而在于多个请求之间的交互**，这就是所谓**竞态条件**。

### 1.2 TOCTOU：检查时成立，使用时已失效

上面的代码隐含了一个假设：

从读到写的这段时间里，没有其他人修改余额。

这个"检查"和"使用"之间的空档有专门的名字，叫 **TOCTOU**（time of check to time of use）。

在并发环境下，这个假设并不成立，哪怕这两行代码之间只间隔了 1 微秒，竞态条件依然存在，**其他请求可能在此时修改数据**。

这也是并发 bug 难复现的原因：

本地可能测试一百次都没有问题，但是上线后请求一多，某两个请求恰好按特定顺序交错，问题就出现了。

这一类问题有一个经典案例：重复注册。

```python
# 查询目标邮箱是否存在，如果不存在，则创建新邮箱账号
row = db.execute("SELECT 1 FROM users WHERE email = %s", [email]).fetchone()
if row is None:
    db.execute("INSERT INTO users (email) VALUES (%s)", [email])
```

当两个请求同时用 `a@x.com` 注册 → row 都查到"不存在" → 都插入成功 → 出现两个邮箱相同的账号。

### 1.3 唯一约束（UNIQUE）：把规则交给数据库

我们可以向数据库声明一条规则：**无论来多少请求、怎样交错，都不允许出现两行相同的 email。** 它的底层是一个唯一索引。

```sql
CREATE TABLE users (            -- 创建名为 users 的表
  user_id BIGSERIAL PRIMARY KEY,-- 自动递增的大整数，作为主键
  email   TEXT NOT NULL UNIQUE  -- 文本类型；不能为空；不能与其他用户重复
);
```

接下来我们回到邮箱注册这个案例：

给 email 加上 UNIQUE 后，假设 A 插入了 `a@x.com` 但还没提交，这时 B 也插入 `a@x.com`。

PostgreSQL 检查唯一索引时，发现同一个邮箱已经被 A 插入，但还不知道这条记录最终是否会保留，于是让 B 的 INSERT 操作等待。A 提交后，B 的插入报唯一冲突，Python 捕获 `UniqueViolation`，返回「邮箱已注册」。

| 时间 | 事务 A | 事务 B |
| --- | --- | --- |
| t1 | 开启事务，插入 `a@x.com`，暂未提交 | — |
| t2 | 仍未提交 | 开启事务，尝试插入 `a@x.com`，等待 A 的结果 |
| t3（若 A 提交） | `COMMIT` | 结束等待，插入报错 `duplicate key`（邮箱已被占用） |
| t3（若 A 回滚） | `ROLLBACK` | 结束等待，插入继续执行并成功 |

因此，Python 后端可以省掉单独的 SELECT，直接尝试插入，捕获冲突：

```python
import psycopg

try:
    with conn.transaction():
        # 直接 INSERT，数据库会在写入过程中自动检查。
        conn.execute("INSERT INTO users (email) VALUES (%s)", [email])
except psycopg.errors.UniqueViolation:
    return "邮箱已注册"
```

### 1.4 `ON CONFLICT`：冲突不一定是错误

当两个请求发生唯一性冲突时，数据库默认会抛出异常。

但在有些场景里，重复请求不意味着错误，比如网络超时后客户端重发了同一个请求。

这时可以声明冲突时怎么处理，而不是抛异常：

```sql
-- 尝试注册 a@x.com：注册成功就返回新用户的 ID，邮箱已被占用就跳过插入
INSERT INTO users (email) VALUES ('a@x.com') -- 尝试插入一条用户记录
ON CONFLICT (email) DO NOTHING  -- 若触发 email 唯一约束，跳过
RETURNING user_id;     -- 插入成功返回新 id；返回空说明 email 已经存在
```

这就是下一阶段学习 **幂等性（Idempotency）** 的重要基础：

**同一个业务请求被执行多次，不应产生多次业务副作用。**

### 1.5 项目里的同类问题

| 场景 | 如果靠"先查再写" | 项目里的做法 |
| --- | --- | --- |
| 同一邮箱注册 | 两个账号 | `UNIQUE(email)` |
| 网络重试导致重复受理生成 | 两个任务、扣两次钱 | `UNIQUE(source_message_id, step_id, revision, attempt_seq)`（阶段 2） |
| 结果处理被执行两次 | 确认扣款两次 | 账本 `UNIQUE(action_id, kind)`（阶段 2） |
| 交付事件被消费两次 | 对话里出现两条消息 | 按 `event_id` 去重（阶段 3） |

## 2. 数据库事务（Transaction）

### 2.1 问题背景：做到一半崩溃了

先不考虑并发。假设 Agent 接收到一个图片生成请求，需要在数据库中完成两个操作：

① 预扣 8 点；② 创建一条生成任务。

这两个操作在业务上应该是绑定的，但在数据库中，它们是两条独立的 SQL。

```python
db.execute("UPDATE point_accounts ...")
db.execute("INSERT INTO generation_actions ...")
```

假设第一条 SQL 执行并提交成功之后，服务器突然崩溃了，会导致用户支付了费用，但是系统没有生成任务。

```
① UPDATE 预扣点数  → 成功并生效
   💥 服务器崩溃
② INSERT 生成任务  → 没有执行
```

反过来，如果先建任务再扣钱，就会出现任务创建成功但没有扣费的情况。

因此，我们需要数据库把这两步当成一个整体。

### 2.2 核心原理与用法

在 SQL 里，我们用 BEGIN 和 COMMIT 包住两条语句，失败时用 ROLLBACK 撤销。

```sql
BEGIN;      -- 开启事务

UPDATE point_accounts 
SET reserved_milli = reserved_milli + 8000 
WHERE user_id = 1;  -- 为用户预留 8 点

INSERT INTO generation_actions (...) VALUES (...); -- 记录一次生成操作

COMMIT;      -- 提交事务，中途任何一步出错 → ROLLBACK，两条都不生效
```

| 语句 | 含义 |
| --- | --- |
| `BEGIN` | 开始事务 |
| `COMMIT` | 提交，所有修改正式生效 |
| `ROLLBACK` | 回滚，撤销本事务尚未提交的修改 |

在 Python 里，psycopg 提供了 with conn.transaction(): 来管理这个过程。

把两条 SQL 都写在缩进块里，正常离开就提交，有异常抛出就回滚。

`conn.transaction()` 返回的对象叫做上下文管理器。

```python
with conn.transaction():
    conn.execute("UPDATE point_accounts ...")
    conn.execute("INSERT INTO generation_actions ...")
```

这就是事务的**原子性**（Atomicity），不是说两条 SQL 物理上同时执行，而是说**从最终生效的结果看，这些操作不可分割**。

### 2.3 能力边界：事务 ≠ 加锁 ≠ 串行执行

但是，事务不能直接解决并发问题，这是这一阶段最容易误解的地方。

事务是一个**逻辑单位**（一起生效或一起撤销），不是一个"独占数据库"的执行单位。

数据库并不会等一个事务执行完毕再执行下一个事务，多个事务的步骤照样是交错执行的。

假设 A 和 B 都把重复注册的代码放进了事务，在 PostgreSQL 默认级别下、没有唯一约束时，数据库里会产生两个相同邮箱的账号。

```
时间 →   事务 A                    事务 B
  t1   BEGIN
  t2   SELECT → 不存在
  t3                            BEGIN
  t4                            SELECT → 不存在
  t5   INSERT
  t6                            INSERT
  t7   COMMIT
  t8                            COMMIT
```

两个事务都完整执行了，没有任何操作只完成了一半，所以原子性并没有被违反，但结果仍然是错的。

这说明还需要另一种保证来控制**事务之间**的相互影响，这就是**隔离性**（Isolation）。

### 2.4 ACID

| 特性 | 回答的问题 | 扣费场景里的例子 |
| --- | --- | --- |
| **A 原子性** | 做到一半失败怎么办？ | 预扣和建任务必须一起生效 |
| C 一致性 | 事务前后数据是否满足规则？ | 余额不能为负、任务不能重复 |
| **I 隔离性** | 多个事务同时执行时互相看到什么？ | 两个生成请求不能基于同一份旧余额做判断 |
| D 持久性 | 提交后断电怎么办？ | 已提交的扣款能恢复（靠预写日志 WAL） |

这一阶段我们需要重点掌握 A 和 I：

**原子性处理一个事务内部的失败，隔离性处理多个事务之间的干扰。** 

另外，一致性不是数据库自动给的。例如，数据库并不知道"生成一张图扣 8 点"，它只检查你声明的约束；业务规则要靠约束、原子性、隔离性和代码一起保证。

## 3. MVCC 与隔离级别

### 3.1 前置知识：MVCC、多版本与快照

PostgreSQL 用 **MVCC**（Multi-Version Concurrency Control，多版本并发控制）处理并发读写：一行数据被修改时，旧版本不会立刻消失，数据库会同时保留新旧版本，并按**可见性规则**决定每个事务读到哪个版本。

假设用户余额原本为 10 点，事务 A 正在扣 8 点，但还没提交：

| 谁在读 | 读到 | 原因 |
| --- | --- | --- |
| 事务 A 自己 | 2 | 事务能看到自己的修改 |
| 事务 B 的普通 `SELECT` | 10 | A 的新版本尚未提交，对别人不可见 |

B 可以直接读到旧版本的 10 点，**不需要等 A 提交**。这样，普通 SELECT 和对同一行的 UPDATE 可以并发执行，彼此无需等待。

B 能看到哪个版本，取决于它使用的**快照（snapshot）**。快照为这次读取划定了一个时间界限，PostgreSQL 据此判断其他事务的修改是否可见。在这个例子里，B 取快照时 A 还没有提交，所以 B 读到的是旧版本的 10 点。

如果 A 随后提交，B 再查一次会读到 2 点还是仍然读到 10 点？这取决于第二次查询是取一份新快照还是沿用原来的快照，这就和接下来要讲的隔离级别有关了。

### 3.2 三种读异常

| 异常 | 一句话 | 例子 |
| --- | --- | --- |
| 脏读（Dirty Read） | 读到别人**还没提交**的数据 | 别人扣了钱最后又回滚了，你却按扣过的余额做了判断。PostgreSQL 的任何级别都不会发生 |
| 不可重复读（Non-repeatable Read） | 同一事务里读**同一行**两次，内容变了 | 第一次读余额 10，别人扣款并提交，第二次读到 2 |
| 幻读（Phantom Read） | 同一事务里按**同一条件**查两次，结果集合变了 | 第一次查到 1 个运行中的任务，别人插入并提交了一个，第二次查到 2 个 |

#### 脏读（Dirty Read）

| 时间 | 事务 A | 事务 B |
| --- | --- | --- |
| t1 | 将余额从 10 点改为 2 点，尚未提交 | — |
| t2 | — | 读到余额为 2 点 |
| t3 | 执行 `ROLLBACK`，余额恢复为 10 点 | — |

**结果：** B 读到了 A 尚未提交、后来又被撤销的余额。

#### 不可重复读（Non-repeatable Read）

| 时间 | 事务 A | 事务 B |
| --- | --- | --- |
| t1 | 执行 `BEGIN`，开启事务 | — |
| t2 | 第一次读取余额，得到 10 点 | — |
| t3 | — | 扣除 8 点并提交 |
| t4 | 第二次读取同一账户的余额，得到 2 点 | — |
| t5 | 执行 `COMMIT`，提交事务 | — |

**结果：** A 在同一个事务中**两次读取同一条记录**，读到了不同的余额。

#### 幻读（Phantom Read）

| 时间 | 事务 A | 事务 B |
| --- | --- | --- |
| t1 | 第一次查询任务，返回 `Task 001`，共 1 条 | — |
| t2 | — | 插入一条符合查询条件的新任务 `Task 002`，并提交 |
| t3 | 用相同条件再次查询，返回 `Task 001` 和 `Task 002`，共 2 条 | — |

**结果：** A 在同一个事务中**用相同条件查询两次**，第二次多出了一条符合条件的记录。

不可重复读和脏读的区别：不可重复读读到的两个值都是已提交的真实数据，问题在于一个事务内部的视图不稳定。

不可重复读和幻读的区别：不可重复读是同一条记录的内容变了，幻读是同一个查询条件匹配到的记录变了。

### 3.3 四个隔离级别

| 隔离级别 | PostgreSQL 实际做了什么 |
| --- | --- |
| `READ UNCOMMITTED` | **按 RC 执行**。在 PostgreSQL 里，即使选了这个级别，也读不到其他事务未提交的修改。 |
| `READ COMMITTED`（RC，默认） | **每条非事务控制语句（例如 `SELECT`）开始时取一份新快照**。同一个事务里，第二次查可以看到两次查询之间别人刚提交的修改。 |
| `REPEATABLE READ`（RR） | **整个事务沿用同一份快照**。快照在第一条非事务控制语句开始时取得，比如第一条 `SELECT`。之后别人提交的修改对这份快照仍不可见，事务自己的修改照样可见。 |
| `SERIALIZABLE` | 普通读取沿用 RR 的快照规则，**额外检查并发事务的读写关系**。如果这些操作的结果无法用某个串行顺序解释，数据库会让相关事务报错回滚，应用可以重试整个事务。 |

**事务控制语句:** `BEGIN`、`COMMIT`、`ROLLBACK`、`SET TRANSACTION`。

**非事务控制语句:** `SELECT`、`UPDATE`、`INSERT`、`DELETE`等。

假设余额原本是 10 点，任务原本只有 Task 001。下面三行是三个独立的小实验，A 在同一个事务里查两次，自己没有修改数据。

| 看 B 什么时候改、改了什么 | A 在 RC 下看到什么 | A 在 PostgreSQL RR 下看到什么 |
| --- | --- | --- |
| **脏读**：B 把余额改成 2 点，A 第二次查时 B **还没提交** | `10 → 10`。新快照也看不到未提交的 2 点 | `10 → 10` |
| **不可重复读**：B 在两次查询之间把余额改成 2 点，**并提交** | `10 → 2`。第二张快照看到了同一行的新值 | `10 → 10`。沿用原快照 |
| **幻读**：B 在两次查询之间插入符合条件的 `Task 002`，**并提交** | `1 条 → 2 条`。第二张快照看到了新出现的匹配行 | `1 条 → 1 条`。沿用原快照 |

所以，RC 防脏读，是因为新快照也只让你看到其他事务已提交的修改。PostgreSQL 的 RR 还能防不可重复读和幻读，是因为第二次查询沿用原快照。 

同一个快照规则同时决定「这一行的值是什么」和「哪些行符合条件」。

| 级别 | 脏读 | 不可重复读 | 幻读 | PostgreSQL 的实际情况 |
| --- | --- | --- | --- | --- |
| READ UNCOMMITTED | 可能 | 可能 | 可能 | 按 READ COMMITTED 执行 |
| **READ COMMITTED**（RC） | 不会 | 可能 | 可能 | **PostgreSQL 默认** |
| REPEATABLE READ（RR） | 不会 | 不会 | SQL 标准允许 | PostgreSQL 里也不会出现幻读；**MySQL InnoDB 默认是 RR** |
| SERIALIZABLE | 不会 | 不会 | 不会 | 保证成功提交的事务，整体效果等价于按某种顺序串行执行，必要时让事务报错 |

这张表按 SQL 标准概括，不用背。重要的是理解 RC 和 RR 的区别。

### 3.4 RR 已经防住这三种读问题，为什么还要 SERIALIZABLE？

假设业务规定「每个用户最多只能有 1 个运行中的生成任务」。用户同时发来两个生成请求，事务 A 和 B 都会先查询该用户有多少个运行中的任务。只有查到 0，才插入自己的任务记录。这里假设这条业务规则只靠这段查询逻辑检查。

| 时间 | 事务 A | 事务 B |
| --- | --- | --- |
| t1 | 查询运行中的任务数，得到 0 | — |
| t2 | — | 查询运行中的任务数，也得到 0 |
| t3 | 插入自己的任务 `Task 001`，尝试提交 | — |
| t4 | — | 插入自己的任务 `Task 002`，尝试提交 |

**在 PostgreSQL 的 RR 下，两笔事务可能都提交成功。** A 和 B 取快照时都还没有运行中的任务，所以各自查到 0。接下来，它们插入的是两条不同的记录，最终可能留下 2 个运行中的任务。两笔事务都只查了一次，依然违反了业务规则。RR 给每笔事务提供稳定的读取视图，但两笔事务仍可能基于同一个初始状态各自做出决定。这类异常叫**写偏斜（Write Skew）**：两笔事务读了同一组数据，各自写入不同的行，单独看都合规，合在一起就违反了规则。

**在 SERIALIZABLE 下，两笔事务不能都按这个结果提交。** 假设 A 先完整执行并提交，B 随后查询就会看到 1 个任务，因此不会插入。换成 B 先执行，A 也会看到 1。无论按哪个顺序串行执行，都只会创建一个任务。PostgreSQL 允许两笔事务并发执行，但会通过序列化错误阻止它们都提交。失败的一方如果要重试，需要从查询任务数开始，重新执行整个事务。

## 4. 丢失更新与并发控制

假设用户有 10 点余额，两个请求同时申请各花 8 点生成图片。

数据库以千分之一点为单位存整数，所以余额是 10000，每次要扣 8000。

按业务规则，只能放行其中一个请求。

### 4.1 为什么两次写入先后执行，还是丢了一次扣款？

原来的代码先用普通 SELECT 读余额，再在 Python 里判断够不够、计算新余额，最后把算好的值写回数据库。

```python
bal = db.execute("SELECT balance_milli FROM point_accounts WHERE user_id = 1").fetchone()[0]
if bal >= 8000:
    db.execute("UPDATE point_accounts SET balance_milli = %s WHERE user_id = 1", [bal - 8000])
```

| 时刻 | 事务 A | 事务 B |
| --- | --- | --- |
| t1 | 读到 `10000`，判断够扣，算出新余额 `2000` | - |
| t2 | - | 也读到 `10000`，判断够扣，算出新余额 `2000` |
| t3 | 把余额设成 `2000`，提交 | - |
| t4 | - | 把余额设成 `2000`，提交 |

两个请求都通过了余额检查，余额却只少了 8 点。两个请求都试图扣款，其中一次扣款没有反映在最终余额里，这就是**丢失更新（Lost Update）**。

问题出在 **B 写入时用的是 t2 算出来的值**。Python 里的 bal 是当时读到的余额，A 提交后它仍然是 10000。B 最后发给数据库的指令只是 SET balance_milli = 2000，里面没有「我之前读到的余额是 10000」这个条件。

UPDATE 的行锁会让同一行的写入依次进行。在这条时间线里，B 写入时 A 已经提交，可以直接更新。即使 B 在 A 提交前就发出 UPDATE，它也只是等 A 释放锁，随后照样把余额设成 2000。**行锁排好了写入顺序，B 的扣款判断和计算却早在拿锁之前就做完了。**

### 4.2 条件更新：用一条 SQL 检查余额并扣款

假设没有额外的非负余额约束，三种写法的区别如下。表中金额都使用数据库的存储单位。

| 写法 | A 提交后，B 会做什么？ | 最终结果 |
| --- | --- | --- |
| `SET balance_milli = 2000` | 把余额再次设成 `2000` | 两个请求都放行，丢失一次扣款 |
| `SET balance_milli = balance_milli - 8000` | 在当前的 `2000` 上再减 `8000` | 两次扣款都生效，余额变成 `-6000` |
| 在相对扣款上追加 `AND balance_milli >= 8000` | 检查当前余额，发现 `2000` 不够扣 | 只放行 A，余额剩 `2000` |

相对更新解决的是扣款有没有被覆盖。`WHERE` 里的余额条件解决的是这笔钱此刻还能不能扣。实际扣款需要两者一起用。

```sql
UPDATE point_accounts
SET balance_milli = balance_milli - 8000
WHERE user_id = 1 AND balance_milli >= 8000;
```

在 PostgreSQL 默认的 READ COMMITTED 下，如果 B 的 UPDATE 找到这行时，A 正在修改它，B 会等待。A 提交后，PostgreSQL 会用更新后的那一行重新检查 B 的 WHERE。这时余额是 2000，条件不成立，B 更新 0 行。如果 B 的语句在 A 提交后才开始，它一开始就会看到 2000。

```python
cur = conn.execute(
    """UPDATE point_accounts
       SET balance_milli = balance_milli - 8000
       WHERE user_id = %s AND balance_milli >= 8000""",
    [user_id],
)
if cur.rowcount == 1:
    ...  # 扣款成功
else:
    ...  # 余额不足；如果不能保证账户一定存在，也可能是账户不存在
```

Python 根据 cur.rowcount 判断这条语句的结果。更新 1 行表示扣款已在当前事务中执行，事务提交后才生效。更新 0 行表示没有扣款。如果业务保证账户一定存在，就可以判定为余额不足，否则还可能是账户不存在。

### 4.3 SELECT … FOR UPDATE：先锁住账户，再在 Python 里判断

如果扣款规则更适合写在 Python 里，可以**在读取余额时就锁定账户行**，并在同一个事务里完成读取、判断和写回。下面假设账户一定存在。

```python
with conn.transaction():
    bal = conn.execute(
        "SELECT balance_milli FROM point_accounts WHERE user_id = %s FOR UPDATE",
        [user_id],
    ).fetchone()[0]
    if bal >= 8000:          # 这里可以写任意复杂的 Python 判断
        conn.execute(
            "UPDATE point_accounts SET balance_milli = %s WHERE user_id = %s",
            [bal - 8000, user_id],
        )
```

在 READ COMMITTED 下，A 用 FOR UPDATE 读到 10000 并锁住这一行。B 执行自己的 SELECT … FOR UPDATE 时会等在读取这一步。等 A 扣完并提交，B 才拿到锁、读到 2000，然后在 Python 里判断余额不足。这里可以安全地写回绝对值，因为从 A 读到余额到 A 写回，其他事务无法修改这行。

| 时间 | 事务 A | 事务 B |
| --- | --- | --- |
| t1 | 执行 `SELECT … FOR UPDATE`，读到 `10000`，锁住账户行 | — |
| t2 | — | 执行 `SELECT … FOR UPDATE`，等待 A 释放行锁 |
| t3 | 执行 `UPDATE`，将余额改为 `2000`，然后 `COMMIT` 释放行锁 | — |
| t4 | — | 获得行锁，读到最新余额 `2000`。余额不足 `8000`，拒绝本次生成请求 |

锁的范围决定了它能保护什么：

- **锁住的是查到的账户行。** 锁住用户 1 的账户行，用户 2 仍可以给自己的账户扣款。查不到行时也就没有行可锁，所以防止重复插入邮箱仍靠唯一约束。

- **锁持续到事务结束。** 普通 SELECT 仍可以按 MVCC 读取可见版本。同一行上的 `UPDATE`、`DELETE` 和冲突的加锁读取需要等待。

- **判断用到其他数据时，要明确那些数据怎么保护。** 例如从任务表数并发任务时，需要让所有会改变任务数的相关入口也遵守同一个账户加锁约定，或者给任务数单独设计并发控制。账户行锁本身只保护账户行。

同样，如果还有一条扣款路径用普通 SELECT 读余额，再把旧值算出来的结果写回，它仍可能覆盖其他事务的更新。各条余额修改路径都要遵守相容的写入规则。

### 4.4 对照：同样的错误写法，在 REPEATABLE READ 下会怎样？

把 4.1 的时间线放到 PostgreSQL 的 REPEATABLE READ 下。A、B 最初都读到 10000，但 A 提交后，B 尝试更新自己快照中的同一行时，PostgreSQL 会报并发更新导致的序列化失败（SQLSTATE 40001）。应用需要回滚并从头重试整个事务，让余额读取和扣款判断都重新执行。重试时就会读到 A 提交后的 2000。

这个项目用前两种办法处理扣款。条件更新把检查放在数据库写入时，`FOR UPDATE` 把锁提前到读取时。 两种写法都保证扣款判断基于这次写入实际要修改的那一行。

## 5. Agent 项目中的工程实践

> 下面以一次图片生成请求为例，说明受理、生成和结算如何衔接。

### 5.1 为什么要把一次生成拆成两个短事务？

用户有 10 点余额，发起一次需要 8 点的生成。后端受理时要给这次任务先留出 8 点，免得用户在另一个对话里又花掉这笔点数。至于这 8 点最终怎么处理，要等生成结果出来才知道。

如果把整个过程放进一个事务：

```python
with conn.transaction():
    lock_user_account()                   # SELECT … FOR UPDATE
    reserve_points()
    result = call_image_generation_api()  # 例如耗时 30 秒
    save_result(result)
```

那么等待生成结果的 30 秒里：

1. **账户行一直被锁住。**同一个用户的其他请求如果也要修改账户，就得等这个事务结束。

2. **数据库连接一直被占用。**大量请求同时等生成结果时，可能耗尽连接池，影响其他用户。

3. **外部调用有自己的执行结果。**如果生成服务已经接单或计费，随后本地写库失败，数据库回滚只能撤销本地修改。外部已经发生的操作需要由应用另行处理。

```python
with conn.transaction():    # 短事务：受理
    lock_user_account()     # 锁住账户
    reserve_points()        # 冻结 8 点
    create_task()           # 创建任务；离开 with 块时提交，账户行锁随之释放

# Worker 领取已提交的任务后，在事务外调用
# 其他请求仍可检查或修改账户，但只能花剩下的 2 点
result = call_image_generation_api()   

with conn.transaction():    # 新的短事务：结算
    settle_points(result)   # 成功就确认扣款，明确失败就解冻
    update_task_status(result)  # 更新任务状态
```

因此，**先在数据库里提交「点数已冻结、任务已创建」，再由 Worker 调用生成服务，拿到结果后另开事务结算。** 第一次提交后，账户行锁就释放了。其他请求可以继续检查余额，只是这时能动用的只剩 2 点。

### 5.2 一次请求如何受理、生成和结算？

| 步骤 | 后端做什么 | 机制负责什么 |
| --- | --- | --- |
| **受理请求** | 客户端带上业务请求 ID。后端记录受理、检查可用余额、冻结点数并创建任务，然后提交。 | **唯一约束**挡住同一个请求的重复受理。**条件更新或账户行锁**防止不同请求同时占用同一份可用余额。**事务**保证冻结点数与创建任务一起提交。 |
| **调用生成服务** | Worker 领取已提交的任务，在领取事务结束后调用外部生成服务。 | 调用期间，受理和领取任务用到的数据库锁都已释放。 |
| **结算任务** | 生成成功就确认扣款，明确失败就解除冻结。点数变动和任务状态更新放在同一个短事务里。 | **事务**保证结算和任务状态一起提交。重复处理结果时如何防止重复结算，留到阶段 2 的幂等展开。 |
| **交付结果** | 将已落库的结果通知给用户。 | 事件的可靠投递与按事件 ID 去重，留到阶段 3 展开。 |

受理阶段最容易混淆的是**重复请求**和**并发请求**。

同一个请求因为网络重试发了两遍，要靠业务请求 ID 和唯一约束处理。

两个对话各发了一条请求，ID 不同，都能通过唯一约束，这时才轮到条件更新或行锁判断余额够不够。

### 5.3 冻结、确认扣款、解除冻结分别改了什么？

项目在受理时先增加冻结额 reserved_milli。**可用余额 = 余额 − 冻结额。**第 4 节检查的是「余额够不够扣」，这里受理时检查的是「可用余额够不够冻结」。下面用点数展示变化：

| 时刻 | 余额 | 冻结额 | 可用余额 |
| --- | ---: | ---: | ---: |
| 提交请求前 | 10 | 0 | 10 |
| 受理成功，冻结 8 点 | 10 | 8 | 2 |
| 生成成功，确认扣款 | 2 | 0 | 2 |
| 生成明确失败，解除冻结 | 10 | 0 | 10 |

最后两行是从「已冻结 8 点」出发的两个分支。成功时，余额和冻结额各减 8 点，所以可用余额仍然是 2 点。失败时，只减冻结额，原来留给这次任务的 8 点就恢复可用了。

拆成两个短事务后，中间的状态需要能恢复。比如受理已提交、Worker 还没开始时，任务已经落库，可以继续领取。又比如外部调用超时，生成服务可能已经接单，这时还不能按明确失败解冻。后面的阶段会继续处理这些跨事务的问题，包括任务恢复、重复结算和结果交付。

## 6. 知识总结与技术选型

### 6.1 遇到并发问题，先问三个问题

| 问题 | 优先考虑 |
| --- | --- |
| 多个数据库操作是否必须一起成功？ | 事务 |
| 同一个业务对象是否只能创建一次？ | 唯一约束（UNIQUE） |
| 多个请求是否可能同时"读了再改"同一份数据？ | 条件更新、`SELECT … FOR UPDATE` 或更高的隔离级别 |

### 6.2 三种并发控制方式怎么选

| 方式 | 适合 | 代价 |
| --- | --- | --- |
| 条件更新 | 判断能写进一条 SQL 的 `WHERE` | 判断复杂时 SQL 难写；影响 0 行时要自己区分原因 |
| `SELECT … FOR UPDATE` | 判断逻辑复杂，需要 Python 参与 | 持锁期间其他写者等待；事务必须短 |
| 提高隔离级别（RR / SERIALIZABLE） | 冲突少、愿意写重试逻辑 | 冲突时整个事务失败，要重试 |

### 6.3 核心概念

| 概念 | 核心思想 |
| --- | --- |
| 竞态条件（Race Condition） | 结果取决于并发执行的先后顺序 |
| TOCTOU | 检查时成立的条件，使用时可能已经失效 |
| 唯一约束（UNIQUE） | 由数据库保证唯一，并发插入时让后来者等待先到者的结果 |
| 事务（Transaction） | 把多个操作组织成一个逻辑单位；不等于串行执行 |
| 原子性（Atomicity） | 全部生效或全部不生效，处理事务内部的失败 |
| 隔离性（Isolation） | 控制并发事务之间互相看到什么 |
| MVCC | 保留多个数据版本，按可见性规则决定谁读到哪个版本，普通读和写互不阻塞 |
| READ COMMITTED | 每条语句一张新快照 |
| REPEATABLE READ | 整个事务沿用第一条语句时的快照；并发修改同一行会报序列化错误 |
| 写偏斜（Write Skew） | 两笔事务基于同一份数据各自写入不同的行，合起来违反规则；RR 防不住，SERIALIZABLE 能防 |
| 丢失更新（Lost Update） | 基于旧数据算出的写入覆盖了别人的更新 |
| 条件更新（Conditional Update） | 把判断和修改合成一条语句，让数据库协调 |
| `SELECT … FOR UPDATE` | 读的时候就加行锁，保护整个"读、判断、写"过程，直到事务结束 |

## 7. 自测题

先自己作答，再展开参考答案。动手实验见文末的「动手实践」卡片。

**1.** 两个请求同时注册同一个邮箱，代码先 `SELECT` 查是否存在、不存在再 `INSERT`，而且整段都放在事务里。为什么还会重复注册？原子性被违反了吗？怎么修？

<details>
<summary>参考答案</summary>

事务只保证自己的语句全做或全不做，不会让两个事务串行执行。在 READ COMMITTED 下，两个事务各自查到"不存在"，各自插入成功。两个事务都完整执行了，所以原子性没有被违反，缺的是对事务之间相互影响的控制。修法：给 `email` 加 `UNIQUE`，直接插入，捕获 `UniqueViolation`，或者用 `ON CONFLICT (email) DO NOTHING`。

</details>

**2.** 有了唯一约束，A 插入了 `a@x.com` 但还没提交，B 也插入 `a@x.com`。B 会怎样？A 提交和 A 回滚两种情况下，B 的结果分别是什么？

<details>
<summary>参考答案</summary>

B 的插入会等待，因为 A 的结果还没确定。A 提交后，B 报唯一冲突；A 回滚后，B 的插入继续执行并成功。

</details>

**3.** 下面这段代码在并发下有什么问题？UPDATE 本来就会锁行，为什么锁没起作用？请改成一条 SQL。

```python
n = db.execute("SELECT reserved_milli FROM point_accounts WHERE user_id=1").fetchone()[0]
db.execute("UPDATE point_accounts SET reserved_milli=%s WHERE user_id=1", [n + 500])
```

<details>
<summary>参考答案</summary>

这是丢失更新：两个事务都读到同一个 `n`，各加 500 写回，最终只加了 500。UPDATE 的行锁只保护写这一步，`n + 500` 是在锁之外、基于旧值算出来的，B 拿到锁以后照样写入这个过时的值。改为 `UPDATE point_accounts SET reserved_milli = reserved_milli + 500 WHERE user_id = 1;`，让数据库在最新值上计算。

</details>

**4.** 把扣款写成 `SET balance_milli = balance_milli - 8000`，扣款业务就正确了吗？

<details>
<summary>参考答案</summary>

不完全正确。相对值更新解决了丢失更新，但不检查余额：A 扣完剩 2000，B 再扣就变成 −6000，透支了。要把检查也写进去：`WHERE user_id = 1 AND balance_milli >= 8000`，再根据影响行数判断成败。

</details>

**5.** 事务 A 对账户执行了条件更新 `UPDATE … SET balance_milli = balance_milli - 8000 WHERE user_id = 1 AND balance_milli >= 8000`，还没提交。事务 B 对同一个账户执行同样的语句。B 为什么会等待？A 提交后，B 为什么更新 0 行？

<details>
<summary>参考答案</summary>

A 的 UPDATE 给这一行加了行锁，B 要修改同一行，只能等 A 结束。A 提交后，在 READ COMMITTED 下，PostgreSQL 拿这一行的最新版本（余额 2000）重新检查 B 的 `WHERE balance_milli >= 8000`，条件不成立，所以更新 0 行。

</details>

**6.** 事务 A 用 `SELECT … FOR UPDATE` 锁住了用户 1 的账户。事务 B 用普通 `SELECT` 读这个账户，会被阻塞吗？读到的是什么？事务 C 要 UPDATE 这一行呢？

<details>
<summary>参考答案</summary>

B 不会被阻塞，普通读按 MVCC 直接读可见版本，读到的是当前已提交的值；如果 A 之后修改了这一行但还没提交，B 读到的仍是修改前的值。C 的 UPDATE 会等到 A 提交或回滚。

</details>

**7.** 数据库里没有 `a@x.com`。在事务里执行 `SELECT … WHERE email='a@x.com' FOR UPDATE`，能阻止别的事务插入这个邮箱吗？

<details>
<summary>参考答案</summary>

不能。`FOR UPDATE` 只锁查到的行，查不到就什么也没锁，别的事务照样可以插入。防止重复要靠唯一约束。

</details>

**8.** 事务 A 在 READ COMMITTED 下第一次读到余额 10，另一个事务扣了 8 点并提交，A 再读一次读到多少？如果 A 是 REPEATABLE READ 呢？在 REPEATABLE READ 下，A 接着去扣这一行的款，会发生什么？

<details>
<summary>参考答案</summary>

READ COMMITTED 下读到 2，因为每条语句用新快照。REPEATABLE READ 下仍然读到 10，因为沿用第一次读时的快照。A 接着去扣这一行，PostgreSQL 会报 `could not serialize access due to concurrent update`（SQLSTATE 40001），A 必须回滚，再从头重试整个事务。

</details>

**9.** 3.4 节"每个用户最多 1 个运行中的任务"的例子里，为什么 REPEATABLE READ 防不住，SERIALIZABLE 能防住？

<details>
<summary>参考答案</summary>

在 RR 下，A 和 B 的快照里都没有运行中的任务，各自查到 0；它们插入的是两条不同的行，没有修改同一行，所以不会触发并发更新错误，两笔都能提交，这就是写偏斜。SERIALIZABLE 会检查并发事务之间的读写依赖：两笔事务都读了对方要写入的数据范围，无法用任何一个串行顺序解释，于是让其中一笔报序列化错误回滚，重试时就会查到 1 个任务。

</details>

**10.** 为什么不能把耗时 30 秒的图片生成 API 调用，放在锁住账户行的扣款事务里？

<details>
<summary>参考答案</summary>

有三个原因。第一，账户行会被锁 30 秒，这个用户的其他生成请求全部等待。第二，事务一直占着一个数据库连接，并发一高连接池就耗尽，其他用户也受影响。第三，事务回滚撤销不了已经发出的外部请求和已经产生的费用。正确做法是用短事务受理（冻结点数、创建任务），在事务外调用生成服务，再用新的短事务结算。

</details>
