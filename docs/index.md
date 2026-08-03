---
layout: home

hero:
  name: autopoker
  text: A robot that watches your screen and acts on it
  tagline: Pixel rules or an LLM decide what to click — from live multi-monitor screenshots, with dry-run, confidence gates and a global kill switch in between.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: User guide
      link: /guide/
    - theme: alt
      text: Developer guide
      link: /dev/

features:
  - icon: 🖥️
    title: Sees every monitor
    details: In-process native capture of all displays on an interval, streamed live to a browser UI where you drag rectangles to register regions.
  - icon: ⚙️
    title: Manual mode
    details: Regions fire their own action lists when a pixel condition matches — color at a point, average color, or similarity against a captured baseline. No model involved.
  - icon: 🧠
    title: LLM mode
    details: Screenshots plus your markdown strategy go to a vision model — local Ollama or Anthropic, OpenAI, Google, any OpenAI-compatible endpoint — and the model decides the next action.
  - icon: 🎯
    title: Landmarks, not guesses
    details: The model clicks registered regions by name. autopoker resolves the name to exact screen coordinates, so precision never depends on the model's eyesight.
  - icon: 🛡️
    title: Safe by default
    details: Dry-run on by default, a global Escape kill switch, a mouse-to-corner failsafe, confidence thresholds, action caps and call rate limits.
  - icon: 🔌
    title: Pluggable everywhere
    details: Providers are a dropdown. The decision layer is one interface. Native capture and input live behind adapters. Everything else is typed, tested TypeScript.
---
