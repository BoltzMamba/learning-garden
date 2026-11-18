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

> 待补充：用自己的话写一两句，说明这次想验证什么。

## 技术方案与选型

- 模型：DeepSeek API（兼容 OpenAI SDK）
- 工具：`get_weather(city)`，返回模拟的明天天气
- 不使用 Agent 框架

> 待补充：为什么这样选，以及考虑过但放弃的方案。

## 核心实现

> 待补充：贴出自己重写的 Agent 循环关键代码，并解释每一步。

## 遇到的问题

> 待补充

## 调试过程

> 待补充

## 实验结果

> 待补充：真实运行的输出、截图或录屏（正常情况和工具出错各一次）。

## 总结与反思

> 待补充
