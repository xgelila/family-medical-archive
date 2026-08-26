import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 报告编辑页「报告类型 / 检查类别」区域：信息密度与交互明确性（源级契约测试）。
 *
 * 需求：
 * - 必要说明不再常驻平铺在字段里，改为标题旁 ? 按钮，tooltip 默认隐藏，仅 hover/focus 显示；
 * - 选择交互必须清晰：仅 checkbox 控件或其明确 label 可选，无隐式容器 click、无自动选首项、
 *   无点击区域展开说明；
 * - 不破坏 lab/imaging 多选与自定义类型语义。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, 'src', p), 'utf-8');

const review = read('components/ReportReview.tsx');
const styles = read('styles.css');
/** 去空白后匹配，避免对 prettier 换行敏感。 */
const s = (src: string, fragment: string) =>
  src.replace(/\s+/g, '').includes(fragment.replace(/\s+/g, ''));

describe('报告类型标题旁 ? 说明按钮 + tooltip', () => {
  it('必要说明改为标题旁 ? 按钮（lucide HelpCircle），带 aria-label 与 title', () => {
    expect(review).toContain('<HelpCircle size={14} strokeWidth={2} aria-hidden="true" />');
    expect(review).toContain('className="report-type-help"');
    expect(review).toContain('aria-label="报告类型说明"');
    expect(review).toContain('title="检验与检查报告均可多选类型"');
  });

  it('tooltip 默认隐藏，仅 hover/focus 显示（CSS 契约），且常驻 hint 从字段平铺移除', () => {
    expect(review).toContain('className="help-tooltip"');
    expect(review).toContain('role="tooltip"');
    // 必要的解释文案只放在 tooltip，不再作为 Field hint 常驻平铺
    expect(review).not.toMatch(/<Field label="报告类型 \/ 检查类别" hint=/);
    // 默认隐藏
    expect(s(styles, '.help-tooltip')).toBe(true);
    expect(styles).toContain('opacity: 0;\n  visibility: hidden;');
    // 仅 hover / focus 时显示
    expect(s(styles, '.report-type-help:hover .help-tooltip')).toBe(true);
    expect(s(styles, '.report-type-help:focus-visible .help-tooltip')).toBe(true);
    expect(s(styles, '.report-type-help:focus .help-tooltip')).toBe(true);
  });
});

describe('选择交互清晰：仅 checkbox 控件可触发，无隐式容器 click / 自动选首项 / 点击展开说明', () => {
  it('类型选项用明确 checkbox 控件，选择仅绑定到 checkbox 的 onChange', () => {
    expect(s(review, 'type="checkbox"')).toBe(true);
    expect(s(review, 'name="report-type"')).toBe(true);
    expect(s(review, 'onChange={() => toggleReportType(t)}')).toBe(true);
  });

  it('无隐式容器 click：菜单/选项容器不绑定 onClick 选择', () => {
    // 报告类型菜单容器 / 选项容器都没有 onClick（不点空白即选中）
    expect(review).not.toContain('className="report-type-menu" onClick=');
    expect(review).not.toContain('className="report-type-option" onClick=');
    expect(review).not.toContain('className="report-type-dropdown" onClick=');
  });

  it('无自动选首项逻辑（无点击空白即自动选 visibleTypes[0]）', () => {
    expect(review).not.toContain('toggleReportType(visibleTypes[0])');
    expect(review).not.toContain('visibleTypes[0]');
  });

  it('无「点击类型区即展开说明」：说明只放在 tooltip，无常驻/点击展开的说明块', () => {
    // 点击不会展开下方说明文字
    expect(review).not.toContain('className="report-type-note"');
    expect(review).not.toContain('onClick={() => setReportTypeNoteOpen');
  });

  it('保留必要字段标签与空态反馈（aria-live，含『未匹配报告类型：报告仍可保存』）', () => {
    expect(review).toContain('report-type-title');
    expect(review).toContain('aria-live="polite"');
    expect(review).toContain('未匹配报告类型：报告仍可保存');
  });
});

describe('多选与自定义类型语义保留（不因 UI 收敛而回归）', () => {
  it('lab/imaging 类型仍为多选 checkbox，已选以 chips 展示', () => {
    expect(s(review, 'onChange={() => toggleReportType(t)}')).toBe(true);
    expect(review).toContain('className="report-type-selected"');
    expect(review).toContain('aria-label="已选报告类型"');
  });

  it('自定义类型管理入口与多值保存语义保留', () => {
    expect(review).toContain('setTypesManagerOpen(true)');
    expect(review).toContain('管理报告类型…');
    expect(
      s(
        review,
        'reportTypes: reportTypes.length > 0 ? reportTypes : (reportType ? [reportType] : []),',
      ),
    ).toBe(true);
  });
});
