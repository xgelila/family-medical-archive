import { describe, expect, it, vi } from 'vitest';
import { createConfiguredOcrEngine, type OcrEngine, type OcrEngineFactory } from './ocrEngine';
import { LocalOcrSession } from './ocr';

/**
 * Tesseract 单一 OCR 引擎工厂测试。
 * - 断言是接口/结构层面的（Node 环境无法真正初始化浏览器 worker）；
 * - 覆盖：工厂返回统一接口、create 路由到既有 Tesseract `LocalOcrSession`（默认路径）、
 *   既有 Tesseract 会话满足 `OcrEngine` 接口（回归）。
 */

describe('createConfiguredOcrEngine（Tesseract 单一引擎工厂）', () => {
  it('返回统一的 OcrEngineFactory 结构（含 create）', () => {
    expect(typeof createConfiguredOcrEngine().create).toBe('function');
  });

  it('工厂的 create 路由到既有 Tesseract LocalOcrSession（默认路径不受影响）', async () => {
    const spy = vi.spyOn(LocalOcrSession, 'create').mockResolvedValue({} as never);
    const factory = createConfiguredOcrEngine();
    await factory.create(() => {});
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('工厂 create 返回的会话类型为 OcrEngine（结构一致，编译期检查）', () => {
    // 纯类型级校验：工厂 create 的返回类型必须可赋给 Promise<OcrEngine>。
    // 不在 Node 环境真实调用 create（需浏览器 Worker/运行时）。
    type CreateResult = ReturnType<OcrEngineFactory['create']>;
    type IsAssignable = CreateResult extends Promise<OcrEngine> ? true : false;
    const _typeCheck: IsAssignable = true;
    expect(_typeCheck).toBe(true);
  });
});

describe('统一 OCR 引擎接口类型一致性', () => {
  // 类型级断言：既有 Tesseract 会话必须满足同一 OcrEngine 接口。
  // （结构类型兼容：LocalOcrSession 有 recognize + terminate。）
  function assertIsOcrEngine(_e: OcrEngine): void {
    // 仅用于编译期类型约束
  }

  it('LocalOcrSession（Tesseract）满足 OcrEngine 接口（回归）', () => {
    assertIsOcrEngine({} as LocalOcrSession);
    expect(typeof LocalOcrSession.prototype.recognize).toBe('function');
    expect(typeof LocalOcrSession.prototype.terminate).toBe('function');
  });
});
