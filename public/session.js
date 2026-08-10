export const SESSION_KEY = 'zhenduan.session.v1';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function safeDialogue(dialogue) {
  if (!Array.isArray(dialogue)) return [];
  return dialogue.slice(-60).map((entry) => ({
    who: entry?.who === 'ai' ? 'ai' : 'owner',
    text: String(entry?.text || '').slice(0, 4000),
    ...(typeof entry?.reason === 'string' && entry.reason.trim()
      ? { reason: entry.reason.slice(0, 1000) }
      : {})
  })).filter((entry) => entry.text);
}

function safeFindings(findings) {
  if (!Array.isArray(findings)) return [];
  return cloneJson(findings.slice(-12), []);
}

function safeAnswers(answers) {
  if (!isPlainObject(answers)) return {};
  const result = {};
  for (const [key, value] of Object.entries(answers).slice(-40)) {
    if (typeof value === 'string') result[String(key).slice(0, 80)] = value.slice(0, 4000);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) result[String(key).slice(0, 80)] = value;
  }
  return result;
}

export function createSessionSnapshot(state, now = Date.now()) {
  const diagnosis = state?.diagnosis || {};
  return {
    version: 1,
    savedAt: now,
    turn: Number.isInteger(state?.turn) && state.turn >= 0 ? Math.min(state.turn, 999) : 0,
    diagnosis: {
      id: String(diagnosis.id || '').slice(0, 128),
      answers: safeAnswers(diagnosis.answers),
      findings: safeFindings(diagnosis.findings),
      dialogue: safeDialogue(diagnosis.dialogue)
    }
  };
}

export function restoreSessionSnapshot(value, now = Date.now()) {
  if (!isPlainObject(value) || value.version !== 1 || !Number.isFinite(value.savedAt)) return null;
  if (value.savedAt > now + 60_000 || now - value.savedAt > SESSION_TTL_MS) return null;
  if (!isPlainObject(value.diagnosis) || typeof value.diagnosis.id !== 'string' || !value.diagnosis.id) return null;
  return {
    version:1,
    savedAt:value.savedAt,
    turn:Number.isInteger(value.turn) && value.turn >= 0 ? Math.min(value.turn, 999) : 0,
    diagnosis:{
      id:value.diagnosis.id.slice(0, 128),
      answers:safeAnswers(value.diagnosis.answers),
      findings:safeFindings(value.diagnosis.findings),
      dialogue:safeDialogue(value.diagnosis.dialogue)
    }
  };
}
