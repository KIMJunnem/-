'use strict';

const SERVICE_TIERS = Object.freeze(['standard', 'fast', 'ultrafast']);
const MODEL_CLASSES = Object.freeze(['cheap', 'mid', 'top']);

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
    requireApproval: true
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
  return /(urgent|emergency|긴급|급행|즉시|오늘\s*(?:마감|까지))/i.test(text);
}

function looksInteractive(post = {}, task = {}) {
  const lane = String(post.lane || task.lane || '').toLowerCase();
  return /(chat|reply|customer|soomgo|kmong|fiverr)/.test(lane);
}

function estimateComplexity(post = {}, task = {}) {
  const reasons = [];
  let score = 0;
  const text = [post.prompt, post.title, post.meta, task.title, task.meta].filter(Boolean).join('\n');
  const length = text.length;
  if (length >= 12000) { score += 35; reasons.push('long_context_12k'); }
  else if (length >= 4000) { score += 20; reasons.push('long_context_4k'); }
  if (Array.isArray(post.attachments) && post.attachments.length) { score += 15; reasons.push('attachments'); }
  if (looksUrgent(post, task)) { score += 10; reasons.push('urgent'); }
  const lane = String(post.lane || task.lane || '').toLowerCase();
  if (/fulfillment|production|final|security|payment|delivery/.test(lane) || post.astraFinalReview === true || post.astraProduction === true) {
    score += 25; reasons.push('high_risk_lane');
  }
  if (String(post.mode || '').toLowerCase() === 'implement') { score += 15; reasons.push('implementation'); }
  if (Number(post.retryCount || 0) > 0 || /실행 실패|결과 확인 필요|uncertain|failed/i.test(String(post.status || ''))) {
    score += 15; reasons.push('prior_failure');
  }
  if (/(모호|애매|판단|예외|충돌|원인|복합|다중|unknown|ambiguous|edge case)/i.test(text)) {
    score += 10; reasons.push('ambiguity');
  }
  const bounded = Math.max(0, Math.min(100, score));
  const recommendedModelClass = bounded >= 70 ? 'top' : bounded >= 35 ? 'mid' : 'cheap';
  return { score: bounded, recommendedModelClass, reasons };
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
  const complexity = estimateComplexity(post, task);
  return {
    version: 1,
    mode: cfg.mode,
    serviceTier,
    requestedServiceTier: requestedTier(post, task) || null,
    urgent: looksUrgent(post, task),
    interactive: looksInteractive(post, task),
    provider: String(provider || ''),
    complexityScore: complexity.score,
    recommendedModelClass: complexity.recommendedModelClass,
    complexityReasons: complexity.reasons,
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
  MODEL_CLASSES,
  DEFAULT_FUTURE_ROUTING,
  normalizeServiceTier,
  normalizeFutureRoutingPolicy,
  estimateComplexity,
  resolveServiceTier,
  resolveRouteMetadata,
  applyProviderTier
};
