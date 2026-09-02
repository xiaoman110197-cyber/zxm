import { randomUUID } from 'node:crypto';
import { createDeepSeekProvider } from '../src/ai/providers.js';
import { normalizeConsultationInput, sanitizeConsultationAnalysis } from '../src/experience/consultation.js';
import { CHANNEL_CAPABILITIES } from '../src/experience/connectors.js';

function runtimeProvider(deps={}) {
  if (deps.provider?.analyzeExperienceConsultation) return deps.provider;
  const apiKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
  if (!apiKey) return null;
  return createDeepSeekProvider({ apiKey, timeoutMs:12000, maxOutputTokens:1600 });
}

export async function handleExperienceConsultationRequest(req, res, deps={}) {
  const requestId = deps.requestId || randomUUID();
  if (req.method !== 'POST') return res.status(405).json({ error:'只支持 POST', requestId });

  let input;
  try {
    input = normalizeConsultationInput(req.body || {});
  } catch (error) {
    return res.status(400).json({ error:error?.message || '客户咨询输入无效', requestId });
  }

  const provider = runtimeProvider(deps);
  if (!provider) return res.status(503).json({ error:'AI咨询分析暂不可用，请稍后重试。', requestId });

  try {
    const raw = await provider.analyzeExperienceConsultation(input);
    const analysis = sanitizeConsultationAnalysis(raw, input);
    const capability = CHANNEL_CAPABILITIES[input.channel];
    return res.status(200).json({
      requestId,
      modelUsed:true,
      provider:'DeepSeek',
      model:provider.model || provider.name || 'AI',
      analysis,
      connector:{
        channel:input.channel,
        enabled:capability.enabled,
        canSendExternally:capability.canSendExternally
      }
    });
  } catch {
    return res.status(503).json({ error:'AI咨询分析暂不可用，请稍后重试。', requestId });
  }
}

export default async function handler(req, res) {
  return handleExperienceConsultationRequest(req, res);
}
