---
title: "Weather Trip Helper: Building a Minimal Tool-Calling Agent from Scratch"
description: "A minimal agent loop built with the DeepSeek API and a simulated weather tool (project log, in progress)."
translation:
  mode: auto
  sourceHash: "sha256:52d29dd5f752c8328f09a0c93d27be50076655a23f4ab864151f4c12f7c96ff7"
  generatedHash: "sha256:19e48ed1df0efe6443b5096b700e0333f9c2f22c9f2664686e1fe63a7a219e25"
  rulesVersion: 1
---

## Project Goal

Use a small trip-recommendation scenario to build, by hand, the basic loop from [[agent-learning-01]]: the LLM decides whether to call a tool, the program carries out the :concept[tool use]{id="tool-use"}, and the result goes back to the LLM so it can keep reasoning.

> To be written: in one or two sentences of my own, what this experiment is meant to verify.

## Technical Approach and Choices

- Model: DeepSeek API (compatible with the OpenAI SDK)
- Tool: `get_weather(city)`, which returns tomorrow's simulated weather
- No agent framework

> To be written: why these choices, and which alternatives I considered and dropped.

## Core Implementation

> To be written: the key code of my own rewritten agent loop, with an explanation of each step.

## Problems Encountered

> To be written

## Debugging Process

> To be written

## Results

> To be written: real output, screenshots or a recording (one normal run and one with a tool failure).

## Summary and Reflections

> To be written
