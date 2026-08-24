import type { VercelRequest, VercelResponse } from '@vercel/node';
const MAX_BODY = 512 * 1024;

function requestId(req: VercelRequest): string {
  const value = req.headers['x-vercel-id'] || req.headers['x-request-id'];
  return typeof value === 'string' ? value.slice(0, 80) : `recognize-${Date.now().toString(36)}`;
}

type Diagnostic = {
  errorCode: string;
  message: string;
  requestId: string;
  stage: string;
  upstreamAttempted: boolean;
  upstream: string | null;
  model: string | null;
  endpoint: string | null;
  cause?: string;
};

function safeCause(value: unknown): string {
  // Error messages from fetch/runtime are useful for diagnosis, but must never
  // echo authorization material or an arbitrary response body.
  const raw = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  return raw
    .replace(/bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/(?:api[_-]?key|token|secret)[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 240);
}

function error(
  res: VercelResponse,
  status: number,
  message: string,
  code: string,
  id: string,
  context: Partial<Omit<Diagnostic, 'errorCode' | 'message' | 'requestId'>> = {},
  cause?: unknown,
) {
  const diagnostic: Diagnostic = {
    errorCode: code,
    message,
    requestId: id,
    stage: context.stage ?? 'handler',
    upstreamAttempted: context.upstreamAttempted ?? false,
    upstream: context.upstream ?? null,
    model: context.model ?? null,
    endpoint: context.endpoint ?? null,
    ...(cause !== undefined ? { cause: safeCause(cause) } : {}),
  };
  console.error(`[recognize-report] ${id} ${code} status=${status}`);
  return res
    .status(status)
    .json({ error: { message, status, code, ...diagnostic }, ...diagnostic });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Keep this guard around every initialization and request operation. A Vercel
  // function must return JSON even when a platform/runtime API throws.
  let id = 'recognize-unknown';
  let context: Partial<Omit<Diagnostic, 'errorCode' | 'message' | 'requestId'>> = {
    stage: 'initialization',
  };
  try {
    id = requestId(req);
    // Load shared server logic inside the guarded path so module-resolution or
    // runtime initialization failures become structured JSON diagnostics.
    // Shared implementation: from '../recognizeServer'
    const {
      buildRecognizePayload,
      extractRecognizeContent,
      readRecognizeServiceConfig,
      recognizeErrorMessage,
    } = await import('../recognizeServer');
    if (req.method !== 'POST')
      return error(res, 405, '该接口仅支持 POST 请求。', 'METHOD_NOT_ALLOWED', id, {
        stage: 'method-check',
      });
    const config = readRecognizeServiceConfig(process.env);
    context = {
      stage: 'configuration',
      upstream: 'deepseek',
      model: config.model,
      endpoint: config.endpoint,
    };
    if (!config.apiKey)
      return error(
        res,
        503,
        '识别功能尚未启用：请配置服务端 DEEPSEEK_API_KEY。',
        'MISSING_API_KEY',
        id,
        context,
      );
    context = { ...context, stage: 'request-parse' };
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY)
      return error(res, 413, '提交的内容过大，请裁剪图片后重试。', 'BODY_TOO_LARGE', id, context);
    let body: { text?: unknown; mode?: unknown };
    try {
      const parsed: unknown = JSON.parse(raw);
      body =
        parsed !== null && typeof parsed === 'object'
          ? (parsed as { text?: unknown; mode?: unknown })
          : {};
    } catch (e) {
      return error(
        res,
        400,
        '提交内容格式不正确，请重新识别后重试。',
        'INVALID_JSON',
        id,
        context,
        e,
      );
    }
    if (typeof body.text !== 'string' || !body.text.trim())
      return error(res, 400, '提交内容格式不正确，请重新识别后重试。', 'INVALID_TEXT', id, context);
    context = { ...context, stage: 'upstream-request' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      context = { ...context, upstreamAttempted: true };
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
          context,
        );
      }
      let payload: unknown;
      try {
        payload = await upstream.json();
      } catch (e) {
        return error(
          res,
          502,
          recognizeErrorMessage(502),
          'UPSTREAM_INVALID_RESPONSE',
          id,
          { ...context, stage: 'upstream-response' },
          e,
        );
      }
      const content = extractRecognizeContent(payload);
      if (content === null)
        return error(res, 502, '识别结果整理失败，请重试。', 'UPSTREAM_INVALID_RESPONSE', id, {
          ...context,
          stage: 'response-parse',
        });
      return res.status(200).json({ content });
    } catch (e) {
      const timeout = controller.signal.aborted;
      const code = timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_CONNECTION_ERROR';
      return error(
        res,
        timeout ? 504 : 502,
        recognizeErrorMessage(timeout ? 504 : 502),
        code,
        id,
        context,
        e,
      );
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return error(res, 500, '识别接口初始化失败，请稍后重试。', 'HANDLER_EXCEPTION', id, context, e);
  }
}
