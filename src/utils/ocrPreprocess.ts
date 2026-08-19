/**
 * 浏览器本地图像预处理（增强文字小图的可读性后再 OCR）。
 *
 * 隐私/边界：
 * - 全部在本机浏览器 Canvas 上完成，图片数据不离开设备、不上传；
 * - 只生成**新的画布**用于识别，**绝不修改用户附件原图/原始 Blob**；
 * - 增强流程：按需放大 → 灰度 → （可选）对比度拉伸（2%~98% 分位）→
 *   （可选）3×3 中值去噪 → （可选）Otsu 二值化 → 可选相对坐标裁剪。
 *
 * 纯像素函数独立实现，可在 Node 单测中直接验证（不触达 DOM/Worker）。
 */

export type OcrPreprocessMode = 'original' | 'enhanced';
export type OcrEnhanceStyle = 'grayscale' | 'binary';

export interface OcrPreprocessOptions {
  mode: OcrPreprocessMode;
  enhance: OcrEnhanceStyle;
  /** 增强模式下目标输出短边像素（放大用）；原图模式忽略 */
  maxShortSide: number;
  /** 自动对比度拉伸（2%~98% 分位） */
  autoLevel: boolean;
  /** 3×3 中值去噪（在灰度/二值化前执行） */
  denoise: boolean;
  /** 手动顺时针旋转 90° 的次数（0-3） */
  rotate90: 0 | 1 | 2 | 3;
  /** 相对裁剪（0..1 归一化坐标，相对最终处理后的画布）；null = 不裁剪 */
  crop?: { x0: number; y0: number; x1: number; y1: number } | null;
}

export interface OcrPreprocessResult {
  canvas: HTMLCanvasElement;
  /** 说明性文字，例如实际执行了哪些步骤（供界面预览区展示） */
  description: string;
}

// ---------- 纯像素函数（Node 可单测） ----------

export function clamp255(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

/** 亮度（Y = 0.299R + 0.587G + 0.114B），输入 RGBA 数组中某像素起始下标 i */
export function grayValue(data: Uint8ClampedArray, i: number): number {
  return clamp255(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
}

/** 转灰度（RGBA 输出，r=g=b=亮度） */
export function grayscaleCopy(data: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const g = grayValue(data, i);
    out[i] = g;
    out[i + 1] = g;
    out[i + 2] = g;
    out[i + 3] = data[i + 3];
  }
  return out;
}

/** 灰度直方图（256 桶） */
export function grayHistogram(data: Uint8ClampedArray): number[] {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < data.length; i += 4) hist[grayValue(data, i)]++;
  return hist;
}

/** 直方图百分位值（0-255） */
export function histogramPercentile(hist: number[], p: number, total: number): number {
  const target = (total * p) / 100;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

/** 对比度拉伸：把 [lo, hi] 的灰度线性映射到 [0, 255] */
export function contrastStretchPixels(
  data: Uint8ClampedArray,
  lo: number,
  hi: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  if (hi <= lo) return grayscaleCopy(data);
  const k = 255 / (hi - lo);
  for (let i = 0; i < data.length; i += 4) {
    const v = clamp255((grayValue(data, i) - lo) * k);
    out[i] = v;
    out[i + 1] = v;
    out[i + 2] = v;
    out[i + 3] = data[i + 3];
  }
  return out;
}

/** Otsu 二值化阈值（基于灰度直方图） */
export function otsuThreshold(data: Uint8ClampedArray): number {
  const hist = grayHistogram(data);
  const total = data.length / 4;
  if (total === 0) return 128;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let v = 0; v < 256; v++) {
    wB += hist[v];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += v * hist[v];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = v;
    }
  }
  return best;
}

/** 按阈值二值化（灰度输入 RGBA → 输出 r=g=b = 255 或 0） */
export function binarizePixels(data: Uint8ClampedArray, threshold: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const v = grayValue(data, i) >= threshold ? 255 : 0;
    out[i] = v;
    out[i + 1] = v;
    out[i + 2] = v;
    out[i + 3] = data[i + 3];
  }
  return out;
}

/** 3×3 中值去噪（对灰度值滤波；边界像素保留原值）。可单测（小图）。 */
export function medianFilterPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) out[i + 3] = data[i + 3];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const window: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          window.push(grayValue(data, (ny * width + nx) * 4));
        }
      }
      window.sort((a, b) => a - b);
      const med = window[Math.floor(window.length / 2)];
      const i = (y * width + x) * 4;
      out[i] = med;
      out[i + 1] = med;
      out[i + 2] = med;
    }
  }
  return out;
}

/** 放大系数：让短边至少达 target（且不小于原尺寸的 1 倍） */
export function computeUpscaleScale(width: number, height: number, maxShortSide: number): number {
  const short = Math.min(width, height);
  if (short <= 0) return 1;
  return Math.max(1, Math.min(4, maxShortSide / short));
}

/** 归一化裁剪矩形收敛到 [0,1]^2（纯函数） */
export function clampCrop(
  c: { x0: number; y0: number; x1: number; y1: number } | null | undefined,
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!c) return null;
  const x0 = Math.max(0, Math.min(1, Math.min(c.x0, c.x1)));
  const x1 = Math.max(0, Math.min(1, Math.max(c.x0, c.x1)));
  const y0 = Math.max(0, Math.min(1, Math.min(c.y0, c.y1)));
  const y1 = Math.max(0, Math.min(1, Math.max(c.y0, c.y1)));
  if (x1 - x0 < 0.01 || y1 - y0 < 0.01) return null; // 过小视为误触
  return { x0, y0, x1, y1 };
}

// ---------- 浏览器画布部分 ----------

/** 读取时尊重 EXIF 方向（从图片原始方向出发），避免手机照片被旋转 */
export async function loadImageBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    // 某些环境不支持 imageOrientation（如旧 Safari），退回默认读取
    return createImageBitmap(blob);
  }
}

/**
 * 执行完整预处理（仅本机画布运算），返回识别用的新画布。
 * 不修改任何原始附件数据。
 */
export async function preprocessImage(
  blob: Blob,
  opts: OcrPreprocessOptions,
): Promise<OcrPreprocessResult> {
  const bitmap = await loadImageBitmap(blob);
  const w = bitmap.width;
  const h = bitmap.height;
  const desc: string[] = [];
  try {
    const scale = opts.mode === 'enhanced' ? computeUpscaleScale(w, h, opts.maxShortSide) : 1;
    const rot = ((opts.rotate90 % 4) + 4) % 4;
    const swap = rot % 2 === 1;
    const outW = Math.max(1, Math.round((swap ? h : w) * scale));
    const outH = Math.max(1, Math.round((swap ? w : h) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('无法获取 Canvas 上下文，预处理不可用');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate((rot * Math.PI) / 2); // 顺时针
    ctx.drawImage(bitmap, (-w * scale) / 2, (-h * scale) / 2, w * scale, h * scale);

    if (scale > 1) {
      desc.push(`放大至短边 ${Math.min(outW, outH)}px（×${round2(scale)}）`);
    }
    if (rot > 0) desc.push(`顺时针旋转 ${rot * 90}°`);

    if (opts.mode === 'enhanced') {
      const img = ctx.getImageData(0, 0, outW, outH);
      let data = img.data;
      if (opts.autoLevel) {
        const hist = grayHistogram(data);
        const total = outW * outH;
        const lo = histogramPercentile(hist, 2, total);
        const hi = histogramPercentile(hist, 98, total);
        data = contrastStretchPixels(data, lo, hi);
        desc.push(`灰度+对比度拉伸([${lo}..${hi}]→[0..255])`);
      } else {
        data = grayscaleCopy(data);
        desc.push('灰度化');
      }
      if (opts.denoise) {
        data = medianFilterPixels(data, outW, outH);
        desc.push('3×3 中值去噪');
      }
      if (opts.enhance === 'binary') {
        const t = otsuThreshold(data);
        data = binarizePixels(data, t);
        desc.push(`Otsu 二值化(阈值 ${t})`);
      }
      img.data.set(data);
      ctx.putImageData(img, 0, 0);
    } else {
      desc.push('保持原图（未增强）');
    }

    const crop = clampCrop(opts.crop);
    if (crop) {
      const sx = Math.round(crop.x0 * outW);
      const sy = Math.round(crop.y0 * outH);
      const cw = Math.max(1, Math.round((crop.x1 - crop.x0) * outW));
      const ch = Math.max(1, Math.round((crop.y1 - crop.y0) * outH));
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = cw;
      cropCanvas.height = ch;
      const cctx = cropCanvas.getContext('2d');
      if (!cctx) throw new Error('无法创建裁剪画布');
      cctx.drawImage(canvas, sx, sy, cw, ch, 0, 0, cw, ch);
      desc.push(`裁剪到结果区域(${(crop.x1 - crop.x0) * 100}%×${(crop.y1 - crop.y0) * 100}%)`);
      return { canvas: cropCanvas, description: desc.join('；') || '原图' };
    }

    return { canvas, description: desc.join('；') || '原图' };
  } finally {
    bitmap.close();
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 画布导出为 blob（供预览/展示使用），失败时返回 null */
export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), type);
  });
}
