import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from './recognize-report';

function response() {
  const result = {
    statusCode: 0,
    body: undefined as unknown,
  };
  const res = {
    status(code: number) {
      result.statusCode = code;
      return this;
    },
    json(body: unknown) {
      result.body = body;
      return this;
    },
  };
  return { result, res };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('recognize report Vercel handler', () => {
  it('ignores legacy endpoint, model, and auth overrides in production', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key');
    vi.stubEnv('DEEPSEEK_ENDPOINT', 'https://evil.example/v1');
    vi.stubEnv('DEEPSEEK_MODEL', 'wrong-model');
    vi.stubEnv('DEEPSEEK_AUTH_HEADER', 'X-Api-Key');
    vi.stubEnv('DEEPSEEK_AUTH_SCHEME', 'Basic');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{}'} }] }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result, res } = response();
    await handler({ method: 'POST', headers: {}, body: { text: 'test' } } as never, res as never);
    expect(result.statusCode).toBe(200);
    const [target, options] = fetchMock.mock.calls[0];
    expect(target).toBe('https://api.deepseek.com/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer test-key');
    expect(options.headers['X-Api-Key']).toBeUndefined();
    expect(JSON.parse(options.body).model).toBe('deepseek-v4-flash');
  });

  it('loads with a static shared-service import and returns structured 400 for POST {}', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '');
    const { result, res } = response();

    await handler(
      { method: 'POST', headers: {}, body: {} } as never,
      res as never,
    );

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      errorCode: 'INVALID_TEXT',
      error: { code: 'INVALID_TEXT', status: 400 },
    });
  });
});
