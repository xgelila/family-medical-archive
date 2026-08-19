import { describe, expect, it, vi } from 'vitest';
import {
  buildUpstreamPayload,
  callUpstream,
  extractUpstreamContent,
  isQuotaFailure,
  jsonError,
  readDeepSeekConfig,
  readServerConfig,
  readUpstreamTimeouts,
  recognizeWithFallback,
  recognizeWithFallbackDebug,
  upstreamErrorMessage,
  type RecognizeServerConfig,
} from './vite.config';

/**
 * vite.config.ts 纯函数测试（Node 侧）：
 * - 只传模拟 env 记录，**绝不读取真实环境 / 密钥**（.env.local / process.env）；
 * - 覆盖：默认配置恢复、变量优先级、错误清洗映射、2xx 响应内容提取、上游请求体构造。
 */

describe('readServerConfig（默认配置恢复与变量优先级）', () => {
  it('默认 endpoint 恢复为 https://opencode.ai/zen/go/v1/chat/completions，model 为 deepseek-v4-flash', () => {
    const cfg = readServerConfig({});
    expect(cfg.endpoint).toBe('https://opencode.ai/zen/go/v1/chat/completions');
    expect(cfg.model).toBe('deepseek-v4-flash');
    expect(cfg.authHeader).toBe('Authorization');
    expect(cfg.authValue).toBe('Bearer ');
    expect(cfg.apiKey).toBe('');
  });

  it('优先读取 OPENCODE_GO_*，VITE_OPENCODE_GO_* 仅作兼容回退', () => {
    const cfg = readServerConfig({
      OPENCODE_GO_API_KEY: 'new-key',
      VITE_OPENCODE_GO_API_KEY: 'old-key',
      OPENCODE_GO_ENDPOINT: 'https://example.invalid/v1',
      VITE_OPENCODE_GO_ENDPOINT: 'https://fallback.invalid/v1',
    });
    expect(cfg.apiKey).toBe('new-key');
    expect(cfg.endpoint).toBe('https://example.invalid/v1');
  });

  it('VITE_ 变量回退生效；authValue 默认 Bearer scheme', () => {
    const cfg = readServerConfig({ VITE_OPENCODE_GO_API_KEY: 'old-key' });
    expect(cfg.apiKey).toBe('old-key');
    expect(cfg.authValue).toBe('Bearer old-key');
  });

  it('显式空 scheme → authValue 仅为 Key（无 scheme 前缀）', () => {
    const cfg = readServerConfig({ OPENCODE_GO_API_KEY: 'k', OPENCODE_GO_AUTH_SCHEME: '' });
    expect(cfg.authValue).toBe('k');
    expect(cfg.authHeader).toBe('Authorization');
  });
});

describe('jsonError / upstreamErrorMessage（错误清洗映射）', () => {
  it('jsonError 输出固定结构（不透传上游正文）', () => {
    expect(JSON.parse(jsonError(401, '清洗后提示'))).toEqual({
      error: { message: '清洗后提示', status: 401 },
    });
  });

  it('401/403/429/504/502/其它 均映射为通用中文提示', () => {
    expect(upstreamErrorMessage(401)).toContain('校验未通过');
    expect(upstreamErrorMessage(403)).toContain('校验未通过');
    expect(upstreamErrorMessage(429)).toContain('频繁');
    expect(upstreamErrorMessage(504)).toContain('超时');
    expect(upstreamErrorMessage(502)).toContain('无法连接');
    expect(upstreamErrorMessage(500)).toContain('暂时不可用');
  });
});

describe('extractUpstreamContent（2xx 响应提取，仅保留 content）', () => {
  it('提取 choices[0].message.content 为字符串', () => {
    expect(extractUpstreamContent({ choices: [{ message: { content: '{"items":[]}' } }] })).toBe(
      '{"items":[]}',
    );
  });

  it('无 choices / 空 choices / content 非字符串或为空 → null', () => {
    expect(extractUpstreamContent({})).toBeNull();
    expect(extractUpstreamContent({ choices: [] })).toBeNull();
    expect(extractUpstreamContent({ choices: [{ message: {} }] })).toBeNull();
    expect(extractUpstreamContent({ choices: [{ message: { content: '' } }] })).toBeNull();
    expect(extractUpstreamContent(null)).toBeNull();
    expect(extractUpstreamContent('junk')).toBeNull();
  });

  it('其它字段（role/finish_reason/usage）不参与提取（避免透传无关字段）', () => {
    const content = extractUpstreamContent({
      choices: [{ message: { content: 'ok', role: 'assistant' }, finish_reason: 'stop' }],
      usage: { total_tokens: 123 },
    });
    expect(content).toBe('ok');
  });
});

describe('buildUpstreamPayload（上游请求体构造）', () => {
  it('仅包含 model / 系统提示 / 用户文字，绝不含任何鉴权字段', () => {
    const body = JSON.parse(buildUpstreamPayload('deepseek-v4-flash', '血红蛋白 145')) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      temperature: number;
    };
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content.length).toBeGreaterThan(100);
    expect(body.messages[1]).toEqual({ role: 'user', content: '血红蛋白 145' });
    expect(Object.keys(body)).toEqual(['model', 'messages', 'temperature', 'thinking']);
    expect(JSON.stringify(body)).not.toContain('api_key');
    expect(JSON.stringify(body)).not.toContain('Authorization');
  });

  it('显式关闭 thinking：deepseek-v4-flash 为推理模型，默认思维链会撞上备上游超时', () => {
    const body = JSON.parse(buildUpstreamPayload('m', 'x')) as { thinking?: unknown };
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('缺省模式为 items；系统提示词为极简版本，不含目录/别名/标签上下文', () => {
    const body = JSON.parse(
      buildUpstreamPayload('m', 'x', {
        mode: 'items',
      }),
    ) as { messages: Array<{ role: string; content: string }> };
    const sys = body.messages[0].content;
    expect(sys).toContain('从文字中识别出检查单的所有检查项目和各个字段值，生成结构化数据');
    expect(sys).not.toContain('受控目录候选');
    expect(sys).not.toContain('recommendedLabelId');
    expect(sys).not.toContain('recommendedLabel');
    expect(sys).not.toContain('labelStatus');
    expect(sys).not.toContain('labelConfidence');
    expect(sys).not.toContain('用户已确认别名');
    expect(body.messages[1]).toEqual({ role: 'user', content: 'x' });
  });

  it('report 模式使用整张报告提示词（含报告信息字段）', () => {
    const body = JSON.parse(buildUpstreamPayload('m', 'x', { mode: 'report' })) as {
      messages: Array<{ role: string; content: string }>;
    };
    const sys = body.messages[0].content;
    expect(sys).toContain('hospital');
    expect(sys).toContain('reportDate');
    expect(sys).toContain('reportType');
    expect(sys).toContain('title');
    expect(sys).toContain('notes');
    expect(sys).toContain('name');
    expect(sys).not.toContain('受控目录');
    expect(sys).not.toContain('recommendedLabelId');
    expect(sys).not.toContain('labelStatus');
  });

  it('请求 JSON 不含 catalog / labelMappings（即使显式传入也不附加）', () => {
    const bodyStr = buildUpstreamPayload('m', 'x', { mode: 'report' });
    const body = JSON.parse(bodyStr) as { messages: Array<{ role: string; content: string }> };
    expect(Object.keys(body)).toEqual(['model', 'messages', 'temperature', 'thinking']);
    expect(bodyStr).not.toContain('catalog');
    expect(bodyStr).not.toContain('labelMappings');
  });

  it('非法 mode 回退为 items', () => {
    const body = JSON.parse(buildUpstreamPayload('m', 'x', { mode: 'whatever' as never })) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages[0].content).toContain('name');
    expect(body.messages[0].content).toContain('hospital');
  });
});

describe('readUpstreamTimeouts（每上游独立超时预算，仅服务端读取）', () => {
  it('默认：主(deepseek) 25s / 备(opencode-go) 20s（未配置任何 env 也可正常工作）', () => {
    const t = readUpstreamTimeouts({});
    expect(t.primaryTimeoutMs).toBe(25_000);
    expect(t.fallbackTimeoutMs).toBe(20_000);
  });

  it('读取非 VITE 服务端 env DEEPSEEK_TIMEOUT_MS / OPENCODE_GO_TIMEOUT_MS 覆盖默认值', () => {
    const t = readUpstreamTimeouts({
      OPENCODE_GO_TIMEOUT_MS: '30000',
      DEEPSEEK_TIMEOUT_MS: '15000',
    });
    expect(t.primaryTimeoutMs).toBe(15_000);
    expect(t.fallbackTimeoutMs).toBe(30_000);
  });

  it('非法/非正数/空值回退默认，且不读取 VITE_ 前缀变量（避免前端可写变量影响）', () => {
    expect(
      readUpstreamTimeouts({ OPENCODE_GO_TIMEOUT_MS: 'abc', DEEPSEEK_TIMEOUT_MS: '0' }),
    ).toEqual({ primaryTimeoutMs: 25_000, fallbackTimeoutMs: 20_000 });
    expect(
      readUpstreamTimeouts({ VITE_OPENCODE_GO_TIMEOUT_MS: '5000', VITE_DEEPSEEK_TIMEOUT_MS: '5000' }),
    ).toEqual({ primaryTimeoutMs: 25_000, fallbackTimeoutMs: 20_000 });
  });
});

function deepSeekCfg(apiKey: string): RecognizeServerConfig {
  return {
    name: 'deepseek',
    apiKey,
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-v4-flash',
    authHeader: 'Authorization',
    authValue: apiKey === '' ? 'Bearer ' : `Bearer ${apiKey}`,
  };
}

const OPENCODE_ENDPOINT = 'https://opencode.ai/zen/go/v1/chat/completions';

const primaryCfg: RecognizeServerConfig = {
  name: 'opencode-go',
  apiKey: 'oc-key',
  endpoint: OPENCODE_ENDPOINT,
  model: 'deepseek-v4-flash',
  authHeader: 'Authorization',
  authValue: 'Bearer oc-key',
};

const PAYLOAD = JSON.stringify({ model: 'm', messages: [], temperature: 0 });
const SIGNAL = new AbortController().signal;

function okContent(content = '{"items":[]}'): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

function statusBody(status: number, body: string): Response {
  return new Response(body, { status });
}

describe('readDeepSeekConfig（备上游独立配置）', () => {
  it('默认值：直连 DeepSeek endpoint/model；未配置 apiKey 为空', () => {
    const cfg = readDeepSeekConfig({});
    expect(cfg.endpoint).toBe('https://api.deepseek.com/chat/completions');
    expect(cfg.model).toBe('deepseek-v4-flash');
    expect(cfg.authHeader).toBe('Authorization');
    expect(cfg.apiKey).toBe('');
  });

  it('读取 DEEPSEEK_* 独立变量（与 OPENCODE_GO_* 互不影响）', () => {
    const cfg = readDeepSeekConfig({
      DEEPSEEK_API_KEY: 'ds-key',
      DEEPSEEK_ENDPOINT: 'https://example.invalid/v1',
      DEEPSEEK_MODEL: 'custom-model-x',
    });
    expect(cfg.apiKey).toBe('ds-key');
    expect(cfg.endpoint).toBe('https://example.invalid/v1');
    expect(cfg.model).toBe('custom-model-x');
    expect(cfg.authValue).toBe('Bearer ds-key');
    // 不读取 OpenCode Go 的变量
    const mixed = readDeepSeekConfig({ OPENCODE_GO_API_KEY: 'oc-key' });
    expect(mixed.apiKey).toBe('');
  });
});

describe('isQuotaFailure（fallback 触发条件限定）', () => {
  it('429 / 402 恒判定为额度类失败（无论正文）', () => {
    expect(isQuotaFailure(429, '')).toBe(true);
    expect(isQuotaFailure(402, 'anything')).toBe(true);
  });

  it('其它非 2xx 仅在正文含明显额度/配额关键词时判定', () => {
    expect(isQuotaFailure(400, 'quota exhausted')).toBe(true);
    expect(isQuotaFailure(500, 'insufficient balance')).toBe(true);
    expect(isQuotaFailure(400, '额度不足')).toBe(true);
    expect(isQuotaFailure(400, '配额已用完')).toBe(true);
  });

  it('普通错误不判定为额度类（500/502/504/401/403 且正文无关）', () => {
    expect(isQuotaFailure(500, 'internal error')).toBe(false);
    expect(isQuotaFailure(502, 'bad gateway')).toBe(false);
    expect(isQuotaFailure(504, 'upstream timeout')).toBe(false);
    expect(isQuotaFailure(401, 'unauthorized')).toBe(false);
    expect(isQuotaFailure(403, 'forbidden')).toBe(false);
  });

  it('2xx 一律不判定（非失败场景）', () => {
    expect(isQuotaFailure(200, 'quota')).toBe(false);
  });
});

describe('callUpstream（单次上游请求）', () => {
  it('2xx 提取 choices[0].message.content，outcome=success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okContent('结果')));
    const r = await callUpstream(primaryCfg, PAYLOAD, SIGNAL);
    expect(r).toEqual({ ok: true, content: '结果', status: 200, outcome: 'success' });
    vi.unstubAllGlobals();
  });

  it('非 2xx 返回状态与额度判定结果，不透传正文；额度 → outcome=quota-fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => statusBody(429, 'rate limit')));
    const r = await callUpstream(primaryCfg, PAYLOAD, SIGNAL);
    expect(r).toEqual({
      ok: false,
      status: 429,
      quotaFailure: true,
      outcome: 'quota-fallback',
    });
    vi.unstubAllGlobals();
  });

  it('非 2xx 且非额度（401/403/500）→ outcome=http-error 并带 status', async () => {
    for (const [status, body] of [
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [500, 'internal error'],
    ] as Array<[number, string]>) {
      vi.stubGlobal('fetch', vi.fn(async () => statusBody(status, body)));
      const r = await callUpstream(primaryCfg, PAYLOAD, SIGNAL);
      expect(r).toEqual({
        ok: false,
        status,
        quotaFailure: false,
        outcome: 'http-error',
      });
      vi.unstubAllGlobals();
    }
  });

  it('fetch 网络层抛错（非中断）→ outcome=network-error、status 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const r = await callUpstream(primaryCfg, PAYLOAD, SIGNAL);
    expect(r).toEqual({
      ok: false,
      status: 502,
      quotaFailure: false,
      outcome: 'network-error',
    });
    vi.unstubAllGlobals();
  });

  it('共享 AbortController 超时中断上游请求 → 返回 504、outcome=timeout（不无限等待）', async () => {
    const controller = new AbortController();
    controller.abort(new Error('timeout'));
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          if (init.signal?.aborted) reject(init.signal.reason);
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      }),
    );
    const r = await callUpstream(primaryCfg, PAYLOAD, controller.signal);
    expect(r).toMatchObject({
      ok: false,
      status: 504,
      quotaFailure: false,
      outcome: 'timeout',
      errorCategory: 'Error',
    });
    vi.unstubAllGlobals();
  });

  it('非 2xx 正文读取被超时中断 → 仍返回结果（不无限等待、不落正文）', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init: RequestInit) => {
        return Promise.resolve({
          ok: false,
          status: 429,
          // 模拟正文流一直不返回，直到被 AbortController 中断
          text: () =>
            new Promise<string>((_resolve, reject) => {
              if (init.signal?.aborted) reject(init.signal.reason);
              init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
            }),
        });
      }),
    );
    const p = callUpstream(primaryCfg, PAYLOAD, controller.signal);
    setTimeout(() => controller.abort(new Error('timeout')), 20);
    const r = await p;
    // 429 即使正文读取失败仍按额度类处理，但总请求被超时封顶，不会挂起
    expect(r).toMatchObject({
      ok: false,
      status: 429,
      quotaFailure: true,
      outcome: 'quota-fallback',
      errorCategory: 'Error',
    });
    vi.unstubAllGlobals();
  });
});

describe('recognizeWithFallback（双上游 fallback 编排）', () => {
  it('OpenCode Go 返回 429 → 自动 fallback 到直连 DeepSeek，并返回同样结构化内容', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        calls.push(String(url));
        if (String(url).includes('api.deepseek.com')) return okContent('{"items":[{"name":"x"}]}');
        return statusBody(429, 'rate limit');
      }),
    );
    const r = await recognizeWithFallback(primaryCfg, deepSeekCfg('ds-key'), PAYLOAD, SIGNAL);
    expect(r).toEqual({ content: '{"items":[{"name":"x"}]}' });
    expect(calls.length).toBe(2);
    expect(calls[0]).toBe(OPENCODE_ENDPOINT);
    expect(calls[1]).toBe('https://api.deepseek.com/chat/completions');
    vi.unstubAllGlobals();
  });

  it('OpenCode Go 正文含额度关键词（500 + quota exhausted）→ fallback', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        calls.push(String(url));
        if (String(url).includes('api.deepseek.com')) return okContent('{"items":[]}');
        return statusBody(500, 'quota exhausted');
      }),
    );
    const r = await recognizeWithFallback(primaryCfg, deepSeekCfg('ds-key'), PAYLOAD, SIGNAL);
    expect(r).toEqual({ content: '{"items":[]}' });
    expect(calls.length).toBe(2);
    vi.unstubAllGlobals();
  });

  it('OpenCode Go 普通 500（非额度）→ 不 fallback，原样返回 500', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        calls.push(String(url));
        return statusBody(500, 'internal error');
      }),
    );
    const r = await recognizeWithFallback(primaryCfg, deepSeekCfg('ds-key'), PAYLOAD, SIGNAL);
    expect(r).toEqual({ status: 500 });
    expect(calls.length).toBe(1);
    vi.unstubAllGlobals();
  });

  it('401/403/502/504 等其它错误 → 不 fallback', async () => {
    for (const [status, body] of [
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [502, 'bad gateway'],
      [504, 'upstream timeout'],
    ] as Array<[number, string]>) {
      const calls: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: unknown) => {
          calls.push(String(url));
          return statusBody(status, body);
        }),
      );
      const r = await recognizeWithFallback(primaryCfg, deepSeekCfg('ds-key'), PAYLOAD, SIGNAL);
      expect(r).toEqual({ status });
      expect(calls.length).toBe(1);
      vi.unstubAllGlobals();
    }
  });

  it('未配置 DEEPSEEK_API_KEY → 即使 429 也不启用 fallback', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        calls.push(String(url));
        return statusBody(429, 'rate limit');
      }),
    );
    const r = await recognizeWithFallback(primaryCfg, deepSeekCfg(''), PAYLOAD, SIGNAL);
    expect(r).toEqual({ status: 429 });
    expect(calls.length).toBe(1);
    vi.unstubAllGlobals();
  });

  it('fallback 备上游也失败 → 返回备上游状态（不再二次 fallback）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        if (String(url).includes('api.deepseek.com')) return statusBody(500, 'internal');
        return statusBody(429, 'rate limit');
      }),
    );
    const r = await recognizeWithFallback(primaryCfg, deepSeekCfg('ds-key'), PAYLOAD, SIGNAL);
    expect(r).toEqual({ status: 500 });
    vi.unstubAllGlobals();
  });

  it('主上游 2xx 成功 → 不调用备上游', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        calls.push(String(url));
        return okContent('{"items":[]}');
      }),
    );
    const r = await recognizeWithFallback(primaryCfg, deepSeekCfg('ds-key'), PAYLOAD, SIGNAL);
    expect(r).toEqual({ content: '{"items":[]}' });
    expect(calls.length).toBe(1);
    vi.unstubAllGlobals();
  });

  it('共享 AbortController 超时中断 → fallback 整体返回 504（总请求不无限等待）', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          if (init.signal?.aborted) reject(init.signal.reason);
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      }),
    );
    const p = recognizeWithFallback(primaryCfg, deepSeekCfg('ds-key'), PAYLOAD, controller.signal);
    setTimeout(() => controller.abort(new Error('timeout')), 20);
    const r = await p;
    expect(r).toEqual({ status: 504 });
    vi.unstubAllGlobals();
  });
});

describe('recognizeWithFallbackDebug（安全 debug 元信息，不泄露密钥）', () => {
  it('主上游为 DeepSeek（name=deepseek）时：成功则只调 DeepSeek，标签正确', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        calls.push(String(url));
        return okContent('{"items":[]}');
      }),
    );
    const { result, debug } = await recognizeWithFallbackDebug(
      deepSeekCfg('ds-key'),
      primaryCfg,
      PAYLOAD,
      SIGNAL,
    );
    expect(result).toEqual({ content: '{"items":[]}' });
    expect(calls).toEqual(['https://api.deepseek.com/chat/completions']);
    expect(debug.upstreamTried).toEqual(['deepseek']);
    expect(debug.selectedUpstream).toBe('deepseek');
    expect(debug.failedUpstream).toBeNull();
    vi.unstubAllGlobals();
  });

  it('主上游 DeepSeek 额度类失败 → 回退到 opencode-go，标签与 fallbackReason 正确', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        calls.push(String(url));
        if (String(url).includes('opencode.ai')) return okContent('{"items":[{"name":"y"}]}');
        return statusBody(429, 'rate limit');
      }),
    );
    const { result, debug } = await recognizeWithFallbackDebug(
      deepSeekCfg('ds-key'),
      primaryCfg,
      PAYLOAD,
      SIGNAL,
    );
    expect(result).toEqual({ content: '{"items":[{"name":"y"}]}' });
    expect(calls).toEqual([
      'https://api.deepseek.com/chat/completions',
      OPENCODE_ENDPOINT,
    ]);
    expect(debug.upstreamTried).toEqual(['deepseek', 'opencode-go']);
    expect(debug.selectedUpstream).toBe('opencode-go');
    expect(debug.failedUpstream).toBe('deepseek');
    expect(debug.fallbackReason).toBe('quota');
    vi.unstubAllGlobals();
  });

  it('主上游成功：upstreamTried=[' + "'opencode-go'" + ']，selectedUpstream=opencode-go，无 failed/fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okContent('{"items":[]}')),
    );
    const { result, debug } = await recognizeWithFallbackDebug(
      primaryCfg,
      deepSeekCfg('ds-key'),
      PAYLOAD,
      SIGNAL,
    );
    expect(result).toEqual({ content: '{"items":[]}' });
    expect(debug.upstreamTried).toEqual(['opencode-go']);
    expect(debug.selectedUpstream).toBe('opencode-go');
    expect(debug.failedUpstream).toBeNull();
    expect(debug.fallbackReason).toBeNull();
    expect(debug.durationMs).toBeGreaterThanOrEqual(0);
    // 主上游（OpenCode Go）也能显示其请求模型名与请求地址（安全字段）
    expect(debug.selectedUpstreamModel).toBe('deepseek-v4-flash');
    expect(debug.selectedUpstreamEndpoint).toBe(
      'https://opencode.ai/zen/go/v1/chat/completions',
    );
    expect(debug.attempts[0]).toMatchObject({
      upstream: 'opencode-go',
      model: 'deepseek-v4-flash',
      endpoint: 'https://opencode.ai/zen/go/v1/chat/completions',
    });
    vi.unstubAllGlobals();
  });

  it('额度类失败回退到 DeepSeek 成功：upstreamTried 含两者，selected=deepseek，failed=opencode-go，fallbackReason=quota', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        if (String(url).includes('api.deepseek.com')) return okContent('{"items":[{"name":"x"}]}');
        return statusBody(429, 'rate limit');
      }),
    );
    const { result, debug } = await recognizeWithFallbackDebug(
      primaryCfg,
      deepSeekCfg('ds-key'),
      PAYLOAD,
      SIGNAL,
    );
    expect(result).toEqual({ content: '{"items":[{"name":"x"}]}' });
    expect(debug.upstreamTried).toEqual(['opencode-go', 'deepseek']);
    expect(debug.selectedUpstream).toBe('deepseek');
    expect(debug.failedUpstream).toBe('opencode-go');
    expect(debug.fallbackReason).toBe('quota');
    // 默认直连 DeepSeek fallback：安全 debug 中能看到请求模型名与请求地址
    expect(debug.selectedUpstreamModel).toBe('deepseek-v4-flash');
    expect(debug.selectedUpstreamEndpoint).toBe('https://api.deepseek.com/chat/completions');
    expect(debug.attempts[1]).toMatchObject({
      upstream: 'deepseek',
      model: 'deepseek-v4-flash',
      endpoint: 'https://api.deepseek.com/chat/completions',
    });
    // debug 不含任何密钥/鉴权信息
    const json = JSON.stringify(debug);
    expect(json).not.toContain('oc-key');
    expect(json).not.toContain('ds-key');
    expect(json.toLowerCase()).not.toContain('authorization');
    expect(json.toLowerCase()).not.toContain('bearer');
    vi.unstubAllGlobals();
  });

  it('非额度错误不 fallback：failedUpstream=opencode-go，selected=null，fallbackReason=null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => statusBody(500, 'internal error')),
    );
    const { result, debug } = await recognizeWithFallbackDebug(
      primaryCfg,
      deepSeekCfg('ds-key'),
      PAYLOAD,
      SIGNAL,
    );
    expect(result).toEqual({ status: 500 });
    expect(debug.upstreamTried).toEqual(['opencode-go']);
    expect(debug.selectedUpstream).toBeNull();
    expect(debug.failedUpstream).toBe('opencode-go');
    expect(debug.fallbackReason).toBeNull();
    vi.unstubAllGlobals();
  });

  it('回退后备上游也失败：failedUpstream=deepseek，selected=null，fallbackReason=quota', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        if (String(url).includes('api.deepseek.com')) return statusBody(500, 'internal');
        return statusBody(429, 'rate limit');
      }),
    );
    const { result, debug } = await recognizeWithFallbackDebug(
      primaryCfg,
      deepSeekCfg('ds-key'),
      PAYLOAD,
      SIGNAL,
    );
    expect(result).toEqual({ status: 500 });
    expect(debug.upstreamTried).toEqual(['opencode-go', 'deepseek']);
    expect(debug.selectedUpstream).toBeNull();
    expect(debug.failedUpstream).toBe('deepseek');
    expect(debug.fallbackReason).toBe('quota');
    vi.unstubAllGlobals();
  });

  it('debug 字段枚举安全：只含白名单字段名，不含 apiKey/authHeader/authValue/sk-', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okContent('x')),
    );
    const { debug } = await recognizeWithFallbackDebug(
      primaryCfg,
      deepSeekCfg('ds-key'),
      PAYLOAD,
      SIGNAL,
    );
    const json = JSON.stringify(debug);
    // 安全字段（模型名/请求地址）被展示；鉴权/密钥类字段绝不出现
    expect(json).toContain('deepseek-v4-flash');
    expect(json).toContain('https://opencode.ai/zen/go/v1/chat/completions');
    for (const forbidden of ['apiKey', 'authHeader', 'authValue', 'sk-', 'Bearer oc-key', 'Bearer ds-key']) {
      expect(json).not.toContain(forbidden);
    }
    vi.unstubAllGlobals();
  });

  it('OpenCode quota→DeepSeek timeout：attempts 显示 opencode quota-fallback、deepseek timeout、finalFailureReason timeout', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown, init: RequestInit) => {
        if (String(url).includes('api.deepseek.com')) {
          return new Promise<Response>((_resolve, reject) => {
            if (init.signal?.aborted) reject(init.signal.reason);
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          });
        }
        return Promise.resolve(statusBody(429, 'rate limit'));
      }),
    );
    const p = recognizeWithFallbackDebug(
      primaryCfg,
      deepSeekCfg('ds-key'),
      PAYLOAD,
      controller.signal,
    );
    setTimeout(() => controller.abort(new Error('timeout')), 20);
    const { result, debug } = await p;
    expect(result).toEqual({ status: 504 });
    expect(debug.upstreamTried).toEqual(['opencode-go', 'deepseek']);
    expect(debug.fallbackReason).toBe('quota');
    expect(debug.attempts[0]).toMatchObject({
      upstream: 'opencode-go',
      status: 429,
      outcome: 'quota-fallback',
    });
    expect(debug.attempts[1]).toMatchObject({ upstream: 'deepseek', outcome: 'timeout' });
    expect(debug.finalFailureReason).toBe('timeout');
    expect(debug.finalStatus).toBe(504);
    // 不含密钥/鉴权信息
    expect(JSON.stringify(debug)).not.toContain('ds-key');
    expect(JSON.stringify(debug)).not.toContain('oc-key');
    vi.unstubAllGlobals();
  });

  it('DeepSeek 401/403/500：attempts 显示 deepseek http-error + status，finalFailureReason=http-error', async () => {
    for (const [status, body] of [
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [500, 'internal error'],
    ] as Array<[number, string]>) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: unknown) => {
          if (String(url).includes('api.deepseek.com')) return statusBody(status, body);
          return statusBody(429, 'rate limit');
        }),
      );
      const { result, debug } = await recognizeWithFallbackDebug(
        primaryCfg,
        deepSeekCfg('ds-key'),
        PAYLOAD,
        SIGNAL,
      );
      expect(result).toEqual({ status });
      expect(debug.attempts[0]).toMatchObject({
        upstream: 'opencode-go',
        outcome: 'quota-fallback',
      });
      expect(debug.attempts[1]).toMatchObject({
        upstream: 'deepseek',
        status,
        outcome: 'http-error',
      });
      expect(debug.failedUpstream).toBe('deepseek');
      expect(debug.finalFailureReason).toBe('http-error');
      expect(debug.finalStatus).toBe(status);
      vi.unstubAllGlobals();
    }
  });

  it('网络错误：attempts 显示 opencode network-error，finalFailureReason=network-error，不 fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const { result, debug } = await recognizeWithFallbackDebug(
      primaryCfg,
      deepSeekCfg('ds-key'),
      PAYLOAD,
      SIGNAL,
    );
    expect(result).toEqual({ status: 502 });
    expect(debug.upstreamTried).toEqual(['opencode-go']);
    expect(debug.fallbackReason).toBeNull();
    expect(debug.attempts[0]).toMatchObject({
      upstream: 'opencode-go',
      status: 502,
      outcome: 'network-error',
    });
    expect(debug.failedUpstream).toBe('opencode-go');
    expect(debug.finalFailureReason).toBe('network-error');
    expect(debug.finalStatus).toBe(502);
    vi.unstubAllGlobals();
  });

  it('quota→DeepSeek http-error 时 debug sanitizer 仍丢弃敏感字段', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        if (String(url).includes('api.deepseek.com')) return statusBody(500, 'internal');
        return statusBody(429, 'rate limit');
      }),
    );
    const { debug } = await recognizeWithFallbackDebug(
      primaryCfg,
      deepSeekCfg('ds-key'),
      PAYLOAD,
      SIGNAL,
    );
    const json = JSON.stringify(debug);
    for (const forbidden of ['apiKey', 'authHeader', 'authValue', 'ds-key', 'oc-key', 'sk-']) {
      expect(json).not.toContain(forbidden);
    }
    // 安全字段（模型名/请求地址）被展示
    expect(json).toContain('deepseek-v4-flash');
    expect(json).toContain('https://api.deepseek.com/chat/completions');
    expect(json.toLowerCase()).not.toContain('authorization');
    expect(json.toLowerCase()).not.toContain('bearer');
    vi.unstubAllGlobals();
  });

  it('每上游独立超时预算：quota→DeepSeek timeout 总耗时≈DeepSeek 预算，不再等 60s', async () => {
    const deepseekBudget = 40;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown, init: RequestInit) => {
        if (String(url).includes('api.deepseek.com')) {
          // 挂起直到被 DeepSeek 自身独立超时中断
          return new Promise<Response>((_resolve, reject) => {
            if (init.signal?.aborted) reject(init.signal.reason);
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          });
        }
        return Promise.resolve(statusBody(429, 'rate limit'));
      }),
    );
    const startedAt = Date.now();
    const { result, debug } = await recognizeWithFallbackDebug(
      primaryCfg,
      deepSeekCfg('ds-key'),
      PAYLOAD,
      SIGNAL,
      { primaryTimeoutMs: 10, fallbackTimeoutMs: deepseekBudget },
    );
    const total = Date.now() - startedAt;
    expect(result).toEqual({ status: 504 });
    expect(debug.fallbackReason).toBe('quota');
    expect(debug.finalFailureReason).toBe('timeout');
    expect(debug.finalStatus).toBe(504);
    // opencode 快速 quota 失败（不等待 20s 预算）
    expect(debug.attempts[0].durationMs).toBeLessThan(20);
    expect(debug.attempts[0].outcome).toBe('quota-fallback');
    // deepseek 按其自身预算超时，而非吃满剩余 60s
    expect(debug.attempts[1].durationMs).toBeGreaterThanOrEqual(deepseekBudget - 10);
    expect(debug.attempts[1].outcome).toBe('timeout');
    // 总耗时 ≈ 主(快) + DeepSeek 预算，远小于 60s
    expect(total).toBeLessThan(deepseekBudget + 40);
    expect(total).toBeGreaterThanOrEqual(deepseekBudget - 10);
    expect(debug.durationMs).toBeLessThan(deepseekBudget + 40);
    vi.unstubAllGlobals();
  });

  it('每上游独立超时预算：主上游超时（非 quota）不 fallback，总耗时≈主预算', async () => {
    const primaryBudget = 30;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          if (init.signal?.aborted) reject(init.signal.reason);
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      }),
    );
    const startedAt = Date.now();
    const { result, debug } = await recognizeWithFallbackDebug(
      primaryCfg,
      deepSeekCfg('ds-key'),
      PAYLOAD,
      SIGNAL,
      { primaryTimeoutMs: primaryBudget, fallbackTimeoutMs: 100 },
    );
    const total = Date.now() - startedAt;
    expect(result).toEqual({ status: 504 });
    expect(debug.upstreamTried).toEqual(['opencode-go']);
    expect(debug.fallbackReason).toBeNull();
    expect(debug.finalFailureReason).toBe('timeout');
    expect(debug.attempts[0].durationMs).toBeGreaterThanOrEqual(primaryBudget - 10);
    expect(debug.attempts[0].outcome).toBe('timeout');
    expect(total).toBeLessThan(primaryBudget + 40);
    expect(total).toBeGreaterThanOrEqual(primaryBudget - 10);
    vi.unstubAllGlobals();
  });

  it('外层 signal 中断仍能提前中断内层（整体硬封顶仍生效）', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          if (init.signal?.aborted) reject(init.signal.reason);
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      }),
    );
    const p = recognizeWithFallbackDebug(
      primaryCfg,
      deepSeekCfg('ds-key'),
      PAYLOAD,
      controller.signal,
      { primaryTimeoutMs: 5000, fallbackTimeoutMs: 5000 },
    );
    setTimeout(() => controller.abort(new Error('outer timeout')), 20);
    const { result, debug } = await p;
    expect(result).toEqual({ status: 504 });
    expect(debug.finalFailureReason).toBe('timeout');
    expect(debug.attempts[0].durationMs).toBeLessThan(1000);
    vi.unstubAllGlobals();
  });
});
