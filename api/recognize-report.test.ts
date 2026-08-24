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
