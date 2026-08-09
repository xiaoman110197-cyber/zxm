function requireEvidence(input) {
  if (!Array.isArray(input?.evidence) || input.evidence.length === 0) {
    throw new TypeError('finding requires evidence');
  }
  if (!input.action) throw new TypeError('finding requires action');
  if (!input.metric) throw new TypeError('finding requires metric');
}

function deriveStatus(input) {
  const directDeterministic = input.evidence.some(
    e => e?.strength === 'direct' && e?.deterministic === true
  );
  const strongCount = input.evidence.filter(
    e => e?.strength === 'strong' || e?.strength === 'direct'
  ).length;

  if (directDeterministic && !input.unresolvedDefinition) return 'confirmed';
  if (strongCount >= 2) return 'probable';
  return 'hypothesis';
}

function deriveConfidence(status, input) {
  if (status === 'confirmed') return 0.95;
  if (status === 'probable') return input.unresolvedDefinition ? 0.78 : 0.84;
  return 0.45;
}

function derivePriority(status, input) {
  const severeDeterministicRisk =
    status === 'confirmed' &&
    input.impact === 'high' &&
    (input.kind === 'data_error' || input.kind === 'financial_risk');

  if (severeDeterministicRisk) return 'P0';
  if (input.kind === 'optimization') return input.impact === 'high' ? 'P1' : 'P2';
  if (status === 'probable' && input.impact === 'high') return 'P1';
  if (status === 'confirmed' && input.impact === 'high') return 'P1';
  return 'P2';
}

export function classifyFinding(input) {
  requireEvidence(input);
  const status = deriveStatus(input);
  return {
    ...input,
    status,
    priority: derivePriority(status, input),
    confidence: deriveConfidence(status, input)
  };
}
