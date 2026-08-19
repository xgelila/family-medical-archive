/**
 * Tesseract 单一 OCR 引擎的工厂与统一接口。
 *
 * 设计目标：
 * - 本项目仅使用本地 Tesseract（tesseract.js）作为 OCR 引擎，无其它可选后端；
 * - `createConfiguredOcrEngine()` 返回的工厂 `create` 即创建 `LocalOcrSession`
 *   （Tesseract 本地会话），统一接口为 `create / recognize / terminate`。
 *
 * 隐私/边界：
 * - 图片只在本地引擎内处理，**绝不发送到任何服务端**（见 ocr.ts）；
 * - 不含任何构建期引擎开关/环境变量读取，UI 不展示引擎标识。
 */

import { LocalOcrSession, type OcrProgress, type OcrRecognized } from './ocr';

/** 统一 OCR 引擎接口（与 LocalOcrSession 结构类型一致）。 */
export interface OcrEngine {
  recognize(image: Blob | HTMLCanvasElement): Promise<OcrRecognized>;
  terminate(): Promise<void>;
}

/** 引擎工厂：create 时加载该引擎并返回一个可识别的会话（可取消/释放）。 */
export interface OcrEngineFactory {
  create(onProgress: (p: OcrProgress) => void): Promise<OcrEngine>;
}

/** 创建 Tesseract 本地 OCR 引擎工厂（本项目唯一 OCR 引擎）。 */
export function createConfiguredOcrEngine(): OcrEngineFactory {
  return { create: (onProgress) => LocalOcrSession.create(onProgress) };
}
