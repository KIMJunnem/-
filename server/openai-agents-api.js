'use strict';

const AGENTS_API = Object.freeze({
  baseUrl: 'https://api.openai.com',
  betaHeader: 'agents=v1',
  sessionsPath: '/v1/agents/sessions',
  permissionsRequired: Object.freeze([
    'api.agents.read',
    'api.agents.write',
    'api.responses.write'
  ]),
  environmentTypes: Object.freeze(['none', 'openai_hosted', 'self_hosted'])
});

const READ_ONLY_TOOL_NAMES = Object.freeze([
  'relay_status',
  'relay_alerts',
  'relay_usage',
  'relay_customer_simulation_status',
  'relay_learning_candidates'
]);

const DEFAULT_POLICY = Object.freeze({
  enabled: true,
  mode: 'shadow',
  executePaidCalls: false,
  model: 'gpt-6-astra',
  reasoningEffort: 'low',
  environment: Object.freeze({
    type: 'none',
    openaiHostedEnabled: false,
    selfHostedEnabled: false
  }),
  tools: Object.freeze({
    mode: 'read_only',
    allowed: READ_ONLY_TOOL_NAMES
  }),
  webhooks: Object.freeze({
    enabled: false,
    signatureVerificationRequired: true
  }),
  sessionPersistence: Object.freeze({
    enabled: false,
    storeSessionIds: false
  }),
  externalActions: Object.freeze({
    customerSend: false,
    payment: false,
    delivery: false,
    codePatch: false,
    requireApproval: true
  })
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePolicy(raw = {}) {
  const base = clone(DEFAULT_POLICY);
  const input = raw && typeof raw === 'object' ? raw : {};
  const env = input.environment && typeof input.environment === 'object' ? input.environment : {};
  const tools = input.tools && typeof input.tools === 'object' ? input.tools : {};
  const webhooks = input.webhooks && typeof input.webhooks === 'object' ? input.webhooks : {};
  const persistence = input.sessionPersistence && typeof input.sessionPersistence === 'object' ? input.sessionPersistence : {};
  const actions = input.externalActions && typeof input.externalActions === 'object' ? input.externalActions : {};

  base.enabled = input.enabled !== false;
  base.mode = String(input.mode || '').toLowerCase() === 'active' ? 'active' : 'shadow';
  base.executePaidCalls = input.executePaidCalls === true && base.mode === 'active';
  base.model = String(input.model || base.model).slice(0, 120);
  base.reasoningEffort = ['none', 'low', 'medium', 'high'].includes(String(input.reasoningEffort || '').toLowerCase())
    ? String(input.reasoningEffort).toLowerCase()
    : 'low';

  const requestedEnv = String(env.type || 'none').toLowerCase();
  base.environment.type = AGENTS_API.environmentTypes.includes(requestedEnv) ? requestedEnv : 'none';
  base.environment.openaiHostedEnabled = env.openaiHostedEnabled === true;
  base.environment.selfHostedEnabled = env.selfHostedEnabled === true;
  if (base.environment.type === 'openai_hosted' && !base.environment.openaiHostedEnabled) base.environment.type = 'none';
  if (base.environment.type === 'self_hosted' && !base.environment.selfHostedEnabled) base.environment.type = 'none';

  const allowed = Array.isArray(tools.allowed)
    ? tools.allowed.map(String).filter(name => READ_ONLY_TOOL_NAMES.includes(name))
    : [...READ_ONLY_TOOL_NAMES];
  base.tools.mode = 'read_only';
  base.tools.allowed = [...new Set(allowed)];

  base.webhooks.enabled = webhooks.enabled === true && base.mode === 'active';
  base.webhooks.signatureVerificationRequired = true;

  base.sessionPersistence.enabled = persistence.enabled === true && base.mode === 'active';
  base.sessionPersistence.storeSessionIds = base.sessionPersistence.enabled && persistence.storeSessionIds === true;

  // Prep phase is intentionally read-only. These cannot be enabled through policy alone.
  base.externalActions = {
    customerSend: false,
    payment: false,
    delivery: false,
    codePatch: false,
    requireApproval: true
  };

  return base;
}

function toolDefinitions(policy = {}) {
  const cfg = normalizePolicy(policy);
  const all = {
    relay_status: {
      type: 'function',
      name: 'relay_status',
      description: 'Read a compact Relay Desk operating status snapshot. This tool is read-only.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    },
    relay_alerts: {
      type: 'function',
      name: 'relay_alerts',
      description: 'Read current Relay Desk alerts. This tool is read-only and cannot resolve alerts.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    },
    relay_usage: {
      type: 'function',
      name: 'relay_usage',
      description: 'Read current model usage and budget counters. This tool is read-only.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    },
    relay_customer_simulation_status: {
      type: 'function',
      name: 'relay_customer_simulation_status',
      description: 'Read the latest autonomous customer-response simulation status and quality metrics. This tool does not start a simulation.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    },
    relay_learning_candidates: {
      type: 'function',
      name: 'relay_learning_candidates',
      description: 'Read open customer-response learning candidates discovered by simulations. This tool is read-only.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 20 }
        },
        additionalProperties: false
      }
    }
  };
  return cfg.tools.allowed.map(name => clone(all[name])).filter(Boolean);
}

const RELAY_MANAGER_INSTRUCTIONS = [
  'You are the Relay Desk manager agent.',
  'Use Relay Desk read-only function tools to inspect status, alerts, usage, simulations, and learning candidates.',
  'Do not send customer messages, accept payments, mark delivery, change prices, modify code, or change server configuration.',
  'Do not claim an external action happened unless Relay Desk reports evidence that it happened.',
  'If an action would change customer, payment, delivery, code, or configuration state, stop and request operator approval.',
  'Prefer concise status summaries and identify the exact evidence or tool result used.'
].join('\n');

function sessionCreatePayload({ input = '', policy = {}, metadata = {} } = {}) {
  const cfg = normalizePolicy(policy);
  const text = String(input || '').trim();
  if (!text) throw new Error('agents_api_input_required');
  const body = {
    agent: {
      model: cfg.model,
      instructions: RELAY_MANAGER_INSTRUCTIONS,
      tools: toolDefinitions(cfg)
    },
    environment: { type: cfg.environment.type },
    input: text,
    stream: false
  };
  if (cfg.reasoningEffort !== 'none') body.agent.reasoning = { effort: cfg.reasoningEffort };
  const safeMetadata = Object.fromEntries(Object.entries(metadata || {})
    .slice(0, 16)
    .map(([key, value]) => [String(key).slice(0, 64), String(value).slice(0, 256)]));
  if (Object.keys(safeMetadata).length) body.metadata = safeMetadata;
  return body;
}

function sessionMessageEvent(text) {
  const value = String(text || '').trim();
  if (!value) throw new Error('agents_api_message_required');
  return {
    events: [{
      type: 'agent.session.input.message',
      input: [{
        role: 'user',
        content: [{ type: 'input_text', text: value }]
      }]
    }]
  };
}

function sessionCancelEvent() {
  return { events: [{ type: 'agent.session.input.cancel' }] };
}

function toolResultEvent(action, outcome = {}) {
  if (!action || action.type !== 'function_call') throw new Error('agents_api_function_action_required');
  const turnId = String(action.turn_id || '').trim();
  const callId = String(action.call_id || '').trim();
  if (!turnId || !callId) throw new Error('agents_api_function_action_ids_required');
  const success = outcome.success !== false;
  const event = {
    type: 'agent.session.input.tool_result',
    turn_id: turnId,
    call_id: callId,
    success
  };
  if (success) {
    event.output = typeof outcome.output === 'string' ? outcome.output : JSON.stringify(outcome.output ?? {});
  } else {
    event.error = String(outcome.error || 'relay_tool_failed').slice(0, 1000);
  }
  return { events: [event] };
}

function sessionPaths(sessionId) {
  const id = String(sessionId || '').trim();
  if (!/^sess_[A-Za-z0-9_-]+$/.test(id)) throw new Error('agents_api_session_id_invalid');
  return {
    session: `${AGENTS_API.sessionsPath}/${id}`,
    events: `${AGENTS_API.sessionsPath}/${id}/events`,
    items: `${AGENTS_API.sessionsPath}/${id}/items`,
    traces: `${AGENTS_API.sessionsPath}/${id}/traces`
  };
}

function parseActionArguments(action) {
  const raw = action?.arguments;
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      throw new Error('agents_api_function_arguments_invalid');
    }
  }
  throw new Error('agents_api_function_arguments_invalid');
}

async function executeReadOnlyFunction(action, deps = {}, policy = {}) {
  const cfg = normalizePolicy(policy);
  if (!action || action.type !== 'function_call') throw new Error('agents_api_function_action_required');
  const name = String(action.name || '');
  if (!cfg.tools.allowed.includes(name)) throw new Error('agents_api_tool_not_allowed');
  const args = parseActionArguments(action);

  let output;
  if (name === 'relay_status') {
    output = await deps.status();
  } else if (name === 'relay_alerts') {
    output = await deps.alerts();
  } else if (name === 'relay_usage') {
    output = await deps.usage();
  } else if (name === 'relay_customer_simulation_status') {
    output = await deps.simulationStatus();
  } else if (name === 'relay_learning_candidates') {
    output = await deps.learningCandidates(Math.max(1, Math.min(Number(args.limit) || 10, 20)));
  } else {
    throw new Error('agents_api_tool_not_implemented');
  }

  return toolResultEvent(action, { success: true, output });
}

function readiness({ policy = {}, hasOpenAIKey = false } = {}) {
  const cfg = normalizePolicy(policy);
  const blockers = [];
  if (!cfg.enabled) blockers.push('policy_disabled');
  if (cfg.mode !== 'active') blockers.push('shadow_mode');
  if (!cfg.executePaidCalls) blockers.push('paid_execution_disabled');
  if (!hasOpenAIKey) blockers.push('openai_api_key_missing');
  if (cfg.environment.type === 'self_hosted' && !cfg.environment.selfHostedEnabled) blockers.push('self_hosted_environment_disabled');
  if (cfg.webhooks.enabled && !cfg.webhooks.signatureVerificationRequired) blockers.push('webhook_signature_verification_required');

  return {
    prepared: true,
    active: blockers.length === 0,
    blockers,
    api: clone(AGENTS_API),
    policy: cfg,
    recommendedInitialEnvironment: 'none',
    rationale: 'Relay Desk application functions can be exposed as read-only function tools without giving the hosted harness shell or local-file access.'
  };
}

function activationPlan() {
  return [
    { step: 1, status: 'ready', action: 'Create an OpenAI application API key with api.agents.read, api.agents.write, and api.responses.write.' },
    { step: 2, status: 'ready', action: 'Keep environment.type=none for the first Relay Desk pilot and expose only read-only Relay function tools.' },
    { step: 3, status: 'blocked_by_choice', action: 'Switch policy mode from shadow to active and explicitly allow paid execution only after a budget is approved.' },
    { step: 4, status: 'future', action: 'Add verified session webhooks before unattended long-running sessions.' },
    { step: 5, status: 'future', action: 'Consider openai_hosted only for isolated artifact work; keep self_hosted disabled until the local executor boundary is reviewed.' }
  ];
}

module.exports = {
  AGENTS_API,
  READ_ONLY_TOOL_NAMES,
  DEFAULT_POLICY,
  RELAY_MANAGER_INSTRUCTIONS,
  normalizePolicy,
  toolDefinitions,
  sessionCreatePayload,
  sessionMessageEvent,
  sessionCancelEvent,
  sessionPaths,
  parseActionArguments,
  toolResultEvent,
  executeReadOnlyFunction,
  readiness,
  activationPlan
};
