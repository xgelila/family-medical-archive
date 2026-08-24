/**
 * 「识别数据」客户端：只请求**同源** Vite 开发代理 /api/recognize-report。
 *
 * 安全边界（严格）：
 * - 浏览器端**不持有任何密钥 / 服务地址 / 模型名**：endpoint、model、鉴权头、
 *   scheme、API Key 全部只在 Vite dev 的 Node 侧读取（见 vite.config.ts）；
 * - 请求正文只包含 { text, mode, catalog, labelMappings }：识别文字 + 受控目录简表
 *   （仅 id+名称）+ 用户已确认别名映射（仅名称到 ID），**图片绝不发送**，
 *   也绝不发送任何密钥、历史报告全文或健康数值历史；
 * - 请求与响应正文不做任何 console 日志；
 * - 上游错误由代理清洗后返回，本模块只负责把 HTTP 状态映射为可直接展示的中文自然语言
 *   提示（不含技术栈名称、不含 Key、不含正文）；
 * - 代理 2xx 只返回精简的 { content }（代理已在上游侧把 choices[0].message.content
 *   单独取出，不透传 model/usage 等无关字段）；本模块同时兼容旧式完整 choices 响应；
 * - 开发环境由 Vite Node 中间件处理；Vercel 生产环境由 api/recognize-report.ts 处理。
 */

import type { RecognizeMode } from '../shared/recognizeProtocol';

export interface StructureReply {
  content: string;
  /** 仅本机调试元信息（不含 headers / Key / 正文）。 */
  debug?: RecognizeDebugInfo;
}

export type StructureErrorKind = 'config-missing' | 'network' | 'timeout' | 'http' | 'bad-reply';

/**
 * 服务端回传的安全 debug 元信息（已清洗，不含任何密钥/正文/headers）。
 * 字段含义见 vite.config.ts 的 RecognizeDebug；attempts 为每次上游尝试的安全时间线。
 */
export interface ServerAttemptDebug {
  upstream: string;
  /** 该次尝试实际使用的请求模型名（安全字段）。 */
  model?: string;
  /** 该次尝试实际使用的请求地址（安全字段）。 */
  endpoint?: string;
  status?: number;
  durationMs: number;
  outcome: string;
  errorCategory?: string;
}

export interface ServerDebug {
  upstreamTried: string[];
  selectedUpstream: string | null;
  /** 最终命中的那次上游实际使用的请求模型名（安全字段）。 */
  selectedUpstreamModel: string | null;
  /** 最终命中的那次上游实际使用的请求地址（安全字段）。 */
  selectedUpstreamEndpoint: string | null;
  failedUpstream: string | null;
  fallbackReason: string | null;
  durationMs: number;
  attempts: ServerAttemptDebug[];
  finalFailureReason: string | null;
  finalStatus: number | null;
}

/**
 * 客户端 debug 元信息（仅本机调试面板展示用，绝不包含 headers / Authorization / Key）。
 * - startedAt/finishedAt/durationMs：请求开始/结束时间与耗时（毫秒）；
 * - status：HTTP 状态（网络/超时/未发出时为 null）；
 * - timeout：是否超时；
 * - errorCode/errorMessage：错误类别与清洗后的中文提示；
 * - server：服务端回传的安全上游 debug（无则 null）。
 */
export interface RecognizeDebugInfo {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  status: number | null;
  timeout: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  server: ServerDebug | null;
}

/**
 * 从服务端响应体中安全提取 debug 字段：只取白名单字段，忽略其余内容，
 * 绝不透传任何可能含敏感信息的字段。
 */
/** 从服务端白名单字段中安全提取单次上游尝试；只取 whitelist，丢弃其余（如 header/key/正文）。 */
function sanitizeAttempt(value: unknown): ServerAttemptDebug | null {
  if (value === null || typeof value !== 'object') return null;
  const a = value as Record<string, unknown>;
  if (typeof a.upstream !== 'string' || typeof a.durationMs !== 'number') return null;
  return {
    upstream: a.upstream,
    ...(typeof a.model === 'string' ? { model: a.model } : {}),
    ...(typeof a.endpoint === 'string' ? { endpoint: a.endpoint } : {}),
    ...(typeof a.status === 'number' ? { status: a.status } : {}),
    durationMs: a.durationMs,
    outcome: typeof a.outcome === 'string' ? a.outcome : 'unknown-error',
    ...(typeof a.errorCategory === 'string' ? { errorCategory: a.errorCategory } : {}),
  };
}

function sanitizeServerDebug(payload: unknown): ServerDebug | null {
  if (payload === null || typeof payload !== 'object') return null;
  const d = payload as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const upstreamTried = Array.isArray(d.upstreamTried)
    ? d.upstreamTried.filter((x): x is string => typeof x === 'string')
    : [];
  const attempts = Array.isArray(d.attempts)
    ? d.attempts.map(sanitizeAttempt).filter((x): x is ServerAttemptDebug => x !== null)
    : [];
  return {
    upstreamTried,
    selectedUpstream: str(d.selectedUpstream),
    selectedUpstreamModel: str(d.selectedUpstreamModel),
    selectedUpstreamEndpoint: str(d.selectedUpstreamEndpoint),
    failedUpstream: str(d.failedUpstream),
    fallbackReason: str(d.fallbackReason),
    durationMs: typeof d.durationMs === 'number' ? d.durationMs : 0,
    attempts,
    finalFailureReason: str(d.finalFailureReason),
    finalStatus: typeof d.finalStatus === 'number' ? d.finalStatus : null,
  };
}

function buildDebug(
  startedAt: number,
  opts: {
    status: number | null;
    timeout: boolean;
    errorCode: string | null;
    errorMessage: string | null;
    server?: unknown;
  },
): RecognizeDebugInfo {
  const finishedAt = Date.now();
  return {
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    status: opts.status,
    timeout: opts.timeout,
    errorCode: opts.errorCode,
    errorMessage: opts.errorMessage,
    server: sanitizeServerDebug(opts.server ?? null),
  };
}

/**
 * 客户端「整理」请求的默认超时（毫秒）。
 * 刻意**略长于**服务端上游的总超时（60s）：这样当上游超时/出错时，
 * 服务端会先返回清洗后的 504 错误，客户端再把它展示为自然语言提示，
 * 而不是让客户端先报一个笼统的「处理超时」。
 */
/** 生产与开发共用的同源 API 路径；不得改为 Vite-only 代理地址。 */
export const RECOGNIZE_API_PATH = '/api/recognize-report';

export const DEFAULT_RECOGNIZE_TIMEOUT_MS = 70_000;

/** 「识别数据」结构化错误（Error 子类，message 恒为可直接展示的中文提示）。 */
export class StructureError extends Error {
  readonly kind: StructureErrorKind;
  readonly status?: number;
  /** 仅本机调试元信息（不含 headers / Key / 正文）。 */
  readonly debug?: RecognizeDebugInfo;

  constructor(
    kind: StructureErrorKind,
    message: string,
    status?: number,
    debug?: RecognizeDebugInfo,
  ) {
    super(message);
    this.name = 'StructureError';
    this.kind = kind;
    if (status !== undefined) this.status = status;
    if (debug !== undefined) this.debug = debug;
  }
}

function makeError(
  kind: StructureErrorKind,
  message: string,
  status?: number,
  debug?: RecognizeDebugInfo,
): StructureError {
  return new StructureError(kind, message, status, debug);
}

/** HTTP 状态 → 自然语言提示（不含技术栈名称 / Key / 正文）。 */
function statusMessage(status: number): string {
  switch (status) {
    case 401:
    case 403:
      return '识别服务校验未通过：请检查本机服务配置（见项目 README 或「隐私说明」）后重启。';
    case 404:
      return '识别接口不可用：请检查部署的 API 路由后重试。';
    case 413:
      return '提交的内容过大，请裁剪图片后重试。';
    case 429:
      return '请求过于频繁，请稍后重试。';
    case 503:
      return '识别功能尚未启用或暂时不可用，请稍后重试。';
    default:
      return '识别请求失败，请稍后重试。';
  }
}

function extractContent(payload: unknown): string | null {
  // 代理精简响应：{ content: string }
  if (payload !== null && typeof payload === 'object') {
    const direct = (payload as { content?: unknown }).content;
    if (typeof direct === 'string' && direct !== '') return direct;
  }
  // 兼容旧式上游完整 choices 响应（平滑过渡，不因响应形状差异失败）
  const choices = (payload as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = (choices[0] as { message?: { content?: unknown } } | null)?.message?.content;
  return typeof content === 'string' && content !== '' ? content : null;
}

/**
 * 发送识别出的文字到同源代理做结构化整理。
 * - 请求体只含 { text, mode }，绝不包含密钥/图片/历史报告/目录/标签映射；
 * - 响应正文不落日志；
 * - 失败时抛 StructureError（中文 message，无 Key / 技术栈 / 正文泄露）。
 */
export async function parseRecognizedText(
  text: string,
  opts: {
    timeoutMs?: number;
    mode?: RecognizeMode;
  } = {},
): Promise<StructureReply> {
  if (text.trim() === '') {
    // 请求尚未发出即被拒绝：仍携带清洗后的 debug（status=null），
    // 使调试面板第二步能展示明确的「失败」状态而非长期为「—」。
    const startedAt = Date.now();
    throw makeError(
      'bad-reply',
      '没有可整理的文字内容，请重新识别。',
      undefined,
      buildDebug(startedAt, {
        status: null,
        timeout: false,
        errorCode: 'bad-reply',
        errorMessage: '没有可整理的文字内容，请重新识别。',
      }),
    );
  }
  const startedAt = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_RECOGNIZE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(RECOGNIZE_API_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          mode: opts.mode ?? 'items',
        }),
        signal: controller.signal,
      });
    } catch (e) {
      if (controller.signal.aborted) {
        throw makeError(
          'timeout',
          '处理超时，请稍后重试。',
          undefined,
          buildDebug(startedAt, {
            status: null,
            timeout: true,
            errorCode: 'timeout',
            errorMessage: '处理超时，请稍后重试。',
          }),
        );
      }
      throw makeError(
        'network',
        '网络连接失败，请检查网络后重试。',
        undefined,
        buildDebug(startedAt, {
          status: null,
          timeout: false,
          errorCode: 'network',
          errorMessage: '网络连接失败，请检查网络后重试。',
        }),
      );
    }

    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      // 响应正文读取卡住被超时中断：报告为超时而非笼统的整理失败
      if (controller.signal.aborted) {
        throw makeError(
          'timeout',
          '处理超时，请稍后重试。',
          res.status,
          buildDebug(startedAt, {
            status: res.status,
            timeout: true,
            errorCode: 'timeout',
            errorMessage: '处理超时，请稍后重试。',
          }),
        );
      }
      payload = null;
    }

    if (!res.ok) {
      const serverError =
        payload && typeof payload === 'object' && 'error' in payload
          ? (payload as { error?: { message?: unknown; code?: unknown } }).error
          : undefined;
      const serverMessage = serverError?.message;
      const msg =
        typeof serverMessage === 'string' && serverMessage !== ''
          ? serverMessage
          : statusMessage(res.status);
      throw makeError(
        'http',
        msg,
        res.status,
        buildDebug(startedAt, {
          status: res.status,
          timeout: false,
          errorCode: 'http',
          errorMessage: msg,
          server: (payload as { debug?: unknown } | null)?.debug,
        }),
      );
    }

    const content = extractContent(payload);
    if (content === null) {
      throw makeError(
        'bad-reply',
        '识别结果整理失败，请重试。',
        res.status,
        buildDebug(startedAt, {
          status: res.status,
          timeout: false,
          errorCode: 'bad-reply',
          errorMessage: '识别结果整理失败，请重试。',
          server: (payload as { debug?: unknown } | null)?.debug,
        }),
      );
    }
    return {
      content,
      debug: buildDebug(startedAt, {
        status: res.status,
        timeout: false,
        errorCode: null,
        errorMessage: null,
        server: (payload as { debug?: unknown } | null)?.debug,
      }),
    };
  } finally {
    clearTimeout(timer);
  }
}
