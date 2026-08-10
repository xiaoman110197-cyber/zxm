const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function decodeBase64Strict(value) {
  if (typeof value !== 'string' || !value.length) throw new TypeError('Base64 内容为空或格式错误');
  const normalized = value.replace(/\s+/g, '');
  if (!normalized.length || !CANONICAL_BASE64.test(normalized)) throw new TypeError('Base64 编码格式错误');
  const buffer = Buffer.from(normalized, 'base64');
  if (!buffer.length) throw new TypeError('Base64 内容为空或格式错误');
  if (buffer.toString('base64') !== normalized) throw new TypeError('Base64 编码格式错误');
  return buffer;
}
