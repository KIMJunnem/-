'use strict';

function chooseExecution(input = {}) {
  const flags = new Set((input.flags || []).map(String));
  const budgetRemaining = Number(input.budgetRemainingUsd);
  const localCapable = input.localCapable === true;
  const cacheHit = input.cacheHit === true;
  const playbookCapable = input.playbookCapable === true && input.ruleConfidence >= 0.98;
  const studentLevel = Number(input.studentLevel || 0);
  const confidence = Number(input.confidence);
  const escalation = input.escalation === true;

  if (localCapable) return { mode:'local', reason:'local_tool_available', role:'local_tool' };
  if (cacheHit) return { mode:'cache', reason:'identical_context_cache', role:null };
  if (!escalation && playbookCapable) return { mode:'rule', reason:'validated_playbook_rule', role:null };
  if (!escalation && studentLevel >= 4 && confidence >= 0.95) return { mode:'student', reason:'promoted_student_default', role:input.studentRole };
  if (!escalation && studentLevel >= 2 && confidence >= 0.90) return { mode:'student_with_sampling', reason:'promoted_student_supervised', role:input.studentRole };
  if (Number.isFinite(budgetRemaining) && budgetRemaining <= 0) return { mode:'blocked', reason:'job_budget_exhausted', role:null };
  return { mode:'teacher', reason:escalation?'teacher_escalation':'teacher_baseline', role:input.teacherRole };
}

module.exports={chooseExecution};
