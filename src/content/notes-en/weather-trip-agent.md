---
title: "Weather Trip Helper: Building a Minimal Tool-Calling Agent from Scratch"
description: "A minimal agent loop built with the DeepSeek API and a simulated weather tool (project log, in progress)."
translation:
  mode: auto
  sourceHash: "sha256:3b37ab897f06744896eb6e4dd8262c702284e60e3b960d5c7d59ffe2b64c21ba"
  generatedHash: "sha256:01a157e303027229f442cbe8d6d7104abec949e5f5c1f97072645c1bf502801a"
  rulesVersion: 1
---

## Project Goal

Use a small trip-recommendation scenario to build, by hand, the basic loop from [[agent-learning-01]]: the LLM decides whether to call a tool, the program carries out the :concept[tool use]{id="tool-use"}, and the result goes back to the LLM so it can keep reasoning.

## Technical Approach and Choices

- Model: DeepSeek API (compatible with the OpenAI SDK)
- Tool: `get_weather(city)`, which returns tomorrow's simulated weather
- No agent framework

The weather data is deliberately simulated instead of coming from a real weather API, to keep the focus on the agent loop itself. Skipping a framework has the same purpose: writing every step of the loop myself is the way to see clearly how it works.

### Project Structure

| File | Responsibility |
|---|---|
| `tools.py` | The tool function `get_weather` and the tool description `TOOLS` that the LLM reads |
| `agent.py` | The agent loop: call the LLM, run tools, return results, check termination |
| `main.py` | Read user input, print the final answer, handle API errors |

The API key lives in a local `.env` file, which the code reads through `python-dotenv`. `.env` is listed in `.gitignore`, so it is never committed to the repository.

## Core Implementation

### Tool Definition

A tool should be designed around the task the agent actually has to complete. To keep this experiment as simple as possible, there is only one tool, `get_weather(city)`, which looks up tomorrow's weather in the simulated data.

The LLM cannot see the Python code of the tool function. It only sees a tool description, which has to state three things: the tool name (`name`), its purpose (`description`) and its parameters (`parameters`, described with JSON Schema):

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

It is much like a function signature, except that it is written for the LLM. The LLM uses `description` to decide when to use the tool, and `parameters` to decide which arguments to pass.

Note: the LLM never runs the tool itself. It only puts a call request (`tool_calls`) in its reply; our program is what actually runs `get_weather`.

### Agent Loop

The whole process is a loop:

Get the user input → send it to the LLM together with the system prompt and the conversation history → the LLM requests a tool call → the program runs the tool and appends the result to the conversation → send everything to the LLM again → the LLM answers based on the result

The key code is below (the debugging `print` calls are omitted):

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

        # Termination condition 1: the LLM no longer requests a tool, so it has given its final answer
        if not msg.tool_calls:
            return msg.content

        # The LLM requested a tool: first record its "request" in the conversation history
        messages.append(msg)

        for call in msg.tool_calls:
            result = run_tool(call.function.name, call.function.arguments)
            # Send the result back with role=tool; tool_call_id must match the request
            messages.append({
                "role": "tool",
                "tool_call_id": call.id,
                "content": json.dumps(result, ensure_ascii=False),
            })

    # Termination condition 2: the maximum number of steps is exceeded
    return f"抱歉，超过最大步数（{MAX_STEPS}）仍未得出结论，已停止。"
```

The model does not remember previous requests, so every round has to send the complete `messages` list: it is the :concept[context]{id="llm-context"} the model can see in that call. Taking "going to Beijing tomorrow" as an example:

- Round 1 sends 2 messages (the system prompt and the user input), and the LLM requests `get_weather(city="北京")`.
- The program appends 2 messages: the LLM's call request and the weather returned by the tool.
- Round 2 sends 4 messages. After seeing the weather, the LLM gives a recommendation and requests no more tools, so the loop ends.

### Termination and Error Handling

There are two termination conditions:

1. The LLM gives its final answer, meaning its reply contains no tool call request.
2. The maximum number of steps (`MAX_STEPS = 5`) is exceeded, which stops the loop from running forever.

When a tool fails, it returns an `error` that goes back to the LLM, instead of crashing the program. An unknown city is an expected case, so `get_weather` returns `{"error": ..., "supported_cities": [...]}` directly, which also tells the LLM which cities are supported. Unexpected problems, such as malformed arguments or a tool name that does not exist, are caught in one place by the `try/except` in `run_tool` and also turned into an `error` result.

For an ordinary program, "print the error and exit" is sometimes acceptable. But the core of an agent is the loop of calling a tool, reading the result and continuing, so an error is itself a result to be read: after reading it, the LLM can tell the user honestly what went wrong instead of making up the weather.

## Results

Below is real terminal output.

### Normal Runs

Sunny weather leads to an outdoor recommendation:

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

Rain leads to an indoor recommendation:

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

Both recommendations match the simulated weather: sunny Beijing gets the outdoor Summer Palace, and rainy Shanghai gets an indoor museum.

### Tool Failure

The input is a city that is not in the simulated data:

```text
你明天想去哪个城市玩？新加坡

助手： 抱歉，我这边查不到新加坡的天气数据——工具返回了错误：“没有找到城市「新加坡」的天气数据”，目前仅支持北京、上海、广州、成都四个城市。

因为拿不到明天的天气，我就没法按惯例（下雨推荐室内、晴天推荐户外）给你做靠谱的推荐，也不想凭空编造天气。你可以：

- 换一个上述支持的城市，我马上帮你查天气并推荐去处；
- 或者你自己确认下新加坡明天的天气告诉我，我再帮你规划。
```

The program did not crash. After reading the error returned by the tool, the LLM told the user the reason and listed the supported cities, without making up any weather.

### Exceeding the Maximum Steps

With `MAX_STEPS` temporarily set to `1`, the LLM requests the tool in round 1, and the steps run out before it can read the result.

```text
你明天想去哪个城市玩？北京

助手： 抱歉，超过最大步数（1）仍未得出结论，已停止。
```

## Summary and Reflections

> To be written: how has my understanding of the agent loop changed after building it? If I keep going, what would I improve next?

## Code Repository

[BoltzMamba/agent-experiments: weather-trip-agent](https://github.com/BoltzMamba/agent-experiments/tree/main/weather-trip-agent)
