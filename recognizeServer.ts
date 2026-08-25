import { isRecognizeMode, type RecognizeMode } from './src/shared/recognizeProtocol';
import { systemPromptForMode } from './src/shared/structurePrompt';

export const DEFAULT_RECOGNIZE_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const DEFAULT_RECOGNIZE_MODEL = 'deepseek-v4-flash';
export const DEFAULT_RECOGNIZE_AUTH_HEADER = 'Authorization';
export const DEFAULT_RECOGNIZE_AUTH_SCHEME = 'Bearer';

/** Accept either a complete OpenAI-compatible endpoint or its base URL. */
export function normalizeRecognizeEndpoint(value: string): string {
  const endpoint = value.trim().replace(/\/+$/, '');
  if (!endpoint) return DEFAULT_RECOGNIZE_ENDPOINT;
  if (/\/chat\/completions$/i.test(endpoint)) return endpoint;
  return `${endpoint}/chat/completions`;
}

function pick(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export interface RecognizeServiceConfig {
  apiKey: string;
  endpoint: string;
  model: string;
  authHeader: string;
  authValue: string;
}

/** Shared by the Vite Node proxy and the Vercel function. */
export function readRecognizeServiceConfig(
  env: Record<string, string | undefined>,
): RecognizeServiceConfig {
  const apiKey = pick(env, 'DEEPSEEK_API_KEY');
  const scheme =
    env.DEEPSEEK_AUTH_SCHEME === undefined
      ? DEFAULT_RECOGNIZE_AUTH_SCHEME
      : env.DEEPSEEK_AUTH_SCHEME.trim();
  return {
    apiKey,
    endpoint: normalizeRecognizeEndpoint(pick(env, 'DEEPSEEK_ENDPOINT')),
    model: pick(env, 'DEEPSEEK_MODEL') || DEFAULT_RECOGNIZE_MODEL,
    authHeader: pick(env, 'DEEPSEEK_AUTH_HEADER') || DEFAULT_RECOGNIZE_AUTH_HEADER,
    authValue: scheme ? `${scheme} ${apiKey}` : apiKey,
  };
}

export function buildRecognizePayload(model: string, text: string, mode?: unknown): string {
  const selectedMode: RecognizeMode = isRecognizeMode(mode) ? mode : 'items';
  return JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPromptForMode(selectedMode) },
      { role: 'user', content: text },
    ],
    temperature: 0,
    thinking: { type: 'disabled' },
  });
}

function extractTextPart(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    const record = part as Record<string, unknown>;
    return typeof record.text === 'string' ? record.text : typeof record.content === 'string' ? record.content : '';
  }).filter(Boolean).join('');
}

export function extractRecognizeContent(payload: unknown): string | null {
  const choices = (payload as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: Record<string, unknown> } | null)?.message;
  if (!message) return null;
  for (const value of [message.content, message.reasoning_content]) {
    const text = extractTextPart(value);
    if (text.trim()) return text;
  }
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const call of calls) {
    const args = (call as { function?: { arguments?: unknown } })?.function?.arguments;
    if (typeof args === 'string' && args.trim()) return args;
  }
  return null;
}

export function recognizeErrorMessage(status: number): string {
  switch (status) {
    case 401:
    case 403:
      return '识别服务校验未通过：请检查服务端 DEEPSEEK_API_KEY 配置后重试。';
    case 429:
      return '请求过于频繁，请稍后重试。';
    case 504:
      return '识别服务响应超时，请稍后重试。';
    case 502:
      return '识别服务暂时无法连接，请稍后重试。';
    default:
      return '识别服务暂时不可用，请稍后重试。';
  }
}
