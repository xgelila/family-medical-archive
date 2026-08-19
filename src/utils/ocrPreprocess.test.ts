import { describe, expect, it } from 'vitest';
import {
  binarizePixels,
  clamp255,
  computeUpscaleScale,
  contrastStretchPixels,
  grayHistogram,
  grayValue,
  histogramPercentile,
  medianFilterPixels,
  otsuThreshold,
} from './ocrPreprocess';

/** RGBA 辅助构造 */
function rgba(values: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(values);
}

describe('纯像素函数（可单测，不触达 DOM）', () => {
  it('clamp255 / grayValue 基本正确', () => {
    expect(clamp255(-5)).toBe(0);
    expect(clamp255(300)).toBe(255);
    // 纯红 → 亮度 0.299*255 ≈ 76
    expect(grayValue(rgba([255, 0, 0, 255]), 0)).toBe(76);
    // 纯黑/纯白
    expect(grayValue(rgba([0, 0, 0, 255]), 0)).toBe(0);
    expect(grayValue(rgba([255, 255, 255, 255]), 0)).toBe(255);
  });

  it('grayHistogram / histogramPercentile 计算百分位', () => {
    // 构造 4 像素：0, 100, 200, 255
    const px = rgba([0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255, 255, 255, 255, 255]);
    const hist = grayHistogram(px);
    expect(hist[0]).toBe(1);
    expect(hist[100]).toBe(1);
    expect(hist[200]).toBe(1);
    expect(hist[255]).toBe(1);
    expect(histogramPercentile(hist, 0, 4)).toBe(0);
    expect(histogramPercentile(hist, 100, 4)).toBe(255);
    expect(histogramPercentile(hist, 50, 4)).toBe(100); // 第 50 百分位（4*0.5=2 → 累计到 2 时是 100）
  });

  it('contrastStretchPixels 将 [lo,hi] 映射到 [0,255]', () => {
    const px = rgba([0, 0, 0, 255, 64, 64, 64, 255, 255, 255, 255, 255]);
    const out = contrastStretchPixels(px, 0, 255);
    expect(out[0]).toBe(0);
    expect(out[4]).toBe(64);
    expect(out[8]).toBe(255);
    const narrowed = contrastStretchPixels(rgba([50, 50, 50, 255, 200, 200, 200, 255]), 50, 200);
    expect(narrowed[0]).toBe(0);
    expect(narrowed[4]).toBe(255);
  });

  it('otsuThreshold：双峰图像分离暗/亮（无噪声双峰时 Otsu 取峰边界，加 1 即分离）', () => {
    // 一半像素纯黑（0），一半像素很亮（240）。
    // 说明：标准 Otsu 对“无噪声双峰”取到的是分界处的首个最大值（=暗峰边缘），
    // 真实图片总有噪声/渐变，阈值会落在峰间谷底；这里用 t+1 验证二值化可分离两类。
    const dark = new Array<number>(100).fill(0);
    const light = new Array<number>(100).fill(240);
    const px = rgba([...dark, ...light].flatMap((v) => [v, v, v, 255]));
    const t = otsuThreshold(px);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThan(240);
    const out = binarizePixels(px, Math.min(255, t + 1));
    expect(out[0]).toBe(0); // 暗像素 → 黑
    expect(out[100 * 4]).toBe(255); // 亮像素 → 白
  });

  it('binarizePixels：阈值决定黑/白', () => {
    const px = rgba([10, 10, 10, 255, 200, 200, 200, 255]);
    const out = binarizePixels(px, 128);
    expect(out[0]).toBe(0);
    expect(out[4]).toBe(255);
  });

  it('medianFilterPixels：3×3 中值去噪去掉孤立噪点', () => {
    // 3×3 图片：中心为亮点 255，其余为 0
    const px = rgba([
      0,
      0,
      0,
      255,
      0,
      0,
      0,
      255,
      0,
      0,
      0,
      255, //
      0,
      0,
      0,
      255,
      255,
      255,
      255,
      255,
      0,
      0,
      0,
      255, //
      0,
      0,
      0,
      255,
      0,
      0,
      0,
      255,
      0,
      0,
      0,
      255,
    ]);
    const out = medianFilterPixels(px, 3, 3);
    // 中心像素被 8 个 0 包围 → 中值 0
    expect(out[4]).toBe(0);
  });

  it('computeUpscaleScale：放大到目标短边且不小于 1 倍，上限 4 倍', () => {
    expect(computeUpscaleScale(900, 600, 1800)).toBe(3);
    expect(computeUpscaleScale(3000, 2000, 1800)).toBe(1);
    expect(computeUpscaleScale(100, 100, 1800)).toBe(4); // 上限 4 倍
  });
});
