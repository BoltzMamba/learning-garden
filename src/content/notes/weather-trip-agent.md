---
title: "天气出游小助手：从零写一个最小工具调用 Agent"
description: "用 DeepSeek API 和一个模拟天气工具，实现最小的 Agent 循环（项目记录，编写中）。"
category: "projects"
tags: ["ai-agent", "large-language-models"]
published: "2026-11-18"
projectTier: experiment
experimentId: weather-trip-agent
sourceNote: agent-learning-01
---

## 项目目标

用一个出游推荐的小场景，亲手实现 [[agent-learning-01]] 中的基本循环：LLM 决定是否调用工具，程序执行:concept[工具使用]{id="tool-use"}，再把结果交还给 LLM 继续推理。

## 技术方案与选型

- 模型：DeepSeek API（兼容 OpenAI SDK）
- 工具：`get_weather(city)`，返回模拟的明天天气
- 不使用 Agent 框架

天气数据故意用模拟数据，不接真实的天气 API，把注意力放在 Agent 循环本身。不用框架也是同样的考虑：循环的每一步都自己写出来，才能看清楚它是怎么运转的。

### 项目结构

| 文件 | 职责 |
|---|---|
| `tools.py` | 工具函数 `get_weather` 和给 LLM 看的工具说明 `TOOLS` |
| `agent.py` | Agent 循环：调用 LLM、执行工具、回传结果、判断终止 |
| `main.py` | 读取用户输入，打印最终回答，处理 API 错误 |

API key 放在本地的 `.env` 文件里，代码通过 `python-dotenv` 读取，`.env` 已写入 `.gitignore`，不会提交到仓库。

## 核心实现

### 工具定义

工具需要根据 Agent 实际要完成的任务来设计。本次实验为了尽可能简单，只有一个工具 `get_weather(city)`，从模拟数据中查询明天的天气。

LLM 看不到工具函数的 Python 代码，只能看到一份工具说明。说明里要写清楚三件事：工具名（`name`）、用途（`description`），以及参数（`parameters`，用 JSON Schema 描述）：

```python
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "查询某个城市明天的天气（天气状况和最低/最高气温，单位摄氏度）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "城市中文名，例如：北京"}
                },
                "required": ["city"],
            },
        },
    }
]
```

它和函数签名大同小异，只是写给 LLM 看的。LLM 根据 `description` 判断什么时候该用这个工具，根据 `parameters` 决定传什么参数。

注意：LLM 并不会自己执行工具。它只是在回复里提出调用请求（`tool_calls`），真正执行 `get_weather` 的是我们的程序。

### Agent 循环

整个流程是一个循环：

获得用户输入 → 和系统提示词、历史对话一起发送给 LLM → LLM 请求调用工具 → 程序执行工具，把结果追加进对话 → 再次发送给 LLM → LLM 根据结果给出回答

关键代码如下（省略了调试用的 `print`）：

```python
def run_agent(user_input: str) -> str:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_input},
    ]

    for step in range(1, MAX_STEPS + 1):
        response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=TOOLS,
        )
        msg = response.choices[0].message

        # 终止条件 1：LLM 不再请求工具，说明它给出了最终回答
        if not msg.tool_calls:
            return msg.content

        # LLM 请求了工具：先把它的"请求"记进对话历史
        messages.append(msg)

        for call in msg.tool_calls:
            result = run_tool(call.function.name, call.function.arguments)
            # 把结果以 role=tool 回传，tool_call_id 要对应上
            messages.append({
                "role": "tool",
                "tool_call_id": call.id,
                "content": json.dumps(result, ensure_ascii=False),
            })

    # 终止条件 2：超过最大步数
    return f"抱歉，超过最大步数（{MAX_STEPS}）仍未得出结论，已停止。"
```

模型不会记得上一次请求的内容，所以每一轮都要把完整的 `messages` 发过去，它就是模型这一次能看到的:concept[上下文]{id="llm-context"}。以"明天去北京"为例：

- 第 1 轮发送 2 条消息（系统提示词、用户输入），LLM 请求调用 `get_weather(city="北京")`。
- 程序追加 2 条消息：LLM 的调用请求，以及工具返回的天气。
- 第 2 轮发送 4 条消息，LLM 看到天气后给出推荐，不再请求工具，循环结束。

### 终止条件与错误处理

两个终止条件：

1. LLM 给出最终回答，也就是回复里不再有工具调用请求。
2. 超过最大步数（`MAX_STEPS = 5`），防止循环一直进行下去。

工具出错时，通过返回 `error` 把错误交还给 LLM，而不是让程序直接崩溃。城市不存在是预料之中的情况，所以 `get_weather` 直接返回 `{"error": ..., "supported_cities": [...]}`，同时告诉 LLM 支持哪些城市。参数格式错误、工具名不存在等意外情况，由 `run_tool` 中的 `try/except` 统一捕获，同样转换成 `error` 返回。

普通程序遇到错误时，"打印报错然后退出"有时也可以接受。但 Agent 的核心是"调用工具 → 读取结果 → 继续执行"这个循环，错误本身也是一种需要读取的结果：LLM 读到错误后，可以如实告诉用户出了什么问题，而不是编造一个天气。

## 实验结果

下面是真实运行的终端输出。

### 正常情况

晴天推荐户外：

```text
你明天想去哪个城市玩？北京

助手： 明天北京是晴天，气温 3℃～12℃，白天适合户外活动，但早晚偏冷。

推荐去处：**颐和园**（或故宫、景山这类户外园林/古建景区）

理由：
- 晴天光线好，拍照和散步体验佳，尤其昆明湖、万寿山一带视野开阔；
- 明天最高 12℃，正午前后体感舒适，适合长时间在户外逛园子；
- 建议上午 10 点到下午 3 点之间为主要游览时段，早晚只有 3℃ 左右，记得穿厚外套、戴围巾，风大的湖边注意保暖。

如果你更想看展览或不想吹风，我也可以换推荐室内的博物馆类去处。
```

下雨推荐室内：

```text
你明天想去哪个城市玩？上海

助手： 上海明天是小雨，气温 10–15℃，偏凉。

推荐：**上海博物馆（人民广场馆）**

理由：
- 明天下雨，室内活动更舒适，不用撑伞暴走；
- 温度只有 10–15℃，馆内温暖，适合慢慢逛；
- 馆藏丰富（青铜器、陶瓷、书画等），逛上大半天很合适，而且人民广场交通方便，地铁直达，雨天通勤少淋雨。

小提示：
- 10–15℃ 加小雨，建议带伞和一件防风外套，鞋子选防水或防滑的；
- 博物馆通常需要提前在公众号预约，出发前记得看一下是否闭馆（周一多数博物馆闭馆）；
- 如果逛完还想活动，可顺路去附近的南京路步行街室内商场（如新世界城、来福士）吃饭逛街，减少淋雨。
```

两次推荐都和模拟天气一致：北京晴天推荐户外的颐和园，上海小雨推荐室内的博物馆。

### 工具出错

输入一个不在模拟数据里的城市：

```text
你明天想去哪个城市玩？新加坡

助手： 抱歉，我这边查不到新加坡的天气数据——工具返回了错误：“没有找到城市「新加坡」的天气数据”，目前仅支持北京、上海、广州、成都四个城市。

因为拿不到明天的天气，我就没法按惯例（下雨推荐室内、晴天推荐户外）给你做靠谱的推荐，也不想凭空编造天气。你可以：

- 换一个上述支持的城市，我马上帮你查天气并推荐去处；
- 或者你自己确认下新加坡明天的天气告诉我，我再帮你规划。
```

程序没有崩溃。LLM 读到工具返回的错误后，告诉了用户原因和支持的城市，也没有编造天气。

### 超过最大步数

临时把 `MAX_STEPS` 改成 `1`：第 1 轮 LLM 请求了工具，还没来得及读取结果，步数就用完了。

```text
你明天想去哪个城市玩？北京

助手： 抱歉，超过最大步数（1）仍未得出结论，已停止。
```

## 总结与反思

> 待补充：这次动手后，对 Agent 循环的理解有什么变化？如果继续做，下一步想改进什么？

## 代码仓库

[BoltzMamba/agent-experiments：weather-trip-agent](https://github.com/BoltzMamba/agent-experiments/tree/main/weather-trip-agent)
