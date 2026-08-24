import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isRecognizeMode, type RecognizeMode } from '../src/shared/recognizeProtocol';
import { systemPromptForMode } from '../src/shared/structurePrompt';

const MAX_BODY = 512 * 1024;
const endpoint = process.env.DEEPSEEK_ENDPOINT || 'https://api.deepseek.com/chat/completions';
const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const key = process.env.DEEPSEEK_API_KEY || '';

function error(res: VercelResponse, status: number, message: string) {
  return res.status(status).json({ error: { message, status } });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return error(res, 405, '该接口仅支持 POST 请求。');
  if (!key) return error(res, 503, '识别功能尚未启用：请配置服务端 DEEPSEEK_API_KEY。');
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY) return error(res, 413, '提交内容过大。');
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return error(res, 400, '提交内容格式不正确。'); }
  const requestBody = body as { text?: unknown; mode?: unknown } | null;
  const text = requestBody && typeof requestBody.text === 'string' ? requestBody.text : '';
  if (!text.trim()) return error(res, 400, '提交内容格式不正确。');
  const mode: RecognizeMode = isRecognizeMode(requestBody?.mode) ? requestBody.mode : 'items';
  // Keep the Vercel deployment on the exact same shared protocol as the local Vite proxy.
  const systemPrompt = systemPromptForMode(mode);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
  try {
    const upstream = await fetch(endpoint, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }], temperature: 0, thinking: { type: 'disabled' } }),
    });
    if (!upstream.ok) return error(res, upstream.status === 429 ? 429 : 502, upstream.status === 429 ? '请求过于频繁，请稍后重试。' : '识别服务暂时不可用，请稍后重试。');
    const json = await upstream.json() as { choices?: Array<{message?: {content?: unknown}}> };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content) return error(res, 502, '识别结果整理失败，请重试。');
    return res.status(200).json({ content });
  } catch (e) {
    return error(res, controller.signal.aborted ? 504 : 502, controller.signal.aborted ? '识别服务响应超时，请稍后重试。' : '识别服务暂时无法连接，请稍后重试。');
  } finally { clearTimeout(timer); }
}
