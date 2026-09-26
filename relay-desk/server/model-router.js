'use strict';

const SERVICE_TIERS = Object.freeze(['standard', 'fast', 'ultrafast']);

const DEFAULT_FUTURE_ROUTING = Object.freeze({
  enabled: true,
  mode: 'shadow',
  serviceTier: Object.freeze({
    default: 'standard',
    allowed: SERVICE_TIERS,
    autoPromoteUrgent: false,
    autoPromoteInteractive: false,
    ultrafastEnabled: false,
    providerPassthrough: Object.freeze({
      enabled: false,
      field: 'service_tier',
      mapping: Object.freeze({
        standard: 'standard',
        fast: 'fast',
        ultrafast: 'ultrafast'
      })
    })
  }),
  agentCapabilities: Object.freeze({
    persistentAgent: Object.freeze({ enabled: false, role: 'router_only' }),
    externalIdentity: Object.freeze({ enabled: false, type: 'none', identifier: null }),
    emailAction: Object.freeze({
      enabled: false,
      read: false,
      draft: false,
      send: false,
      requireApproval: true
    })
  })
});

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeServiceTier(value, fallback = 'standard') {
  const candidate = String(value || '').trim().toLowerCase();
  return SERVICE_TIERS.includes(candidate) ? candidate : fallback;
}

function normalizeFutureRoutingPolicy(raw = {}) {
  const base = copy(DEFAULT_FUTURE_ROUTING);
  const input = raw && typeof raw === 'object' ? raw : {};
  const tier = input.serviceTier && typeof input.serviceTier === 'object' ? input.serviceTier : {};
  const capabilities = input.agentCapabilities && typeof input.agentCapabilities === 'object'
    ? input.agentCapabilities
    : {};

  const allowed = Array.isArray(tier.allowed)
    ? [...new Set(tier.allowed.map(value => normalizeServiceTier(value, '')).filter(Boolean))]
    : [...SERVICE_TIERS];

  base.enabled = input.enabled !== false;
  base.mode = ['shadow', 'active'].includes(String(input.mode || '').toLowerCase())
    ? String(input.mode).toLowerCase()
    : 'shadow';
  base.serviceTier.allowed = allowed.length ? allowed : ['standard'];
  base.serviceTier.default = base.serviceTier.allowed.includes(normalizeServiceTier(tier.default))
    ? normalizeServiceTier(tier.default)
    : 'standard';
  base.serviceTier.autoPromoteUrgent = tier.autoPromoteUrgent === true;
  base.serviceTier.autoPromoteInteractive = tier.autoPromoteInteractive === true;
  base.serviceTier.ultrafastEnabled = tier.ultrafastEnabled === true;

  const pass = tier.providerPassthrough && typeof tier.providerPassthrough === 'object'
    ? tier.providerPassthrough
    : {};
  const field = String(pass.field || 'service_tier').trim();
  base.serviceTier.providerPassthrough = {
    enabled: pass.enabled === true,
    field: /^[A-Za-z0-9_.-]{1,64}$/.test(field) ? field : 'service_tier',
    mapping: {
      standard: String(pass.mapping?.standard || 'standard'),
      fast: String(pass.mapping?.fast || 'fast'),
      ultrafast: String(pass.mapping?.ultrafast || 'ultrafast')
    }
  };

  const persistent = capabilities.persistentAgent && typeof capabilities.persistentAgent === 'object'
    ? capabilities.persistentAgent
    : {};
  const identity = capabilities.externalIdentity && typeof capabilities.externalIdentity === 'object'
    ? capabilities.externalIdentity
    : {};
  const email = capabilities.emailAction && typeof capabilities.emailAction === 'object'
    ? capabilities.emailAction
    : {};

  base.agentCapabilities.persistentAgent = {
    enabled: persistent.enabled === true,
    role: String(persistent.role || 'router_only').slice(0, 80)
  };
  base.agentCapabilities.externalIdentity = {
    enabled: identity.enabled === true,
    type: String(identity.type || 'none').slice(0, 80),
    identifier: identity.identifier == null ? null : String(identity.identifier).slice(0, 320)
  };
  base.agentCapabilities.emailAction = {
    enabled: email.enabled === true,
    read: email.read === true,
    draft: email.draft === true,
    send: email.send === true,
    // External sending stays gated even if a future product exposes the action.
    requireApproval: email.requireApproval !== false
  };

  if (!base.agentCapabilities.emailAction.enabled) {
    base.agentCapabilities.emailAction.read = false;
    base.agentCapabilities.emailAction.draft = false;
    base.agentCapabilities.emailAction.send = false;
  }
  if (!base.agentCapabilities.externalIdentity.enabled) {
    base.agentCapabilities.externalIdentity.identifier = null;
  }

  return base;
}

function requestedTier(post = {}, task = {}) {
  return normalizeServiceTier(
    post.serviceTier
      || post.routing?.serviceTier
      || task.serviceTier
      || task.routing?.serviceTier,
    ''
  );
}

function looksUrgent(post = {}, task = {}) {
  if (post.urgent === true || task.urgent === true) return true;
  const text = [
    post.lane, post.title, post.prompt,
    task.lane, task.title, task.meta
  ].filter(Boolean).join(' ');
  return /(urgent|emergency|긴급|급행|즉시|오늘s*(?:마감|까지))/i.test(text);
}

function looksInteractive(post = {}, task = {}) {
  const lane = String(post.lane || task.lane || '').toLowerCase();
  return /(chat|reply|customer|soomgo|kmong|fiverr)/.test(lane);
}

function resolveServiceTier({ post = {}, task = {}, policy = {} } = {}) {
  const cfg = normalizeFutureRoutingPolicy(policy);
  if (!cfg.enabled) return 'standard';

  let tier = requestedTier(post, task) || cfg.serviceTier.default;

  if (cfg.serviceTier.autoPromoteUrgent && looksUrgent(post, task) && cfg.serviceTier.allowed.includes('fast')) {
    tier = 'fast';
  } else if (cfg.serviceTier.autoPromoteInteractive && looksInteractive(post, task) && cfg.serviceTier.allowed.includes('fast')) {
    tier = 'fast';
  }

  if (!cfg.serviceTier.allowed.includes(tier)) tier = cfg.serviceTier.default;
  if (tier === 'ultrafast' && !cfg.serviceTier.ultrafastEnabled) {
    tier = cfg.serviceTier.allowed.includes('fast') ? 'fast' : 'standard';
  }

  return tier;
}

function resolveRouteMetadata({ post = {}, task = {}, provider = '', policy = {} } = {}) {
  const cfg = normalizeFutureRoutingPolicy(policy);
  const serviceTier = resolveServiceTier({ post, task, policy: cfg });
  return {
    version: 1,
    mode: cfg.mode,
    serviceTier,
    requestedServiceTier: requestedTier(post, task) || null,
    urgent: looksUrgent(post, task),
    interactive: looksInteractive(post, task),
    provider: String(provider || ''),
    providerPassthroughEnabled: cfg.serviceTier.providerPassthrough.enabled === true,
    agentCapabilities: copy(cfg.agentCapabilities)
  };
}

function applyProviderTier(body, provider, routeMeta, policy = {}) {
  const next = { ...(body || {}) };
  const cfg = normalizeFutureRoutingPolicy(policy);
  if (!cfg.enabled || cfg.mode !== 'active') return next;
  if (String(provider) !== 'OpenAI') return next;
  if (!cfg.serviceTier.providerPassthrough.enabled) return next;

  const tier = normalizeServiceTier(routeMeta?.serviceTier, cfg.serviceTier.default);
  if (tier === 'ultrafast' && !cfg.serviceTier.ultrafastEnabled) return next;
  const mapped = cfg.serviceTier.providerPassthrough.mapping[tier];
  if (!mapped) return next;

  next[cfg.serviceTier.providerPassthrough.field] = mapped;
  return next;
}

module.exports = {
  SERVICE_TIERS,
  DEFAULT_FUTURE_ROUTING,
  normalizeServiceTier,
  normalizeFutureRoutingPolicy,
  resolveServiceTier,
  resolveRouteMetadata,
  applyProviderTier
};
