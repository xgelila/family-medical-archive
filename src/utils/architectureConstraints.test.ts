import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 架构约束（源级校验，不是行为测试）：
 * - 密钥/服务端配置变量不得出现在前端源码与 bundle 输入中（VITE_* / OPENCODE_GO_* 仅允许在
 *   vite.config.ts / README / .env.example / 测试本身出现）；
 * - 代理配置（含上游地址）只允许出现在 vite.config.ts（Node 侧）；
 * - 旧技术入口（AiStructurePanel / OcrPanel / OcrImageEditor / opencodeGo）必须已删除，
 *   不得再被任何源码引用或在 UI 文案中出现；
 * - 图片编辑器（ImageCropModal / tui-image-editor / 全屏编辑 overlay）已移除，选图后原图直接进入
 *   附件预览与识别，前端不得再引入任何图片编辑依赖或编辑器专用样式；
 * - 「识别数据」流程源码必须为纯本地裁剪（无网络调用）+ 黑盒文案（用户可见字符串不含
 *   OCR/AI/OpenCode/DeepSeek）；
 * - 隐私入口必须存在。
 *
 * 说明：校验「用户可见文案」前先剔除注释——源码注释中出现的术语仅用于说明 UI 不展示它们。
 */

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

function readAll(dir: string): { files: string[]; content: string } {
  const files = sourceFiles(dir);
  return { files, content: files.map((f) => readFileSync(f, 'utf8')).join('\n') };
}

/** 剔除块注释与行注释（保留字符串字面量），用于「用户可见文案」校验 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const TREE = readAll(SRC_DIR);
const TREE_VISIBLE = stripComments(TREE.content);

/**
 * 允许出现在前端源码中的**非密钥**纯前端构建开关（白名单）。
 *
 * 当前项目已恢复为 Tesseract 单一 OCR 引擎，不再有任何可切换引擎的构建开关，
 * 因此该白名单为空：所有 VITE_*（含旧的 VITE_OCR_ENGINE / VITE_OCR_PADDLE_*）
 * 一律禁止出现在前端源码中（防止密钥/服务端配置泄漏）。
 */
const ALLOWED_NON_SECRET_VITE: string[] = [];

/** 从源码文本中剔除白名单内的非密钥开关（仅用于断言其余 VITE_* 不存在）。 */
function withoutAllowedVite(source: string): string {
  return ALLOWED_NON_SECRET_VITE.reduce((acc, name) => acc.split(name).join(''), source);
}

describe('密钥与代理配置不进入前端源码（源级约束，保证 bundle 不含 Key/服务端配置）', () => {
  it('src 源码不含任何 VITE_ 变量读取（含旧 VITE_OCR_ENGINE / VITE_OCR_PADDLE_*）', () => {
    expect(withoutAllowedVite(TREE_VISIBLE)).not.toMatch(/VITE_[A-Z_]+/);
  });

  it('src 源码不含 OPENCODE_GO / 上游地址 / 鉴权头常量', () => {
    expect(TREE_VISIBLE).not.toMatch(/OPENCODE_GO/);
    expect(TREE_VISIBLE).not.toMatch(/opencode\.ai/);
    expect(TREE_VISIBLE).not.toMatch(/Authorization/);
  });

  it('src 源码不含 import.meta.env 配置读取（main.tsx 的 DEV/PROD、ocr.ts 的 BASE_URL 除外）', () => {
    const offenders = sourceFiles(SRC_DIR).filter((f) => {
      if (f.endsWith('main.tsx') || f.endsWith('ocr.ts')) return false;
      return readFileSync(f, 'utf8').includes('import.meta.env');
    });
    expect(offenders).toEqual([]);
  });

  it('代理配置仅存在于 vite.config.ts（Node 侧），且不落日志', () => {
    const viteCfg = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(viteCfg).toContain('/api/recognize-report');
    expect(viteCfg).toContain('OPENCODE_GO_API_KEY');
    expect(viteCfg).toContain('VITE_OPENCODE_GO_API_KEY'); // 仅兼容回退，位于 Node 侧
    expect(viteCfg).not.toMatch(/console\.log/);
    const srcRefs = sourceFiles(SRC_DIR).filter((f) =>
      readFileSync(f, 'utf8').includes('opencode.ai'),
    );
    expect(srcRefs).toEqual([]);
  });
});

describe('旧技术入口已删除（源级约束）', () => {
  it('旧组件文件与模块已删除且无任何引用', () => {
    const banned = [
      'OcrPanel',
      'OcrImageEditor',
      'AiStructurePanel',
      'opencodeGo',
      'sendTextToOpenCodeGo',
    ];
    for (const b of banned) expect(TREE).not.toContain(b);
  });

  it('用户可见文案不再出现「用 AI 结构化」「OpenCode」「DeepSeek」等字眼', () => {
    for (const term of ['用 AI 结构化', 'OpenCode', 'DeepSeek']) {
      expect(TREE_VISIBLE).not.toContain(term);
    }
  });
});

describe('「识别数据」黑盒流程与纯本地裁剪（源级约束）', () => {
  it('识别面板主流程黑盒文案：无上游地址、无密钥、无技术术语字面量；技术术语仅允许出现在「识别调试」面板内', () => {
    const panel = readFileSync(join(SRC_DIR, 'components', 'ReportRecognitionPanel.tsx'), 'utf8');
    const visible = stripComments(panel);
    // 主流程 = 「识别调试」折叠面板之前的部分，必须保持黑盒（不暴露 OCR/AI/模型/密钥/上游）
    const mainFlow = visible.split('{debugInfo.ran && (')[0];
    expect(mainFlow).toContain('识别整张报告');
    expect(mainFlow).toContain('添加到报告');
    expect(mainFlow).not.toMatch(/fetch\(['"]https?:\/\//);
    expect(mainFlow).not.toContain('import.meta.env');
    expect(mainFlow).not.toContain('OCR');
    expect(mainFlow).not.toContain('OpenCode');
    expect(mainFlow).not.toContain('DeepSeek');
    expect(mainFlow).not.toContain('AI');
    // 调试面板是刻意暴露技术细节的折叠区域（仅本机调试用途），可含 OCR 等术语
    expect(visible).toContain('识别调试');
    expect(visible).toContain('本机图片读取（OCR）');
    // 调试面板也只展示经截断/清洗的内容，不出现密钥/上游地址/鉴权字面量
    expect(visible).not.toContain('Authorization');
    expect(visible).not.toMatch(/opencode\.ai/);
  });

  it('图片编辑器依赖已移除：无 ImageCropModal / tui-image-editor / 编辑器 CSS / 全屏编辑 overlay', () => {
    // 选图后原图直接进入附件预览与识别，前端不得再引入任何图片编辑依赖或编辑器专用样式。
    expect(TREE).not.toContain('ImageCropModal');
    expect(TREE).not.toContain('tui-image-editor');
    expect(TREE).not.toContain('tui-editor-viewport');
    expect(TREE).not.toContain('img-editor-overlay');
    expect(TREE).not.toContain('img-editor-modal');
    expect(TREE).not.toContain('editQueue');
    expect(TREE).not.toContain('openCrop');
    expect(TREE).not.toContain('setCropOpen');
    const css = readFileSync(join(SRC_DIR, 'styles.css'), 'utf8');
    expect(css).not.toContain('img-editor-overlay');
    expect(css).not.toContain('img-editor-modal');
    expect(css).not.toContain('tui-editor-viewport');
  });

  it('识别面板渲染 JSX 不出现原始文本字段', () => {
    const panel = readFileSync(join(SRC_DIR, 'components', 'ReportRecognitionPanel.tsx'), 'utf8');
    const jsxExposure = panel.match(
      /<[^>]*\{\s*(rawText|it\.sourceText|row\.sourceText|r\.sourceText)\s*\}/,
    );
    expect(jsxExposure).toBeNull();
  });

  it('识别结果候选恒为待确认、无标准标签（aiStructure 清洗保证，源级）。', () => {
    const ai = readFileSync(join(SRC_DIR, 'utils', 'aiStructure.ts'), 'utf8');
    expect(ai).toContain("standardLabel: ''");
    expect(ai).toContain('confirmed: false');
    expect(ai).toContain('sourceText');
  });
});

describe('隐私入口与文案（源级约束）', () => {
  it('App 页脚提供「关于与隐私说明」入口，隐私说明包含关键内容', () => {
    const app = readFileSync(join(SRC_DIR, 'App.tsx'), 'utf8');
    expect(app).toContain('关于与隐私说明');
    const privacy = readFileSync(join(SRC_DIR, 'components', 'PrivacyModal.tsx'), 'utf8');
    for (const term of [
      '本机浏览器',
      '不会发送出去',
      '第三方服务',
      '不构成医疗诊断',
      '导出',
      '清除',
    ]) {
      expect(privacy).toContain(term);
    }
  });
});
