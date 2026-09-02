const key = String(process.env.DEEPSEEK_API_KEY || '').trim();
if (!key) {
  console.error('LIVE_SELF_TEST: DEEPSEEK_API_KEY_MISSING');
  process.exit(42);
}
console.log(`LIVE_SELF_TEST: DEEPSEEK_API_KEY_PRESENT length=${key.length}`);
