/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { systemPromptForMode } from './src/shared/structurePrompt';
import { isRecognizeMode, type RecognizeMode } from './src/shared/recognizeProtocol';
import {
  DEFAULT_RECOGNIZE_AUTH_HEADER,
  DEFAULT_RECOGNIZE_AUTH_SCHEME,
  DEFAULT_RECOGNIZE_ENDPOINT,
  DEFAULT_RECOGNIZE_MODEL,
  normalizeRecognizeEndpoint,
} from './recognizeServer';
import {
  announceMockEnabled,
  buildMockRecognizeContent,
  isMockRecognitionEnabled,
  MOCK_DEV_MODE,
  mockDelayMs,
} from './src/shared/mockRecognition';

/**
 * 「识别数据」同源中间件（仅本机开发）。
 *
 * 设计（安全边界）：
 * - 浏览器只请求同源 POST /api/recognize-report，**不直连第三方服务**、不持有 Key；
 * - endpoint / model / 鉴权 Header / Scheme / API Key 全部在 **Vite Node 侧**读取
 *   （主上游为直连 DeepSeek 的 DEEPSEEK_* 变量；备上游为 OpenCode Go 的 OPENCODE_GO_*，
 *   兼容旧 VITE_OPENCODE_GO_*；绝不注入客户端）；
 * - 中间件只精确拦截 pathname 为 /api/recognize-report 的请求，其它路径直接放行；
 *   仅接受 POST；content-length 与实际读取均限制 ≤512KB；请求体必须是含非空 text 的 JSON；
 * - 用 Node 原生 fetch 转发到完整上游 endpoint（60s AbortController 超时），
 *   不依赖任何第三方转发库或 vite 自带的代理配置；
 * - **双上游 fallback**：优先直连 DeepSeek；仅当其返回 429/402 或响应体出现明显额度/配额
 *   关键词（额度不足/quota exhausted 等）时，自动切到 OpenCode Go 备上游；其它错误
 *   （401/403/500/502/504/网络/超时）不切换，仍按原清洗逻辑返回；未配置 OPENCODE_GO_API_KEY
 *   则不启用 fallback；
 * - 请求正文与上游响应绝不落日志、不打印；上游 401/403/429/超时/网络/非 2xx 一律
 *   清洗为通用中文 JSON 返回；2xx 只读取 JSON 并把 choices[0].message.content 单独
 *   转成 { content } 返回，不透传 model/usage 等无关字段；
 * - 该中间件随 Vite dev server 运行，**不适用于 preview / 静态部署**
 *   （生产部署需要后端网关，见 README）。
 */

const PROXY_CONTEXT = '/api/recognize-report';
const UPSTREAM_DEFAULT_ENDPOINT = 'https://opencode.ai/zen/go/v1/chat/completions';
const UPSTREAM_DEFAULT_MODEL = 'deepseek-v4-flash';
const UPSTREAM_DEFAULT_AUTH_HEADER = 'Authorization';
const UPSTREAM_DEFAULT_AUTH_SCHEME = 'Bearer';
/** 主上游：直连 DeepSeek（独立配置） */
const DEEPSEEK_DEFAULT_ENDPOINT = DEFAULT_RECOGNIZE_ENDPOINT;
const DEEPSEEK_DEFAULT_MODEL = DEFAULT_RECOGNIZE_MODEL;
/** 用于判定「OpenCode Go 明显额度/配额耗尽」的关键词（仅在非 2xx 响应体内查找，不落日志） */
const QUOTA_KEYWORDS = [
  'quota',
  'exhausted',
  'insufficient',
  'credit',
  'balance',
  '额度',
  '配额',
  '余额',
  '超限',
];
/** 客户端提交的最大体积（字节） */
const MAX_REQUEST_BODY_BYTES = 512 * 1024;
/** 整体请求硬封顶（毫秒）：无论主/备上游如何编排，总请求都不超过该值 */
const REQUEST_TIMEOUT_MS = 60_000;
/** 主上游（直连 DeepSeek）独立超时预算（毫秒）——默认 25s */
const DEEPSEEK_TIMEOUT_MS = 25_000;
/** 备上游（OpenCode Go）独立超时预算（毫秒）——默认 20s */
const OPENCODE_GO_TIMEOUT_MS = 20_000;

/** 从服务端 env 解析正整数超时（毫秒）；缺失/非法/非正数时回退到给定默认值。 */
function parseTimeoutMs(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  return fallback;
}

/**
 * 读取主/备上游各自的超时预算（毫秒）。仅服务端 Node 侧读取非 VITE env
 * （DEEPSEEK_TIMEOUT_MS / OPENCODE_GO_TIMEOUT_MS），不注入客户端；
 * 主上游为直连 DeepSeek、备上游为 OpenCode Go（顺序见 defineConfig），
 * 未配置时自动回退默认值（25s / 20s），用户无需配置即可正常工作。
 */
export function readUpstreamTimeouts(env: Record<string, string>): UpstreamTimeoutBudget {
  return {
    primaryTimeoutMs: parseTimeoutMs(env.DEEPSEEK_TIMEOUT_MS, DEEPSEEK_TIMEOUT_MS),
    fallbackTimeoutMs: parseTimeoutMs(env.OPENCODE_GO_TIMEOUT_MS, OPENCODE_GO_TIMEOUT_MS),
  };
}

function pick(env: Record<string, string>, names: string[]): string {
  for (const name of names) {
    const v = env[name];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return '';
}

/** 上游标签（用于安全 debug 时间线 / 选中上游标识）。 */
export type UpstreamName = 'opencode-go' | 'deepseek';

export interface RecognizeServerConfig {
  /** 上游标签（安全 debug 用）；缺省时编排层按 primary=opencode-go、fallback=deepseek 回退。 */
  name?: UpstreamName;
  apiKey: string;
  endpoint: string;
  model: string;
  authHeader: string;
  authValue: string;
}

/** 主/备上游各自的超时预算（毫秒）。 */
export interface UpstreamTimeoutBudget {
  primaryTimeoutMs: number;
  fallbackTimeoutMs: number;
}

/**
 * Node 侧读取结构化服务配置：
 * - 优先 OPENCODE_GO_*（新变量）；VITE_OPENCODE_GO_* 仅作兼容回退，不注入客户端；
 * - scheme 显式留空 = 无 scheme（请求头值仅为 Key）；完全未设置 = 默认 Bearer。
 */
export function readServerConfig(env: Record<string, string>): RecognizeServerConfig {
  const apiKey = pick(env, ['OPENCODE_GO_API_KEY', 'VITE_OPENCODE_GO_API_KEY']);
  const endpoint =
    pick(env, ['OPENCODE_GO_ENDPOINT', 'VITE_OPENCODE_GO_ENDPOINT']) || UPSTREAM_DEFAULT_ENDPOINT;
  const model =
    pick(env, ['OPENCODE_GO_MODEL', 'VITE_OPENCODE_GO_MODEL']) || UPSTREAM_DEFAULT_MODEL;
  const authHeader =
    pick(env, ['OPENCODE_GO_AUTH_HEADER', 'VITE_OPENCODE_GO_AUTH_HEADER']) ||
    UPSTREAM_DEFAULT_AUTH_HEADER;
  const scheme =
    env.OPENCODE_GO_AUTH_SCHEME !== undefined
      ? env.OPENCODE_GO_AUTH_SCHEME
      : env.VITE_OPENCODE_GO_AUTH_SCHEME !== undefined
        ? env.VITE_OPENCODE_GO_AUTH_SCHEME
        : UPSTREAM_DEFAULT_AUTH_SCHEME;
  const authValue = scheme.trim() === '' ? apiKey : `${scheme.trim()} ${apiKey}`;
  return { name: 'opencode-go', apiKey, endpoint, model, authHeader, authValue };
}

/**
 * 读取「直连 DeepSeek」主上游配置（独立于 OpenCode Go 的 DEEPSEEK_* 变量，仅 Node 侧使用，
 * 不注入客户端）。apiKey 为空表示未配置主上游。
 */
export function readDeepSeekConfig(env: Record<string, string>): RecognizeServerConfig {
  const apiKey = pick(env, ['DEEPSEEK_API_KEY']);
  const endpoint = normalizeRecognizeEndpoint(
    pick(env, ['DEEPSEEK_ENDPOINT']) || DEEPSEEK_DEFAULT_ENDPOINT,
  );
  const model = pick(env, ['DEEPSEEK_MODEL']) || DEEPSEEK_DEFAULT_MODEL;
  const authHeader = pick(env, ['DEEPSEEK_AUTH_HEADER']) || DEFAULT_RECOGNIZE_AUTH_HEADER;
  const scheme =
    env.DEEPSEEK_AUTH_SCHEME !== undefined
      ? env.DEEPSEEK_AUTH_SCHEME
      : DEFAULT_RECOGNIZE_AUTH_SCHEME;
  const authValue = scheme.trim() === '' ? apiKey : `${scheme.trim()} ${apiKey}`;
  return { name: 'deepseek', apiKey, endpoint, model, authHeader, authValue };
}

/**
 * 判定一次失败是否属于「额度不足/配额耗尽」类、值得切到备上游的失败。
 * - 429（限流/配额）与 402（需付费）恒判定为可 fallback；
 * - 其它非 2xx 仅在响应体出现明显额度/配额关键词时判定（不读不记录其它正文）。
 * - 401/403/500/502/504/网络等其它错误一律不触发 fallback。
 */
export function isQuotaFailure(status: number, bodyText: string): boolean {
  if (status === 429 || status === 402) return true;
  if (status >= 400 && status < 600) {
    const lower = bodyText.toLowerCase();
    return QUOTA_KEYWORDS.some((k) => lower.includes(k.toLowerCase()));
  }
  return false;
}

/** 统一清洗后的 JSON 错误响应 */
export function jsonError(status: number, message: string): string {
  return JSON.stringify({ error: { message, status } });
}

/** 上游错误状态/异常 → 可直接展示的中文提示（不含任何上游正文或密钥） */
export function upstreamErrorMessage(status: number): string {
  switch (status) {
    case 401:
    case 403:
      return '识别服务校验未通过：请检查本机服务配置（见项目 README）后重启开发服务。';
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

/**
 * 构造上游请求体：极简系统提示词（依模式选择，不附加目录/别名上下文）+ 用户文字。
 * 绝不含任何鉴权配置、目录或标签映射。
 */
export function buildUpstreamPayload(
  model: string,
  text: string,
  req: { mode?: RecognizeMode } = {},
): string {
  const mode: RecognizeMode = isRecognizeMode(req.mode) ? req.mode : 'items';
  return JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPromptForMode(mode) },
      { role: 'user', content: text },
    ],
    temperature: 0,
    // deepseek-v4-flash 是推理模型：默认会先生成超长思维链（reasoning_content），
    // 对复杂固定 schema 实测 >90s，撞上备上游 25s 超时预算导致 504。
    // 结构化识别只需最终 JSON，显式关闭 thinking 跳过思维链（实测全文约 5s）。
    thinking: { type: 'disabled' },
  });
}

/**
 * 从上游 2xx JSON 中提取 choices[0].message.content；
 * 无法提取时返回 null（代理只返回 { content }，不透传其它字段）。
 */
export function extractUpstreamContent(payload: unknown): string | null {
  const choices = (payload as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = (choices[0] as { message?: { content?: unknown } } | null)?.message?.content;
  return typeof content === 'string' && content !== '' ? content : null;
}

type JsonBodyResult =
  | {
      ok: true;
      text: string;
      mode: RecognizeMode;
    }
  | { ok: false; status: number; message: string };

/** 读取并解析请求 JSON：实际读取体积受限；仅接受含非空 text 的 JSON 对象。 */
function readJsonBody(req: IncomingMessage, limit: number): Promise<JsonBodyResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (value: JsonBodyResult): void => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        req.destroy();
        finish({ ok: false, status: 413, message: '提交的内容过大，请裁剪图片后重试。' });
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (settled) return;
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        // 非法 JSON：走下面的 400
      }
      const body = parsed as { text?: unknown; mode?: unknown } | null;
      const text = body?.text;
      if (typeof text !== 'string' || text.trim() === '') {
        finish({ ok: false, status: 400, message: '提交内容格式不正确，请重新识别后重试。' });
        return;
      }
      finish({
        ok: true,
        text,
        mode: isRecognizeMode(body?.mode) ? body.mode : 'items',
      });
    });
    req.on('error', () =>
      finish({ ok: false, status: 400, message: '提交内容读取失败，请重新识别后重试。' }),
    );
  });
}

function writeJson(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(body);
}

/** 单次上游请求的结果分类（用于安全 debug，不写正文）。 */
export type UpstreamOutcome =
  | 'success'
  | 'quota-fallback'
  | 'http-error'
  | 'timeout'
  | 'network-error'
  | 'aborted'
  | 'unknown-error';

export type UpstreamCallResult =
  | { ok: true; content: string; status: number; outcome: 'success' }
  | {
      ok: false;
      status: number;
      quotaFailure: boolean;
      outcome: Exclude<UpstreamOutcome, 'success'>;
      errorCategory?: string;
    };

/**
 * 执行单次上游请求（Node 原生 fetch）。
 * - 2xx 只提取 choices[0].message.content；
 * - 非 2xx：读取响应体仅用于 isQuotaFailure 判定（不落日志、不透传正文），
 *   网络/超时映射为 502/504；
 * - 结果附带安全 outcome 分类（AbortError/超时 → timeout；fetch 网络抛错 → network-error；
 *   非 2xx 且非额度 → http-error + status；额度 → quota-fallback；成功 → success）；
 *   不携带 endpoint / model / header / auth / key / body。
 */
export async function callUpstream(
  cfg: RecognizeServerConfig,
  payloadBody: string,
  signal: AbortSignal,
): Promise<UpstreamCallResult> {
  let upstream: Response;
  try {
    upstream = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        [cfg.authHeader]: cfg.authValue,
      },
      body: payloadBody,
      signal,
    });
  } catch (e) {
    // AbortError / 超时中断 → timeout；否则视为 fetch 网络层失败 → network-error
    if (signal.aborted) {
      return {
        ok: false,
        status: 504,
        quotaFailure: false,
        outcome: 'timeout',
        errorCategory: e instanceof Error ? e.name : 'AbortError',
      };
    }
    return { ok: false, status: 502, quotaFailure: false, outcome: 'network-error' };
  }
  if (!upstream.ok) {
    // 读取响应体仅用于额度判定；绝不落日志、绝不透传正文（可能含敏感信息）
    let bodyText = '';
    let bodyReadError: unknown = null;
    try {
      bodyText = await upstream.text();
    } catch (e) {
      bodyText = '';
      bodyReadError = e;
    }
    const quotaFailure = isQuotaFailure(upstream.status, bodyText);
    return {
      ok: false,
      status: upstream.status,
      quotaFailure,
      outcome: quotaFailure ? 'quota-fallback' : 'http-error',
      ...(bodyReadError !== null
        ? { errorCategory: bodyReadError instanceof Error ? bodyReadError.name : 'AbortError' }
        : {}),
    };
  }
  let payload: unknown = null;
  let bodyReadError: unknown = null;
  try {
    payload = await upstream.json();
  } catch (e) {
    payload = null;
    bodyReadError = e;
  }
  // 2xx 正文读取被共享超时中断：归类为 timeout（不无限等待、不落正文）
  if (bodyReadError !== null && signal.aborted) {
    return {
      ok: false,
      status: 504,
      quotaFailure: false,
      outcome: 'timeout',
      errorCategory: bodyReadError instanceof Error ? bodyReadError.name : 'AbortError',
    };
  }
  const content = extractUpstreamContent(payload);
  if (content === null) {
    return { ok: false, status: 502, quotaFailure: false, outcome: 'unknown-error' };
  }
  return { ok: true, content, status: upstream.status, outcome: 'success' };
}

export type RecognizeFlowResult = { content: string } | { status: number };

/**
 * 服务端回传的**安全** debug 元信息（不含任何密钥/请求体/响应体/headers/完整健康数据）：
 * - upstreamTried：本次实际尝试过的上游（按顺序）；
 * - selectedUpstream：最终选中的成功上游（成功时才有）；
 * - failedUpstream：最终失败的上游（失败时才有）；
 * - fallbackReason：触发/未触发 fallback 的类别（quota/network/timeout/http-status），
 *   不写任何正文；
 * - durationMs：本次整理总耗时（毫秒）；
 * - attempts：每次上游尝试的安全时间线（upstream / model / endpoint / status /
 *   durationMs / outcome / errorCategory），用于定位最终失败（如 DeepSeek 是超时、
 *   网络、HTTP 状态还是鉴权）；model/endpoint 为安全字段（不含鉴权头/Key/正文）；
 * - selectedUpstreamModel / selectedUpstreamEndpoint：最终命中的那次上游实际使用的
 *   请求模型名与请求地址（安全字段，便于调试界面展示当前实际请求）；
 * - finalFailureReason / finalStatus：最终失败的结果类别与 HTTP 状态（成功时无）。
 */
export interface RecognizeAttemptDebug {
  upstream: UpstreamName;
  model: string;
  endpoint: string;
  status?: number;
  durationMs: number;
  outcome:
    | 'success'
    | 'quota-fallback'
    | 'http-error'
    | 'timeout'
    | 'network-error'
    | 'aborted'
    | 'unknown-error';
  errorCategory?: string;
}

export interface RecognizeDebug {
  upstreamTried: Array<UpstreamName>;
  selectedUpstream: UpstreamName | null;
  selectedUpstreamModel: string | null;
  selectedUpstreamEndpoint: string | null;
  failedUpstream: UpstreamName | null;
  fallbackReason: 'quota' | 'network' | 'timeout' | 'http-status' | null;
  durationMs: number;
  attempts: RecognizeAttemptDebug[];
  finalFailureReason?: RecognizeAttemptDebug['outcome'];
  finalStatus?: number;
}

/** 把一次失败归类为 debug 用的安全类别（不写正文）。 */
function failureKind(status: number, quotaFailure: boolean): RecognizeDebug['fallbackReason'] {
  if (quotaFailure) return 'quota';
  if (status === 504) return 'timeout';
  if (status === 502) return 'network';
  return 'http-status';
}

export interface RecognizeFlowDebugResult {
  result: RecognizeFlowResult;
  debug: RecognizeDebug;
}

/**
 * 双上游 fallback 编排（带安全 debug 元信息）：先走主上游（默认直连 DeepSeek）。
 * 仅当主上游为「额度不足/配额/429」类失败且已配置备上游（OpenCode Go）时切到备上游；
 * 其它错误不切换，原样返回主上游状态。备上游失败同样返回其清洗状态。
 *
 * 每个上游使用**独立的超时预算**（默认主 25s / 备 20s），由 timeouts 参数传入；
 * 这样备上游不会吃满整体 60s 剩余预算。同时仍监听外层 signal：
 * 若外层（整体 REQUEST_TIMEOUT_MS 或调用方）提前中断，内层同步中断。
 * 逻辑与 recognizeWithFallback 完全一致，仅额外收集不含敏感信息的 debug 字段。
 */
export async function recognizeWithFallbackDebug(
  primary: RecognizeServerConfig,
  fallback: RecognizeServerConfig,
  payloadBody: string,
  signal: AbortSignal,
  timeouts: UpstreamTimeoutBudget = {
    primaryTimeoutMs: DEEPSEEK_TIMEOUT_MS,
    fallbackTimeoutMs: OPENCODE_GO_TIMEOUT_MS,
  },
): Promise<RecognizeFlowDebugResult> {
  const startedAt = Date.now();
  const primaryName = primary.name ?? 'opencode-go';
  const fallbackName = fallback.name ?? 'deepseek';
  const upstreamTried: Array<UpstreamName> = [];
  const attempts: RecognizeAttemptDebug[] = [];
  let selectedUpstream: UpstreamName | null = null;
  let failedUpstream: UpstreamName | null = null;
  let fallbackReason: RecognizeDebug['fallbackReason'] = null;
  let finalFailureReason: RecognizeDebug['finalFailureReason'];
  let finalStatus: number | undefined;

  /**
   * 执行一次上游调用：为该上游创建独立 AbortController + 独立超时计时器，
   * 并联动外层 signal；记录该上游自身的 attempts 时间线（不含敏感字段）。
   */
  async function tryUpstream(
    name: UpstreamName,
    cfg: RecognizeServerConfig,
    budgetMs: number,
  ): Promise<UpstreamCallResult> {
    upstreamTried.push(name);
    const t0 = Date.now();
    const inner = new AbortController();
    const innerTimer = setTimeout(() => inner.abort(new Error(`${name} timeout`)), budgetMs);
    const onOuterAbort = (): void => inner.abort(signal.reason);
    if (signal.aborted) inner.abort(signal.reason);
    else signal.addEventListener('abort', onOuterAbort);
    let r: UpstreamCallResult;
    try {
      r = await callUpstream(cfg, payloadBody, inner.signal);
    } finally {
      clearTimeout(innerTimer);
      signal.removeEventListener('abort', onOuterAbort);
    }
    attempts.push({
      upstream: name,
      model: cfg.model,
      endpoint: cfg.endpoint,
      ...(typeof r.status === 'number' ? { status: r.status } : {}),
      durationMs: Date.now() - t0,
      outcome: r.outcome,
      ...('errorCategory' in r && r.errorCategory !== undefined
        ? { errorCategory: r.errorCategory }
        : {}),
    });
    return r;
  }

  const finish = (result: RecognizeFlowResult): RecognizeFlowDebugResult => {
    const selectedCfg =
      selectedUpstream === fallbackName
        ? fallback
        : selectedUpstream === primaryName
          ? primary
          : null;
    return {
      result,
      debug: {
        upstreamTried,
        selectedUpstream,
        selectedUpstreamModel: selectedCfg ? selectedCfg.model : null,
        selectedUpstreamEndpoint: selectedCfg ? selectedCfg.endpoint : null,
        failedUpstream,
        fallbackReason,
        durationMs: Date.now() - startedAt,
        attempts,
        ...(finalFailureReason !== undefined ? { finalFailureReason } : {}),
        ...(finalStatus !== undefined ? { finalStatus } : {}),
      },
    };
  };

  const first = await tryUpstream(primaryName, primary, timeouts.primaryTimeoutMs);
  if (first.ok) {
    selectedUpstream = primaryName;
    return finish({ content: first.content });
  }
  failedUpstream = primaryName;
  if (first.quotaFailure && fallback.apiKey !== '') {
    fallbackReason = 'quota';
    const second = await tryUpstream(fallbackName, fallback, timeouts.fallbackTimeoutMs);
    if (second.ok) {
      selectedUpstream = fallbackName;
      return finish({ content: second.content });
    }
    failedUpstream = fallbackName;
    finalFailureReason = second.outcome;
    finalStatus = second.status;
    return finish({ status: second.status });
  }
  // 不满足 fallback 条件：未发生 fallback，fallbackReason 保持 null。
  finalFailureReason = first.outcome;
  finalStatus = first.status;
  return finish({ status: first.status });
}

/**
 * 双上游 fallback 编排（仅返回结果；旧接口，供既有调用/测试使用）。
 * 逻辑与 recognizeWithFallbackDebug 完全一致。
 */
export async function recognizeWithFallback(
  primary: RecognizeServerConfig,
  fallback: RecognizeServerConfig,
  payloadBody: string,
  signal: AbortSignal,
  timeouts?: UpstreamTimeoutBudget,
): Promise<RecognizeFlowResult> {
  return (await recognizeWithFallbackDebug(primary, fallback, payloadBody, signal, timeouts))
    .result;
}

/**
 * 中间件主流程：
 * - mock 开启（仅开发环境 + MOCK_RECOGNITION=true）时，直接返回 docs/sample.json 适配结果，
 *   不调用任何上游 / API Key，前端协议与真实识别接口一致；
 * - 否则：校验 → 主上游（OpenCode Go）→ 额度类失败时回退到直连 DeepSeek → 清洗响应。
 */
async function handleRecognizeReport(
  req: IncomingMessage,
  res: ServerResponse,
  primary: RecognizeServerConfig,
  fallback: RecognizeServerConfig,
  timeouts: UpstreamTimeoutBudget,
  mockEnabled: boolean,
  mockDelay: number,
): Promise<void> {
  if (req.method !== 'POST') {
    writeJson(res, 405, jsonError(405, '该接口仅支持 POST 请求。'));
    return;
  }
  const length = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(length) && length > MAX_REQUEST_BODY_BYTES) {
    writeJson(res, 413, jsonError(413, '提交的内容过大，请裁剪图片后重试。'));
    return;
  }
  const body = await readJsonBody(req, MAX_REQUEST_BODY_BYTES);
  if (!body.ok) {
    writeJson(res, body.status, jsonError(body.status, body.message));
    return;
  }

  // ---- mock 分支：不调用上游 / 不读取 API Key ----
  if (mockEnabled) {
    const startedAt = Date.now();
    if (mockDelay > 0) {
      await new Promise((r) => setTimeout(r, mockDelay));
    }
    const content = buildMockRecognizeContent(body.mode);
    // 安全 debug：标注 mock 来源，不含任何密钥 / 请求体 / 响应体
    const mockDebug: RecognizeDebug = {
      upstreamTried: [],
      selectedUpstream: null,
      selectedUpstreamModel: null,
      selectedUpstreamEndpoint: null,
      failedUpstream: null,
      fallbackReason: null,
      durationMs: Date.now() - startedAt,
      attempts: [],
    };
    writeJson(res, 200, JSON.stringify({ content, debug: mockDebug }));
    return;
  }

  // ---- 真实模式（不 mock）----
  if (primary.apiKey === '') {
    writeJson(
      res,
      503,
      jsonError(
        503,
        '识别功能尚未启用：请在本机配置服务密钥（项目根目录 .env.local 中的 DEEPSEEK_API_KEY）并重启开发服务后重试。',
      ),
    );
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  const emptyDebug = (): RecognizeDebug => ({
    upstreamTried: [],
    selectedUpstream: null,
    selectedUpstreamModel: null,
    selectedUpstreamEndpoint: null,
    failedUpstream: null,
    fallbackReason: null,
    durationMs: Date.now() - startedAt,
    attempts: [],
  });
  try {
    let flow: RecognizeFlowDebugResult;
    try {
      // 每个上游使用各自独立超时预算（主 25s / 备 20s，可被服务端 env 覆盖）；
      // 外层 REQUEST_TIMEOUT_MS 仍作为整体硬封顶，绝无无限等待。
      flow = await recognizeWithFallbackDebug(
        primary,
        fallback,
        buildUpstreamPayload(primary.model, body.text, { mode: body.mode }),
        controller.signal,
        timeouts,
      );
    } catch {
      // 上游编排抛出的任何未预期异常：绝不静默挂起请求，一律回 502 清洗 JSON。
      writeJson(
        res,
        502,
        JSON.stringify({
          error: { message: upstreamErrorMessage(502), status: 502 },
          debug: emptyDebug(),
        }),
      );
      return;
    }
    const result = flow.result;
    if ('content' in result) {
      writeJson(res, 200, JSON.stringify({ content: result.content, debug: flow.debug }));
    } else {
      writeJson(
        res,
        result.status,
        JSON.stringify({
          error: { message: upstreamErrorMessage(result.status), status: result.status },
          debug: flow.debug,
        }),
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

/** 精确拦截 /api/recognize-report 的自定义中间件（其余路径放行，不做任何 hack）。 */
function recognizeReportMiddleware(
  primary: RecognizeServerConfig,
  fallback: RecognizeServerConfig,
  timeouts: UpstreamTimeoutBudget,
  mockEnabled: boolean,
  mockDelay: number,
): Plugin {
  return {
    name: 'recognize-report-middleware',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === undefined) {
          next();
          return;
        }
        const pathname = req.url.split('?')[0];
        if (pathname !== PROXY_CONTEXT) {
          next();
          return;
        }
        void handleRecognizeReport(req, res, primary, fallback, timeouts, mockEnabled, mockDelay);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const openCodeGoCfg = readServerConfig(env);
  const deepSeekCfg = readDeepSeekConfig(env);
  const timeouts = readUpstreamTimeouts(env);

  // 开发环境 mock：仅当 dev 模式（非 build/preview）且 MOCK_RECOGNITION=true 时启用；
  // 未设置时保持真实行为，绝不调用上游 / 不读取 API Key 的逻辑仅在 mock 开启时生效。
  const mockEnabled = mode === MOCK_DEV_MODE && isMockRecognitionEnabled(env);
  const mockDelay = mockEnabled ? mockDelayMs(env) : 0;
  if (mockEnabled) {
    announceMockEnabled();
  }

  return {
    // 主上游 = 直连 DeepSeek；备上游 = OpenCode Go（仅在 DeepSeek 额度类失败时回退）
    plugins: [
      react(),
      recognizeReportMiddleware(deepSeekCfg, openCodeGoCfg, timeouts, mockEnabled, mockDelay),
    ],
    base: './',
    // 修复 React Invalid hook call（App.tsx 首行 useState dispatcher null）：
    // 确保 Vite 预构建/依赖解析始终只保留一份 React/ReactDOM 实例，
    // 避免旧 optimizeDeps 缓存或依赖图解析产生重复 React 副本。
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      include: ['react', 'react-dom'],
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'api/**/*.test.ts', 'viteConfigHelpers.test.ts'],
    },
  };
});
