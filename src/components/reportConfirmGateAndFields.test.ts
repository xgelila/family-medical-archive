import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { emptyDraft, pendingItemCount, type ItemDraft } from '../utils/labels';
import { ocrCandidateToDraft, type OcrCandidate } from '../utils/ocrCandidate';

/**
 * 本轮需求源级 + 纯函数校验：
 * 1. 标准标签（standardLabel）保留数据模型/导入导出/趋势兼容，但 UI 层完全不渲染：
 *    核对页/编辑页/检查项目表/卡片都不出现「标准标签」列、输入框、标签 Chip 或 StandardLabelCell；
 * 2. 「试验方法」（testMethod）是检查项目字段，在项目行中与单位、参考区间并列显示/编辑；
 * 3. 状态「待确认」列移到检查项目表第一列；
 * 4. 报告详情默认折叠；
 * 5. 识别候选必须逐项确认后才能保存：未确认阻止保存、全部确认允许保存、手动项目可保存。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, 'src', p), 'utf-8');

const review = read('components/ReportReview.tsx');
const manager = read('components/ReportManager.tsx');
const styles = readFileSync(join(root, 'src', 'styles.css'), 'utf-8');

describe('标准标签（standardLabel）：数据模型保留，UI 层完全不渲染', () => {
  it('核对页（ReportReview）不再渲染「标准标签」列/输入框', () => {
    expect(review).not.toContain('标准标签（可选）');
    expect(review).not.toContain('标准标签：');
    expect(review).not.toContain('col-label');
    expect(review).not.toContain('placeholder="可选，如：TSH"');
  });


  it('报告卡片（ReportManager）不再渲染「标签：xxx」Chip', () => {
    expect(manager).not.toContain('标签：');
    expect(manager).not.toContain('it.standardLabel ? (');
  });

  it('数据模型/保存/趋势仍保留 standardLabel（不回归：类型、保存、导出、趋势）', () => {
    const types = read('types.ts');
    const reviewSave = review;
    expect(types).toContain('standardLabel?: string;');
    expect(reviewSave).toContain("standardLabel: (it.standardLabel ?? '').trim(),");
    expect(reviewSave).toContain('confirmed: it.confirmed');
  });
});

describe('试验方法（testMethod）：检查项目字段，与单位/参考区间并列显示/编辑', () => {
  it('核对页/编辑页项目表包含「检验方法」列，且不再是备注', () => {
    expect(review).toContain('<th>检验方法</th>');
    expect(review).toContain('it.testMethod');
    // 不再把方法并入 notes（方法：… 的旧逻辑已移除）
    expect(review).not.toContain('方法：${');

  });

  it('报告卡片（ReportManager）展示「检验方法」列', () => {
    expect(manager).toContain('<th>检验方法</th>');
    expect(manager).toContain('it.testMethod ||');
  });

  it('识别候选：method 进入草稿 testMethod，不入 notes（纯函数）', () => {
    const c: OcrCandidate = {
      name: 'TSH',
      displayName: 'TSH',
      resultKind: 'numeric',
      value: '3.2',
      unit: 'mIU/L',
      refRange: '0.27-4.2',
      method: '化学发光法',
      confirmed: false,
      standardLabel: '',
      sourceLine: 'x',
      qualityHint: '',
      confidence: 90,
      avgConfidence: null,
      recommendedLabelId: '',
      recommendedLabel: '',
      labelStatus: '',
      labelConfidence: null,
      chosenLabel: '',
    };
    const draft = ocrCandidateToDraft(c);
    expect(draft.testMethod).toBe('化学发光法');
    expect(draft.notes).toBe('');
    expect(draft.confirmed).toBe(false); // 识别候选恒为待确认
  });
});

describe('状态「待确认」列移到检查项目表第一列', () => {
  it('核对页/编辑页：状态列（col-status）为表头第一项', () => {
    for (const src of [review]) {
      const statusPos = src.indexOf('<th className="col-status">状态</th>');
      const namePos = src.indexOf('<th className="col-name">项目名（报告原文）*</th>');
      expect(statusPos).toBeGreaterThan(-1);
      expect(namePos).toBeGreaterThan(statusPos);
    }
  });

  it('报告卡片（ReportManager）：状态列为第一项', () => {
    const statusPos = manager.indexOf('<th>状态</th>');
    const itemPos = manager.indexOf('<th>检查项目</th>');
    expect(statusPos).toBeGreaterThan(-1);
    expect(itemPos).toBeGreaterThan(statusPos);
  });

  it('移动端横向滚动时第一列（状态列）固定可见（sticky 首列样式）', () => {
    expect(styles).toContain('.table-wrap .data-table td:first-child');
    expect(styles).toContain('position: sticky;');
    expect(styles).toContain('left: 0;');
  });
});

describe('报告详情默认折叠，用户主动点击后才展开', () => {
  it('核对页/编辑页初始折叠态为 false', () => {
    expect(review).toContain('const [detailsOpen, setDetailsOpen] = useState(false);');
  });

  it('已保存报告展示（ReportManager）默认折叠但可展开', () => {
    expect(manager).toContain('const [open, setOpen] = useState(false)');
    expect(manager).toContain('aria-expanded={open}');
  });
});

describe('保存门槛：识别候选必须逐项确认后才能保存', () => {
  it('纯函数：待确认计数只统计 confirmed!==true 的项目（手动已确认不计入）', () => {
    const manual: ItemDraft = { ...emptyDraft(), name: '血红蛋白' }; // 手动默认已确认
    const pending: ItemDraft = { ...emptyDraft(), name: '尿蛋白', confirmed: false };
    expect(emptyDraft().confirmed).toBe(true); // 手动默认已确认
    expect(pendingItemCount([manual])).toBe(0); // 手动可保存
    expect(pendingItemCount([pending])).toBe(1); // 未确认阻止保存
    expect(pendingItemCount([manual, pending])).toBe(1);
    expect(pendingItemCount([])).toBe(0); // 无项目可保存
  });

  it('核对页（ReportReview）：canSave 纳入 pendingItemCount 门槛，并提示待确认数量', () => {
    expect(review).toContain('pendingItemCount(items) === 0');
    expect(review).toContain('const pendingCount = pendingItemCount(items);');
    expect(review).toContain('disabled={!canSave || busy}');
    expect(review).toContain('还有 {pendingCount} 项待确认');
  });


  it('识别候选恒为待确认（confirm 门槛真实生效），全部确认后才可保存', () => {
    const c: OcrCandidate = {
      name: 'TSH',
      displayName: 'TSH',
      resultKind: 'numeric',
      value: '3.2',
      unit: 'mIU/L',
      refRange: '0.27-4.2',
      method: '',
      confirmed: false,
      standardLabel: '',
      sourceLine: 'x',
      qualityHint: '',
      confidence: 90,
      avgConfidence: null,
      recommendedLabelId: '',
      recommendedLabel: '',
      labelStatus: '',
      labelConfidence: null,
      chosenLabel: '',
    };
    const recognized = ocrCandidateToDraft(c);
    expect(recognized.confirmed).toBe(false);
    // 未确认 → 阻止保存
    expect(pendingItemCount([recognized])).toBe(1);
    // 全部确认 → 允许保存
    expect(pendingItemCount([{ ...recognized, confirmed: true }])).toBe(0);
  });
});
