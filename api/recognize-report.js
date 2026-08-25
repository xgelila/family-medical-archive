const MAX_BODY = 512 * 1024;
const DEFAULT_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const FIXED_AUTH_HEADER = 'Authorization';
const FIXED_AUTH_SCHEME = 'Bearer';
const FIXED_MODEL = 'deepseek-v4-flash';
// Keep this prompt in lockstep with api/recognize-service.ts and the shared
// structure schema: Vercel's CommonJS loader cannot import the TS source.
const SYSTEM_PROMPT = '从文字中识别出检查报告的所有信息和检查项目，生成结构化数据。只做结构整理，不做任何医学判断、不做单位换算、不做诊断或建议。只输出一个 JSON 对象，不要输出 Markdown 代码块或说明，不要新增或删除 key。固定 schema：{"report":{"reportKind":"","hospital":"","branch":"","reportNo":"","personName":"","gender":"","age":"","patientId":"","clinicalDiagnosis":"","testPurpose":"","reportDate":"","reportType":"","reportTypes":[],"title":"","sampleDate":"","receiveDate":"","printDate":"","senderDoctor":"","inspector":"","reviewer":""},"imaging":{"examPart":"","examMethod":"","findings":"","impression":"","measurements":"","exams":[{"examPart":"","examMethod":"","findings":"","impression":"","measurements":""}]},"items":[{"name":"","result":"","referenceRange":"","unit":"","method":"","sourceText":""}],"extraFields":[{"section":"header|footer|other","key":"","value":"","sourceText":""}],"notes":[{"text":"","sourceText":""}],"unresolvedText":""}。字段值逐字摘录；无法可靠归类时保留在 unresolvedText，不得猜测、改写、换算或丢弃。';

function endpoint(value) {
  const v = String(value || '').trim().replace(/\/+$/, '');
  return !v ? DEFAULT_ENDPOINT : /\/chat\/completions$/i.test(v) ? v : `${v}/chat/completions`;
}
function requestId(req) {
  const value = req.headers && (req.headers['x-vercel-id'] || req.headers['x-request-id']);
  return typeof value === 'string' ? value.slice(0, 80) : `recognize-${Date.now().toString(36)}`;
}
function keyFingerprint(key) {
  if (!key) return null;
  const crypto = require('node:crypto');
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
}
function responseError(res, status, message, code, id, stage, context) {
  const diagnostic = { errorCode: code, message, requestId: id, stage: stage || 'handler', upstreamAttempted: false, upstream: null, model: null, endpoint: null };
  const safeContext = context || {};
  if (safeContext.upstreamAttempted) {
    diagnostic.upstreamAttempted = true;
    diagnostic.upstream = { host: 'api.deepseek.com', authHeader: FIXED_AUTH_HEADER, scheme: FIXED_AUTH_SCHEME, keyPresent: Boolean(safeContext.key), keyFingerprint: keyFingerprint(safeContext.key) };
    diagnostic.model = FIXED_MODEL;
    diagnostic.endpoint = DEFAULT_ENDPOINT;
  }
  console.error(`[recognize-report] ${id} ${code} status=${status} upstreamAttempted=${Boolean(safeContext.upstreamAttempted)} keyPresent=${Boolean(safeContext.key)}${safeContext.key ? ` keyFingerprint=${keyFingerprint(safeContext.key)}` : ''}${safeContext.upstreamAttempted ? ` endpointHost=api.deepseek.com model=${FIXED_MODEL} authHeader=${FIXED_AUTH_HEADER} scheme=${FIXED_AUTH_SCHEME}` : ''}`);
  return res.status(status).json({ error: { ...diagnostic, status, code }, ...diagnostic });
}
function extractTextPart(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    return typeof part.text === 'string' ? part.text : typeof part.content === 'string' ? part.content : '';
  }).filter(Boolean).join('');
}

// DeepSeek-compatible responses may use string/parts content, reasoning_content,
// or tool-call arguments. Prefer the actual answer and never log its contents.
function extractModelContent(payload) {
  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const message = choice && choice.message;
  if (!message || typeof message !== 'object') return null;
  const content = extractTextPart(message.content);
  if (content.trim()) return content;
  const reasoning = extractTextPart(message.reasoning_content);
  if (reasoning.trim()) return reasoning;
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const call of calls) {
    const args = call && call.function && call.function.arguments;
    if (typeof args === 'string' && args.trim()) return args;
  }
  return null;
}

function errorMessage(status) {
  if (status === 401 || status === 403) return '服务端密钥被上游拒绝，请稍后重试。';
  if (status === 429) return '请求过于频繁，请稍后重试。';
  if (status === 504) return '识别服务响应超时，请稍后重试。';
  if (status === 502) return '识别服务暂时无法连接，请稍后重试。';
  return '识别服务暂时不可用，请稍后重试。';
}

// Deliberately dependency-free CommonJS entrypoint: Vercel can load this before
// any application or TypeScript module. Recognition logic remains isolated here.
module.exports = async function handler(req, res) {
  const id = requestId(req);
  try {
    if (req.method !== 'POST') return responseError(res, 405, '该接口仅支持 POST 请求。', 'METHOD_NOT_ALLOWED', id, 'method-check');
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body == null ? {} : req.body);
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY) return responseError(res, 413, '提交的内容过大，请裁剪图片后重试。', 'BODY_TOO_LARGE', id, 'request-parse');
    let body;
    try { body = JSON.parse(raw); } catch (_) { return responseError(res, 400, '提交内容格式不正确，请重新识别后重试。', 'INVALID_JSON', id, 'request-parse'); }
    if (!body || typeof body.text !== 'string' || !body.text.trim()) return responseError(res, 400, '提交内容格式不正确，请重新识别后重试。', 'INVALID_TEXT', id, 'request-parse');
    const key = String(process.env.DEEPSEEK_API_KEY || '').trim();
    if (!key) return responseError(res, 503, '识别功能尚未启用：请配置服务端 DEEPSEEK_API_KEY。', 'MISSING_API_KEY', id, 'configuration');
    // Production deliberately ignores legacy endpoint/model/auth overrides: the only
    // required deployment setting is DEEPSEEK_API_KEY.
    const model = FIXED_MODEL;
    const target = DEFAULT_ENDPOINT;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const upstream = await fetch(target, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', accept: 'application/json', [FIXED_AUTH_HEADER]: `${FIXED_AUTH_SCHEME} ${key}` }, body: JSON.stringify({ model, messages: [{ role: 'system', content: `${SYSTEM_PROMPT}\\n重点：识别${body.mode === 'report' ? '整张报告' : '检查项目'}。` }, { role: 'user', content: body.text }], temperature: 0, thinking: { type: 'disabled' } }) });
      if (!upstream.ok) return responseError(res, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, errorMessage(upstream.status), `UPSTREAM_HTTP_${upstream.status}`, id, 'upstream-request', { upstreamAttempted: true, key });
      const payload = await upstream.json();
      const content = extractModelContent(payload);
      return content ? res.status(200).json({ content }) : responseError(res, 502, '上游已响应但未返回可解析的识别内容，请重试。', 'UPSTREAM_INVALID_RESPONSE', id, 'response-parse', { upstreamAttempted: true, key });
    } catch (e) {
      return responseError(res, controller.signal.aborted ? 504 : 502, errorMessage(controller.signal.aborted ? 504 : 502), controller.signal.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_CONNECTION_ERROR', id, 'upstream-request', { upstreamAttempted: true, key });
    } finally { clearTimeout(timer); }
  } catch (e) { return responseError(res, 500, '识别接口初始化失败，请稍后重试。', 'HANDLER_EXCEPTION', id, 'initialization'); }
};
