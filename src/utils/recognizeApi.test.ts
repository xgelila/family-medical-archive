import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RECOGNIZE_TIMEOUT_MS,
  parseRecognizedText,
  RECOGNIZE_API_PATH,
  StructureError,
} from './recognizeApi';

/**
 * 「识别数据」客户端（同源代理）测试：
 * - 请求只发往同源 /api/recognize-report，请求体仅含 { text }，无任何密钥/服务端配置；
 * - 成功时优先使用代理精简响应 { content }，并兼容旧式 choices[0].message.content；
 * - 失败时按 HTTP 状态/网络/超时映射为自然语言中文错误，绝不泄露技术栈名称/Key/正文。
 */

function okReply(content = '{"items":[]}'): Response {
  return new Response(JSON.stringify({ content }), { status: 200 });
}

// 模块级捕获（避免 let + 闭包赋值导致的类型收窄问题）
const lastRequest = {
  url: '' as string,
  init: null as RequestInit | null,
};

function readCapturedBody(): Record<string, unknown> {
  const init = lastRequest.init;
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('生产 API 路径源级契约', () => {
  it('生产与开发都使用同源绝对 API 路径，且不依赖本地代理文案', async () => {
    expect(RECOGNIZE_API_PATH).toBe('/api/recognize-report');
    const source = await import('node:fs').then(({ readFileSync }) =>
      readFileSync(new URL('./recognizeApi.ts', import.meta.url), 'utf8'),
    );
    expect(source).toContain("fetch(RECOGNIZE_API_PATH");
    expect(source).not.toContain('仅本机开发模式支持');
  });
});

describe('parseRecognizedText（同源代理）', () => {
  it('只请求同源 /api/recognize-report；请求体只含 { text, mode }，不带任何鉴权头', async () => {
    lastRequest.url = '';
    lastRequest.init = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init: unknown) => {
        lastRequest.url = String(url);
        lastRequest.init = init as RequestInit;
        return okReply();
      }),
    );
    const reply = await parseRecognizedText('血红蛋白 145 g/L');
    expect(reply.content).toBe('{"items":[]}');
    const captured = lastRequest;
    expect(captured.url).toBe('/api/recognize-report');
    const init = captured.init;
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['text', 'mode']);
    expect(body.text).toBe('血红蛋白 145 g/L');
    expect(body.mode).toBe('items');
    // 客户端绝不携带任何鉴权信息（Authorization / X-API-Key 等）
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const joined = Object.entries(headers)
      .map(([k, v]) => `${k}:${v}`)
      .join('|');
    expect(joined.toLowerCase()).not.toContain('authorization');
    expect(joined.toLowerCase()).not.toContain('api-key');
  });

  it('report 模式只发 { text, mode }，绝不携带目录/别名/标签映射', async () => {
    lastRequest.url = '';
    lastRequest.init = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init: unknown) => {
        lastRequest.url = String(url);
        lastRequest.init = init as RequestInit;
        return okReply();
      }),
    );
    const reply = await parseRecognizedText('xx', {
      mode: 'report',
    });
    expect(reply.content).toBe('{"items":[]}');
    const body = readCapturedBody();
    expect(body.mode).toBe('report');
    expect(Object.keys(body)).toEqual(['text', 'mode']);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('catalog');
    expect(raw).not.toContain('labelMappings');
    expect(raw).not.toContain('api_key');
    expect(raw).not.toContain('authorization');
  });

  it('空文本直接拒绝（bad-reply），不发请求', async () => {
    const spy = vi.fn(async () => okReply());
    vi.stubGlobal('fetch', spy);
    await expect(parseRecognizedText('   ')).rejects.toMatchObject({
      kind: 'bad-reply',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('代理精简响应 { content } 直接作为结果；其它字段（model/usage）不参与透传', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ content: '{"items":[]}', usage: { total_tokens: 9 } }), {
            status: 200,
          }),
      ),
    );
    const reply = await parseRecognizedText('血红蛋白');
    expect(reply.content).toBe('{"items":[]}');
  });

  it('兼容旧式完整 choices 响应（choices[0].message.content）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: '兼容成功' } }] }), {
            status: 200,
          }),
      ),
    );
    const reply = await parseRecognizedText('血红蛋白');
    expect(reply.content).toBe('兼容成功');
  });

  it('401/403 → 自然语言错误，不包含技术栈名称与 Key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    );
    const e = await parseRecognizedText('x').catch((err: unknown) => err);
    expect(e).toBeInstanceOf(StructureError);
    const err = e as StructureError;
    expect(err.kind).toBe('http');
    expect(err.status).toBe(401);
    expect(err.message).not.toContain('OpenCode');
    expect(err.message).not.toContain('DeepSeek');
    expect(err.message).not.toContain('sk-');
    expect(err.message).not.toContain('Authorization');
  });

  it('413 → 提示内容过大', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('too large', { status: 413 })),
    );
    const err = (await parseRecognizedText('x').catch((e: unknown) => e)) as StructureError;
    expect(err.status).toBe(413);
    expect(err.message).toContain('过大');
  });

  it('429 → 提示过频', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('limit', { status: 429 })),
    );
    const err = (await parseRecognizedText('x').catch((e: unknown) => e)) as StructureError;
    expect(err.status).toBe(429);
    expect(err.message).toContain('频繁');
  });

  it('503 且代理返回清洗后的 message → 直接展示该 message（不泄露密钥/技术栈）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { message: '识别功能尚未启用：请在本机配置服务密钥后重启。', status: 503 },
            }),
            { status: 503 },
          ),
      ),
    );
    const err = (await parseRecognizedText('x').catch((e: unknown) => e)) as StructureError;
    expect(err.status).toBe(503);
    expect(err.message).toContain('识别功能尚未启用');
    expect(err.message).not.toContain('OPENCODE');
    expect(err.message).not.toContain('sk-');
  });

  it('上游 200 但无有效 content → bad-reply', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })),
    );
    const err = (await parseRecognizedText('x').catch((e: unknown) => e)) as StructureError;
    expect(err.kind).toBe('bad-reply');
    expect(err.message).not.toContain('[object');
  });

  it('网络失败 → network 类自然语言错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const err = (await parseRecognizedText('x').catch((e: unknown) => e)) as StructureError;
    expect(err.kind).toBe('network');
    expect(err.message).toContain('网络');
    expect(err.message).not.toContain('Failed to fetch');
  });

  it('超时 → timeout 类自然语言错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      }),
    );
    const err = (await parseRecognizedText('x', { timeoutMs: 30 }).catch(
      (e: unknown) => e,
    )) as StructureError | null;
    expect(err).toBeInstanceOf(StructureError);
    expect(err?.kind).toBe('timeout');
    expect(err?.message).toContain('超时');
  });

  it('客户端默认超时（70s）略长于服务端 60s，保证服务端先返回清洗错误', () => {
    expect(DEFAULT_RECOGNIZE_TIMEOUT_MS).toBe(70_000);
    expect(DEFAULT_RECOGNIZE_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('2xx 但响应正文读取卡住被超时中断 → 仍报 timeout（而非笼统整理失败）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init: RequestInit) => {
        // 模拟：状态 2xx 但 json() 一直不返回，直到被 AbortController 中断
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            new Promise<unknown>((_resolve, reject) => {
              if (init.signal?.aborted) reject(init.signal.reason);
              init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
            }),
        });
      }),
    );
    const err = (await parseRecognizedText('x', { timeoutMs: 30 }).catch(
      (e: unknown) => e,
    )) as StructureError | null;
    expect(err).toBeInstanceOf(StructureError);
    expect(err?.kind).toBe('timeout');
    expect(err?.message).toContain('超时');
    expect(err?.message).not.toContain('[object');
  });
});

describe('parseRecognizedText · debug 元信息（安全，不泄露密钥/headers/正文）', () => {
  it('成功：返回包含客户端 debug 与服务端安全 debug（selectedUpstream/upstreamTried/durationMs）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              content: '{"items":[{"name":"x"}]}',
              debug: {
                upstreamTried: ['opencode-go'],
                selectedUpstream: 'opencode-go',
                failedUpstream: null,
                fallbackReason: null,
                durationMs: 812,
              },
            }),
            { status: 200 },
          ),
      ),
    );
    const reply = await parseRecognizedText('血红蛋白');
    expect(reply.content).toContain('items');
    expect(reply.debug).toBeDefined();
    expect(reply.debug?.status).toBe(200);
    expect(reply.debug?.timeout).toBe(false);
    expect(reply.debug?.durationMs).toBeGreaterThanOrEqual(0);
    expect(reply.debug?.startedAt).toBeLessThanOrEqual(reply.debug!.finishedAt);
    // 服务端 debug 被安全透传
    expect(reply.debug?.server?.selectedUpstream).toBe('opencode-go');
    expect(reply.debug?.server?.upstreamTried).toEqual(['opencode-go']);
    expect(reply.debug?.server?.durationMs).toBe(812);
    // debug 绝不携带任何鉴权/密钥/请求头
    const json = JSON.stringify(reply.debug);
    expect(json.toLowerCase()).not.toContain('authorization');
    expect(json.toLowerCase()).not.toContain('api-key');
    expect(json.toLowerCase()).not.toContain('sk-');
    expect(json.toLowerCase()).not.toContain('bearer');
  });

  it('成功：服务端回退到 DeepSeek 时透传 selectedUpstream=deepseek 与 fallbackReason=quota', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              content: '{"items":[]}',
              debug: {
                upstreamTried: ['opencode-go', 'deepseek'],
                selectedUpstream: 'deepseek',
                failedUpstream: 'opencode-go',
                fallbackReason: 'quota',
                durationMs: 900,
              },
            }),
            { status: 200 },
          ),
      ),
    );
    const reply = await parseRecognizedText('x');
    expect(reply.debug?.server?.selectedUpstream).toBe('deepseek');
    expect(reply.debug?.server?.upstreamTried).toEqual(['opencode-go', 'deepseek']);
    expect(reply.debug?.server?.failedUpstream).toBe('opencode-go');
    expect(reply.debug?.server?.fallbackReason).toBe('quota');
    expect(JSON.stringify(reply.debug)).not.toContain('api_key');
  });

  it('错误：StructureError 携带 debug（HTTP 状态、错误码、清洗错误、服务端 debug）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { message: '识别服务暂时无法连接，请稍后重试。', status: 502 },
              debug: {
                upstreamTried: ['opencode-go'],
                selectedUpstream: null,
                selectedUpstreamModel: null,
                selectedUpstreamEndpoint: null,
                failedUpstream: 'opencode-go',
                fallbackReason: null,
                durationMs: 120,
              },
            }),
            { status: 502 },
          ),
      ),
    );
    const err = (await parseRecognizedText('x').catch((e: unknown) => e)) as StructureError;
    expect(err).toBeInstanceOf(StructureError);
    expect(err.kind).toBe('http');
    expect(err.status).toBe(502);
    expect(err.debug).toBeDefined();
    expect(err.debug?.status).toBe(502);
    expect(err.debug?.errorCode).toBe('http');
    expect(err.debug?.errorMessage).toContain('暂时无法连接');
    expect(err.debug?.server?.failedUpstream).toBe('opencode-go');
    expect(err.debug?.server?.selectedUpstream).toBeNull();
    expect(err.debug?.server?.selectedUpstreamModel).toBeNull();
    expect(err.debug?.server?.selectedUpstreamEndpoint).toBeNull();
    const json = JSON.stringify(err.debug);
    expect(json.toLowerCase()).not.toContain('authorization');
    expect(json.toLowerCase()).not.toContain('api-key');
    expect(json.toLowerCase()).not.toContain('sk-');
  });

  it('网络失败：debug 不含 status/headers，errorCode=network', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const err = (await parseRecognizedText('x').catch((e: unknown) => e)) as StructureError;
    expect(err.kind).toBe('network');
    expect(err.debug?.status).toBeNull();
    expect(err.debug?.errorCode).toBe('network');
    expect(err.debug?.timeout).toBe(false);
    expect(JSON.stringify(err.debug).toLowerCase()).not.toContain('authorization');
    expect(JSON.stringify(err.debug).toLowerCase()).not.toContain('api-key');
  });

  it('超时：debug 标记 timeout=true，status 为中断时状态或 null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      }),
    );
    const err = (await parseRecognizedText('x', { timeoutMs: 30 }).catch(
      (e: unknown) => e,
    )) as StructureError | null;
    expect(err?.kind).toBe('timeout');
    expect(err?.debug?.timeout).toBe(true);
    expect(err?.debug?.errorCode).toBe('timeout');
    expect(JSON.stringify(err?.debug).toLowerCase()).not.toContain('authorization');
  });

  it('空文本（bad-reply）也携带 debug：status=null，errorCode=bad-reply，供调试面板第二步展示失败', async () => {
    const spy = vi.fn(async () => okReply());
    vi.stubGlobal('fetch', spy);
    const err = (await parseRecognizedText('   ').catch((e: unknown) => e)) as StructureError;
    expect(err.kind).toBe('bad-reply');
    expect(spy).not.toHaveBeenCalled();
    expect(err.debug).toBeDefined();
    expect(err.debug?.status).toBeNull();
    expect(err.debug?.errorCode).toBe('bad-reply');
    expect(err.debug?.timeout).toBe(false);
    expect(JSON.stringify(err.debug).toLowerCase()).not.toContain('authorization');
    expect(JSON.stringify(err.debug).toLowerCase()).not.toContain('api-key');
  });

  it('所有错误分支均携带 debug（HTTP 状态/超时标记/错误码），确保第 2 步不会被静默清空', async () => {
    // 网络错误
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('boom'))),
    );
    const net = (await parseRecognizedText('x').catch((e: unknown) => e)) as StructureError;
    expect(net.debug?.errorCode).toBe('network');
    expect(net.debug?.timeout).toBe(false);
    // 非 2xx
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad', { status: 500 })),
    );
    const http = (await parseRecognizedText('x').catch((e: unknown) => e)) as StructureError;
    expect(http.debug?.errorCode).toBe('http');
    expect(http.debug?.status).toBe(500);
    // 超时
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      }),
    );
    const time = (await parseRecognizedText('x', { timeoutMs: 30 }).catch(
      (e: unknown) => e,
    )) as StructureError;
    expect(time.debug?.errorCode).toBe('timeout');
    expect(time.debug?.timeout).toBe(true);
    // 成功
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okReply('{"items":[]}')),
    );
    const ok = await parseRecognizedText('x');
    expect(ok.debug?.status).toBe(200);
    expect(ok.debug?.timeout).toBe(false);
    expect(ok.debug?.errorCode).toBeNull();
    expect(ok.debug?.errorMessage).toBeNull();
  });

  it('服务端 debug 只透传白名单字段：额外字段（token/usage/key）被忽略', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              content: 'ok',
              debug: {
                upstreamTried: ['opencode-go'],
                selectedUpstream: 'opencode-go',
                selectedUpstreamModel: 'deepseek-v4-flash',
                selectedUpstreamEndpoint: 'https://opencode.ai/zen/go/v1/chat/completions',
                failedUpstream: null,
                fallbackReason: null,
                durationMs: 5,
                apiKey: 'should-not-leak',
                authHeader: 'Authorization',
              },
            }),
            { status: 200 },
          ),
      ),
    );
    const reply = await parseRecognizedText('x');
    const server = reply.debug?.server;
    // 白名单外的字段被丢弃
    expect(server).not.toHaveProperty('apiKey');
    expect(server).not.toHaveProperty('authHeader');
    // 安全白名单字段（模型名/请求地址）被展示
    expect(server?.selectedUpstreamModel).toBe('deepseek-v4-flash');
    expect(server?.selectedUpstreamEndpoint).toBe('https://opencode.ai/zen/go/v1/chat/completions');
    const json = JSON.stringify(reply.debug);
    expect(json).not.toContain('should-not-leak');
    expect(json.toLowerCase()).not.toContain('authorization');
  });

  it('服务端 debug 透传 attempts 时间线与 finalFailureReason，并丢弃 attempts 内敏感字段', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              content: 'ok',
              debug: {
                upstreamTried: ['opencode-go', 'deepseek'],
                selectedUpstream: null,
                selectedUpstreamModel: null,
                selectedUpstreamEndpoint: null,
                failedUpstream: 'deepseek',
                fallbackReason: 'quota',
                durationMs: 60000,
                attempts: [
                  {
                    upstream: 'opencode-go',
                    model: 'deepseek-v4-flash',
                    endpoint: 'https://opencode.ai/zen/go/v1/chat/completions',
                    status: 429,
                    durationMs: 120,
                    outcome: 'quota-fallback',
                  },
                  {
                    upstream: 'deepseek',
                    model: 'deepseek-v4-flash',
                    endpoint: 'https://api.deepseek.com/chat/completions',
                    status: 504,
                    durationMs: 59880,
                    outcome: 'timeout',
                    errorCategory: 'AbortError',
                    apiKey: 'should-not-leak',
                  },
                ],
                finalFailureReason: 'timeout',
                finalStatus: 504,
              },
            }),
            { status: 502 },
          ),
      ),
    );
    const err = (await parseRecognizedText('x').catch((e: unknown) => e)) as StructureError;
    const server = err.debug?.server;
    expect(server).not.toBeNull();
    expect(server?.attempts).toHaveLength(2);
    expect(server?.attempts[0]).toEqual({
      upstream: 'opencode-go',
      model: 'deepseek-v4-flash',
      endpoint: 'https://opencode.ai/zen/go/v1/chat/completions',
      status: 429,
      durationMs: 120,
      outcome: 'quota-fallback',
    });
    expect(server?.attempts[1]).toEqual({
      upstream: 'deepseek',
      model: 'deepseek-v4-flash',
      endpoint: 'https://api.deepseek.com/chat/completions',
      status: 504,
      durationMs: 59880,
      outcome: 'timeout',
      errorCategory: 'AbortError',
    });
    expect(server?.finalFailureReason).toBe('timeout');
    expect(server?.finalStatus).toBe(504);
    // 安全字段（模型名/请求地址）被展示；仅 attempts 内的敏感字段（apiKey）被 sanitizer 丢弃
    const json = JSON.stringify(err.debug);
    expect(json).not.toContain('should-not-leak');
    expect(json).toContain('api.deepseek.com/chat/completions');
    expect(json).toContain('deepseek-v4-flash');
    expect(json).not.toContain('apiKey');
    expect(json.toLowerCase()).not.toContain('authorization');
    expect(json.toLowerCase()).not.toContain('bearer');
  });
});
