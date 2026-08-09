import { randomUUID } from 'node:crypto';

const STATUSES = new Set(['confirmed','probable','hypothesis']);
const PRIORITIES = new Set(['P0','P1','P2']);

export function createDiagnosis(seed = {}) {
  return {
    id: seed.id || randomUUID(),
    answers: seed.answers || {},
    documents: Array.isArray(seed.documents) ? [...seed.documents] : [],
    evidence: Array.isArray(seed.evidence) ? [...seed.evidence] : [],
    findings: Array.isArray(seed.findings) ? [...seed.findings] : []
  };
}

export function addEvidence(diagnosis, evidence) {
  if (!diagnosis || !evidence || !evidence.source || evidence.value === undefined) {
    throw new TypeError('evidence requires source and value');
  }
  diagnosis.evidence.push({ id: evidence.id || randomUUID(), ...evidence });
  return diagnosis;
}

export function addFinding(diagnosis, finding) {
  const required = ['status','priority','evidence','confidence','action','metric'];
  for (const key of required) {
    if (finding?.[key] === undefined || finding[key] === null || finding[key] === '') {
      throw new TypeError(`finding requires ${key}`);
    }
  }
  if (!STATUSES.has(finding.status)) throw new TypeError('invalid finding status');
  if (!PRIORITIES.has(finding.priority)) throw new TypeError('invalid finding priority');
  if (!Array.isArray(finding.evidence) || finding.evidence.length === 0) {
    throw new TypeError('finding requires evidence');
  }
  if (typeof finding.confidence !== 'number' || finding.confidence < 0 || finding.confidence > 1) {
    throw new TypeError('confidence must be between 0 and 1');
  }
  diagnosis.findings.push({ id: finding.id || randomUUID(), ...finding });
  return diagnosis;
}
