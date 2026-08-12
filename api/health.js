import { runtimeConfig } from '../src/config/runtime.js';

export async function handleHealthRequest(req, res, deps = {}) {
  res.setHeader?.('Cache-Control', 'no-store');
  if (req.method && req.method !== 'GET') {
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }
  const config = runtimeConfig(deps.env || process.env);
  return res.status(config.ok ? 200 : 503).json(config);
}

export default async function handler(req, res) {
  return handleHealthRequest(req, res);
}
