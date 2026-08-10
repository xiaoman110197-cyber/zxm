import { defaultImageOcr } from '../src/documents/ocr.js';

const PNG_BASE64 = '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';
const SELF_TEST_TIMEOUT_MS = 15000;

function safeStatus(value) {
  return String(value || '').replace(/[^a-z0-9 _-]/gi, '').slice(0, 80);
}

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') return res.status(405).json({ ok:false, error:'Method not allowed' });

  const startedAt = Date.now();
  const events = [];
  let lastEvent = null;
  const onProgress = (message = {}) => {
    const event = {
      status:safeStatus(message.status),
      progress:Number.isFinite(message.progress) ? Math.max(0, Math.min(1, message.progress)) : null,
      elapsedMs:Date.now() - startedAt
    };
    lastEvent = event;
    if (events.length < 20) events.push(event);
  };

  const ocrPromise = defaultImageOcr(Buffer.from(PNG_BASE64, 'base64'), onProgress)
    .then((result) => ({ kind:'result', confidence:result.confidence, textLength:result.text.length, hasExpectedNumber:/88/.test(result.text) }))
    .catch((error) => ({ kind:'error', errorName:String(error?.name || 'Error') }));

  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => resolve({ kind:'timeout' }), SELF_TEST_TIMEOUT_MS);
  });

  const outcome = await Promise.race([ocrPromise, timeoutPromise]);
  const payload = {
    ok:outcome.kind === 'result',
    outcome:outcome.kind,
    elapsedMs:Date.now() - startedAt,
    lastEvent,
    events,
    ...(outcome.kind === 'result' ? { confidence:outcome.confidence, textLength:outcome.textLength, hasExpectedNumber:outcome.hasExpectedNumber } : {}),
    ...(outcome.kind === 'error' ? { errorName:outcome.errorName } : {})
  };

  return res.status(outcome.kind === 'timeout' ? 504 : outcome.kind === 'error' ? 500 : 200).json(payload);
}
