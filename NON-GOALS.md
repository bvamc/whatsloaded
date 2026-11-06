# Non-Goals for whatsloaded

To keep `whatsloaded` focused, lightweight, and dependable, the following capabilities are explicitly out of scope:

1. **Not a Multi-Agent Hosting Framework**: We don't orchestrate or run agents (like Alibaba's AgentScope, LangGraph, or AutoGen).
2. **Not a Cross-Agent Configuration Sync Engine**: Tools like `gaal`, `rulesync`, and `ruler` synchronize configuration files across agents. `whatsloaded` is an observer and diagnostic tool; it doesn't force a single source-of-truth format or sync between tools.
3. **Not an MCP Server Gateway or Proxy**: We do not host MCP gateways or route JSON-RPC traffic. We probe MCP servers to verify compatibility and environment variables.
4. **Not a Skills Marketplace**: We do not distribute or host downloadable skills or packages.
5. **Not a Token/Cost Analytics Dashboard**: Tools like `ccusage` specifically track historical API token usage and costs.
6. **Not an LLM Semantic Judge**: We do not perform fuzzy LLM evaluations on whether prompt instructions contradict each other. We deterministically resolve load order, scopes, shadowing, and syntactical validity.
