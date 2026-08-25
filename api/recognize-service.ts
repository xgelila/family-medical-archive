// Vercel-only dependency-free service contract. Keep this module free of Vite,
// browser, and application imports so esbuild can load the function reliably.
export const DEFAULT_RECOGNIZE_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const DEFAULT_RECOGNIZE_MODEL = 'deepseek-v4-flash';

const REPORT_KEYS = ['reportKind','hospital','branch','reportNo','personName','gender','age','patientId','clinicalDiagnosis','testPurpose','reportDate','reportType','reportTypes','title','sampleDate','receiveDate','printDate','senderDoctor','inspector','reviewer'];
const ITEM_KEYS = ['name','result','referenceRange','unit','method','sourceText'];

// Deliberately plain text: no imports from src/shared or any browser/Vite module.
const systemPrompt = `从文字中识别检查报告并只输出 JSON，不要输出 Markdown 或说明。只做结构整理，不做医学判断、单位换算、诊断或建议。固定 schema：{"report":{${REPORT_KEYS.map((key) => `"${key}":""`).join(',')}},"imaging":{"examPart":"","examMethod":"","findings":"","impression":"","measurements":"","exams":[]},"items":[{${ITEM_KEYS.map((key) => `"${key}":""`).join(',')}}],"extraFields":[],"notes":[],"unresolvedText":""}。原文无法可靠归类时保留在 unresolvedText；字段值逐字摘录，不得猜测或改写。`;

function pick(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeRecognizeEndpoint(value: string): string {
  const endpoint = value.trim().replace(/\/+$/, '');
  if (!endpoint) return DEFAULT_RECOGNIZE_ENDPOINT;
  return /\/chat\/completions$/i.test(endpoint) ? endpoint : `${endpoint}/chat/completions`;
}

export function readRecognizeServiceConfig(env: Record<string, string | undefined>) {
  const apiKey = pick(env, 'DEEPSEEK_API_KEY');
  const scheme = env.DEEPSEEK_AUTH_SCHEME === undefined ? 'Bearer' : env.DEEPSEEK_AUTH_SCHEME.trim();
  return {
    apiKey,
    endpoint: normalizeRecognizeEndpoint(pick(env, 'DEEPSEEK_ENDPOINT')),
    model: pick(env, 'DEEPSEEK_MODEL') || DEFAULT_RECOGNIZE_MODEL,
    authHeader: pick(env, 'DEEPSEEK_AUTH_HEADER') || 'Authorization',
    authValue: scheme ? `${scheme} ${apiKey}` : apiKey,
  };
}

export function buildRecognizePayload(model: string, text: string, mode?: unknown): string {
  const modeHint = mode === 'report' ? '整张报告' : '检查项目';
  return JSON.stringify({
    model,
    messages: [{ role: 'system', content: `${systemPrompt}\n重点：识别${modeHint}。` }, { role: 'user', content: text }],
    temperature: 0,
    thinking: { type: 'disabled' },
  });
}

export function extractRecognizeContent(payload: unknown): string | null {
  const choices = (payload as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = (choices[0] as { message?: { content?: unknown } } | null)?.message?.content;
  return typeof content === 'string' && content !== '' ? content : null;
}

export function recognizeErrorMessage(status: number): string {
  if (status === 401 || status === 403) return '识别服务校验未通过：请检查服务端 DEEPSEEK_API_KEY 配置后重试。';
  if (status === 429) return '请求过于频繁，请稍后重试。';
  if (status === 504) return '识别服务响应超时，请稍后重试。';
  if (status === 502) return '识别服务暂时无法连接，请稍后重试。';
  return '识别服务暂时不可用，请稍后重试。';
}
