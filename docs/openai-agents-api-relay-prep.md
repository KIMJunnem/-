# OpenAI Agents API architecture research and Relay Desk integration prep

Date: 2026-09-27

Official references:
- https://developers.openai.com/api/docs/guides/agents
- https://developers.openai.com/api/docs/guides/agents-api/overview
- https://developers.openai.com/api/docs/guides/agents-api/architecture
- https://developers.openai.com/api/docs/guides/agents-api/quickstart
- https://developers.openai.com/api/docs/guides/agents-api/sessions
- https://developers.openai.com/api/docs/guides/agents-api/tools/functions
- https://developers.openai.com/api/docs/guides/agents-api/sessions/webhooks
- https://developers.openai.com/api/docs/guides/agents-api/observability
- https://developers.openai.com/api/docs/guides/agents-api/tracing

## 1. Official architecture

OpenAI recommends the Agents API as the starting point for new agent applications.

OpenAI manages:
- hosted Codex harness
- orchestration
- durable session state
- context compaction
- recovery

The application manages:
- product logic
- function tool implementations
- external integrations
- execution-environment choice and lifecycle when needed

Core concepts:
- Agent: model, instructions, tools, MCP
- Environment: none / openai_hosted / self_hosted
- Session: durable agent instance
- Events and items: input, progress, tool calls, and results

Relay Desk maps naturally to the application-server role.

## 2. Recommended first Relay Desk shape

Initial environment: none.

Why:
- Relay Desk already owns customer state, budgets, alerts, simulations, and learning candidates.
- The hosted harness does not need direct access to the PC shell or filesystem.
- Function tools can expose only the narrow data that the manager needs.
- This has a smaller attack surface and lower lifecycle complexity than a self-hosted executor.

Architecture:

OpenAI Agents API
  -> hosted Codex harness
  -> durable session / orchestration
  -> function calls
  -> Relay Desk application server
     - relay_status
     - relay_alerts
     - relay_usage
     - relay_customer_simulation_status
     - relay_learning_candidates

All currently prepared tools are read-only.

## 3. Current prewiring

Files:
- server/openai-agents-api.js
- server/config/astra-relay-operating-policy.json : openaiAgentsApi
- server/operating-policy.js : openaiAgentsApiPolicy()
- server/relay-server.js : status / preview / tool-preview

Current policy:
- enabled: true
- mode: shadow
- executePaidCalls: false
- model: gpt-6-astra
- environment: none
- webhooks: off
- session persistence: off
- customer send/payment/delivery/code patch: off
- state-changing external actions require approval

Request shapes and the tool bridge are prepared, but no Agents API session is created.

## 4. Official API contract already reflected

Application API key permissions from the official quickstart:
- api.agents.read
- api.agents.write
- api.responses.write

Beta header:
- OpenAI-Beta: agents=v1

Session creation:
- POST /v1/agents/sessions

Relay Desk dry-run:
- POST /api/openai-agents/preview

The local dry-run returns the request shape only and makes no OpenAI call.

Continue or steer a session:
- POST /v1/agents/sessions/{session_id}/events
- user input event: agent.session.input.message
- cancel event: agent.session.input.cancel

Function result flow:
- pending functions appear in session required_actions with type, turn_id, call_id, name, and arguments
- Relay Desk returns agent.session.input.tool_result with the same turn_id and call_id

Relay Desk local bridge test:
- POST /api/openai-agents/tool-preview

Observability:
- session logs
- event stream
- saved history/items
- usage
- traces

Future mapping:
- OpenAI session_id <-> Relay task/workflow id
- turn_id <-> one unit of work
- call_id <-> Relay tool invocation
- trace usage <-> Relay usage ledger
- failed session <-> Relay alert

## 5. Environment strategy

### none - first choice

Use for:
- customer-support supervision
- status inspection
- budget inspection
- simulation review
- learning-candidate review

Benefits:
- no local shell exposure
- no local filesystem exposure
- Relay Desk controls function-tool permissions

### openai_hosted - later candidate

Possible use:
- isolated document/code/artifact experiments

Check before enabling:
- sandbox cost
- artifact persistence/retrieval
- network access
- customer-data upload policy

### self_hosted - last

Possible future use:
- local Relay Desk PC/private-network tasks
- direct local program/file execution

Reasons to keep disabled now:
- executor lifecycle and reconnect handling
- duplicate environment prevention
- local files and secrets boundary
- separate approval gates for customer sends, payment, delivery, and code changes

## 6. Webhook direction

Official session lifecycle webhooks can report creation, required action, in-progress, idle, and failed state.

Proposed Relay mapping:
- action_required(function_call) -> Relay tool worker
- idle -> persist result and usage
- failed -> Relay alert
- environment_connection -> executor manager only if self_hosted is enabled later

Webhooks remain disabled until signature verification and secret storage are implemented.

## 7. Cost boundary

Agents API is OpenAI Platform API usage, not ChatGPT/Work subscription usage.

Official docs state:
- model usage is billed at the selected model API rate
- OpenAI tools use their normal tool rates
- OpenAI-hosted sandboxes use container rates

Therefore Relay Desk must treat Agents API as a separate API budget from Work/Codex subscription resets.

Current executePaidCalls=false means this preparation makes no Agents API calls.

## 8. Current safety boundary

Not granted:
- send customer messages
- send quotes
- change prices
- process payments
- mark delivery
- patch code
- change server configuration
- local shell
- local file write
- self-hosted executor

Start as a manager/read-only observer. Add state-changing permissions one at a time only after evidence and review.

## 9. Activation sequence

1. Create a Platform application API key.
2. Grant only the three required Agents API permissions.
3. Inspect Relay Desk local session-payload preview.
4. Run local previews for all five read-only tools.
5. Set an explicit API budget.
6. Change policy from shadow to active.
7. Explicitly set executePaidCalls=true.
8. Run one synthetic environment=none session.
9. Verify usage, trace, and session recovery.
10. Implement verified webhook signature handling.
11. Evaluate unattended sessions.
12. Consider openai_hosted only for isolated artifact work.
13. Consider self_hosted last.

## 10. Current decision

Ready now:
- architecture mapping
- session and tool contract
- read-only Relay tools
- dry-run payload generation
- usage/alert/simulation mapping

Needs testing:
- actual application API key permissions
- create/continue session
- required_actions -> tool_result round trip
- trace and usage ingestion

Hold:
- automatic customer send
- payment or delivery mutation
- self-hosted local PC executor
- webhook-driven unattended execution
- customer-data artifact work in OpenAI-hosted sandboxes
