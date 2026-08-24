import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isRecognizeMode, type RecognizeMode } from '../src/shared/recognizeProtocol';
import { systemPromptForMode } from '../src/shared/structurePrompt';

const MAX_BODY = 512 * 1024;
const endpoint = process.env.DEEPSEEK_ENDPOINT || 'https://api.deepseek.com/chat/completions';
const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const key = process.env.DEEPSEEK_API_KEY?.trim() || '';
const authHeader = process.env.DEEPSEEK_AUTH_HEADER?.trim() || 'Authorization';
const authScheme = process.env.DEEPSEEK_AUTH_SCHEME ?? 'Bearer';

// Keep diagnostics useful in Vercel logs while never logging keys, prompts, or upstream bodies.
function requestId(req: VercelRequest): string {
  const value = req.headers['x-vercel-id'] || req.headers['x-request-id'];
  return typeof value === 'string' ? value.slice(0, 80) : `recognize-${Date.now().toString(36)}`;
}

function error(res: VercelResponse, status: number, message: string, code: string, id?: string) {
  if (id) console.error(`[recognize-report] ${id} ${code} status=${status}`);
  return res.status(status).json({ error: { message, status, code } });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = requestId(req);
  if (req.method !== 'POST') return error(res, 405, '该接口仅支持 POST 请求。', 'METHOD_NOT_ALLOWED', id);
  if (!key) return error(res, 503, '识别功能尚未启用：请配置服务端 DEEPSEEK_API_KEY。', 'MISSING_API_KEY', id);
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY) return error(res, 413, '提交内容过大。', 'BODY_TOO_LARGE', id);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return error(res, 400, '提交内容格式不正确。', 'INVALID_JSON', id); }
  const requestBody = body as { text?: unknown; mode?: unknown } | null;
  const text = requestBody && typeof requestBody.text === 'string' ? requestBody.text : '';
  if (!text.trim()) return error(res, 400, '提交内容格式不正确。', 'INVALID_TEXT', id);
  const mode: RecognizeMode = isRecognizeMode(requestBody?.mode) ? requestBody.mode : 'items';
  // Keep the Vercel deployment on the exact same shared protocol as the local Vite proxy.
  const systemPrompt = systemPromptForMode(mode);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
  try {
    const upstream = await fetch(endpoint, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json', [authHeader]: authScheme.trim() ? `${authScheme.trim()} ${key}` : key },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }], temperature: 0, thinking: { type: 'disabled' } }),
    });
    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : 502;
      return error(res, status, upstream.status === 429 ? '请求过于频繁，请稍后重试。' : '识别服务暂时不可用，请稍后重试。', `UPSTREAM_HTTP_${upstream.status}`, id);
    }
    const json = await upstream.json() as { choices?: Array<{message?: {content?: unknown}}> };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content) return error(res, 502, '识别结果整理失败，请重试。', 'UPSTREAM_INVALID_RESPONSE', id);
    return res.status(200).json({ content });
  } catch (e) {
    const timeout = controller.signal.aborted;
    const code = timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_CONNECTION_ERROR';
    console.error(`[recognize-report] ${id} ${code} ${e instanceof Error ? e.name : 'unknown'}`);
    return error(res, timeout ? 504 : 502, timeout ? '识别服务响应超时，请稍后重试。' : '识别服务暂时无法连接，请稍后重试。', code);
  } finally { clearTimeout(timer); }
}
