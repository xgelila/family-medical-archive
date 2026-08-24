import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  buildRecognizePayload,
  extractRecognizeContent,
  readRecognizeServiceConfig,
  recognizeErrorMessage,
} from '../recognizeServer';

const MAX_BODY = 512 * 1024;

function requestId(req: VercelRequest): string {
  const value = req.headers['x-vercel-id'] || req.headers['x-request-id'];
  return typeof value === 'string' ? value.slice(0, 80) : `recognize-${Date.now().toString(36)}`;
}

function error(res: VercelResponse, status: number, message: string, code: string, id: string) {
  console.error(`[recognize-report] ${id} ${code} status=${status}`);
  return res.status(status).json({ error: { message, status, code } });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = requestId(req);
  if (req.method !== 'POST')
    return error(res, 405, '该接口仅支持 POST 请求。', 'METHOD_NOT_ALLOWED', id);
  const config = readRecognizeServiceConfig(process.env);
  if (!config.apiKey)
    return error(
      res,
      503,
      '识别功能尚未启用：请配置服务端 DEEPSEEK_API_KEY。',
      'MISSING_API_KEY',
      id,
    );
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY)
    return error(res, 413, '提交的内容过大，请裁剪图片后重试。', 'BODY_TOO_LARGE', id);
  let body: { text?: unknown; mode?: unknown };
  try {
    const parsed: unknown = JSON.parse(raw);
    body =
      parsed !== null && typeof parsed === 'object'
        ? (parsed as { text?: unknown; mode?: unknown })
        : {};
  } catch {
    return error(res, 400, '提交内容格式不正确，请重新识别后重试。', 'INVALID_JSON', id);
  }
  if (typeof body.text !== 'string' || !body.text.trim()) {
    return error(res, 400, '提交内容格式不正确，请重新识别后重试。', 'INVALID_TEXT', id);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const upstream = await fetch(config.endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        [config.authHeader]: config.authValue,
      },
      body: buildRecognizePayload(config.model, body.text, body.mode),
    });
    if (!upstream.ok) {
      const status = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502;
      return error(
        res,
        status,
        recognizeErrorMessage(status),
        `UPSTREAM_HTTP_${upstream.status}`,
        id,
      );
    }
    let payload: unknown;
    try {
      payload = await upstream.json();
    } catch {
      return error(res, 502, recognizeErrorMessage(502), 'UPSTREAM_INVALID_RESPONSE', id);
    }
    const content = extractRecognizeContent(payload);
    if (content === null)
      return error(res, 502, '识别结果整理失败，请重试。', 'UPSTREAM_INVALID_RESPONSE', id);
    return res.status(200).json({ content });
  } catch (e) {
    const timeout = controller.signal.aborted;
    const code = timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_CONNECTION_ERROR';
    console.error(`[recognize-report] ${id} ${code} ${e instanceof Error ? e.name : 'unknown'}`);
    return error(res, timeout ? 504 : 502, recognizeErrorMessage(timeout ? 504 : 502), code, id);
  } finally {
    clearTimeout(timer);
  }
}
