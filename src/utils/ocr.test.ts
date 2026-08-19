import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isHarmlessTesseractWarning } from './ocr';

/**
 * OCR 会话参数（tesseract.js v7 兼容）——源级回归校验。
 *
 * tesseract.js v7 的 worker-script（src/worker-script/index.js）把下列参数标记为
 * 「仅初始化时可设」（[type]_INIT_MEMBER）：它们只能通过 createWorker 的 config
 * 参数在初始化时设置，经 setParameters 传入会被 `api.SetVariable` 转发到原生引擎，
 * 触发 `Parameter not found: ...` 或 `Attempted to set parameters that can only be
 * set during initialization` 警告且不生效。本项目 OCR 只用同源本地资源，必须避免在
 * setParameters/recognize 中配置这些旧参数。
 *
 * 说明：这些是「用户可见控制台警告」的已知来源（区别于可保留的
 * `Estimating resolution as 260` 提示，后者来自引擎正常估算、非不兼容参数）。
 */

const OCR_FILE = join(dirname(fileURLToPath(import.meta.url)), 'ocr.ts');

// 与 tesseract.js v7 worker-script 的 initParamNames 保持一致的「仅初始化」参数名单。
const INIT_ONLY_PARAMS = [
  'ambigs_debug_level',
  'user_words_suffix',
  'user_patterns_suffix',
  'load_system_dawg',
  'load_freq_dawg',
  'load_unambig_dawg',
  'load_punc_dawg',
  'load_number_dawg',
  'load_bigram_dawg',
  'tessedit_ocr_engine_mode',
  'tessedit_init_config_only',
  'language_model_ngram_on',
  'language_model_use_sigmoidal_certainty',
];

describe('OCR 会话参数（tesseract.js v7 兼容）', () => {
  it('setParameters 的调用参数不含任何「仅初始化」参数（不触发 Parameter not found 警告）', () => {
    const src = readFileSync(OCR_FILE, 'utf8');
    const m = src.match(/setParameters\(\{([^}]*)\}\)/);
    expect(m).not.toBeNull();
    const call = m![1];
    for (const p of INIT_ONLY_PARAMS) {
      expect(call).not.toContain(p);
    }
  });

  it('setParameters 仅配置受支持的运行时参数 tessedit_pageseg_mode', () => {
    const src = readFileSync(OCR_FILE, 'utf8');
    const m = src.match(/setParameters\(\{([^}]*)\}\)/);
    expect(m).not.toBeNull();
    const call = m![1];
    expect(call).toContain('tessedit_pageseg_mode');
    // 只应出现受支持的 PSM 参数，不应夹带任何 init-only / 其他不兼容旧参数
    // （注：ocr.ts 顶部文档注释会合法列出这些参数名用于说明，故此处仅校验 setParameters 调用体）
    for (const p of INIT_ONLY_PARAMS) {
      expect(call).not.toContain(p);
    }
  });

  it('recognize 的 options 参数不夹带任何 Tesseract 参数（仅传 tesseract.js 选项）', () => {
    const src = readFileSync(OCR_FILE, 'utf8');
    const m = src.match(/recognize\(([^)]*)\)/);
    expect(m).not.toBeNull();
    const call = m![1];
    // recognize 的第 2 个参数是 tesseract.js 选项（rectangle/pdfTitle/rotateAuto 等），
    // 不应混入 Tesseract 变量；此处确保不含任何 init-only 参数名。
    for (const p of INIT_ONLY_PARAMS) {
      expect(call).not.toContain(p);
    }
  });
});

describe('isHarmlessTesseractWarning（白名单过滤）', () => {
  it('仅过滤白名单内的 Parameter not found 参数警告', () => {
    expect(isHarmlessTesseractWarning('Warning: Parameter not found: load_system_dawg')).toBe(true);
    expect(
      isHarmlessTesseractWarning('Warning: Parameter not found: tessedit_ocr_engine_mode'),
    ).toBe(true);
    expect(isHarmlessTesseractWarning('Warning: Parameter not found: user_words_suffix')).toBe(
      true,
    );
  });

  it('过滤 tesseract.js 自身的 init-only 提示（固定无害前缀）', () => {
    expect(
      isHarmlessTesseractWarning(
        'Attempted to set parameters that can only be set during initialization: user_words_suffix, load_punc_dawg',
      ),
    ).toBe(true);
    expect(
      isHarmlessTesseractWarning(
        'Attempted to set parameters that can only be set during initialization',
      ),
    ).toBe(true);
  });

  it('白名单外/未知参数的 Parameter not found 不被过滤（避免隐藏未知问题）', () => {
    expect(isHarmlessTesseractWarning('Warning: Parameter not found: some_unknown_param')).toBe(
      false,
    );
    expect(isHarmlessTesseractWarning('Warning: Parameter not found:')).toBe(false);
  });

  it('保留 Estimating resolution as 估算提示（正常引擎输出，非参数兼容问题）', () => {
    expect(isHarmlessTesseractWarning('Estimating resolution as 260')).toBe(false);
    expect(isHarmlessTesseractWarning('Estimating resolution as 0')).toBe(false);
  });

  it('真实错误一律不被过滤（不隐藏真正错误）', () => {
    expect(isHarmlessTesseractWarning('Error: Tesseract failed to initialize')).toBe(false);
    expect(
      isHarmlessTesseractWarning(
        'Tesseract (legacy) engine requested, but components are not present in ./eng.traineddata',
      ),
    ).toBe(false);
    expect(isHarmlessTesseractWarning('Failed to load chi_sim.traineddata')).toBe(false);
    expect(isHarmlessTesseractWarning('Read error: could not open file')).toBe(false);
    expect(isHarmlessTesseractWarning('')).toBe(false);
  });

  it('非字符串 / 非参数类普通警告不被过滤', () => {
    expect(isHarmlessTesseractWarning('Some random console warning')).toBe(false);
    expect(isHarmlessTesseractWarning(null as unknown as string)).toBe(false);
    expect(isHarmlessTesseractWarning(undefined as unknown as string)).toBe(false);
  });
});
