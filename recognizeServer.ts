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

export function extractRecognizeContent(payload: unknown): string | null {
  const choices = (payload as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = (choices[0] as { message?: { content?: unknown } } | null)?.message?.content;
  return typeof content === 'string' && content !== '' ? content : null;
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
