import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 需求：检验（lab）大类报告类型也支持多选。
 *
 * 校验点：
 * 1) 报告信息页类型控件不再区分 lab/imaging：一律多选（checkbox），允许「一张检验单同时
 *    含超敏C反应蛋白 + 肝功能」等场景同时选中多个类型；
 * 2) 保存时保留旧字段兼容：reportTypes 多值保存，且 reportType 始终取 reportTypes[0]
 *    （旧数据兼容第一项）；
 * 3) imaging 多选与旧数据回退不回归：保存共用同一 toggleReportType 回路，旧数据经
 *    normalizeReportTypes 回退为单元素数组；
 * 4) 下拉底部增加「管理报告类型…」入口（打开既有 DataManager 管理），且入口为可操作的
 *    真实按钮，不在原生 select 内嵌不可操作项。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, 'src', p), 'utf-8');

const review = read('components/ReportReview.tsx');
const kit = read('components/Kit.tsx');
const types = read('types.ts');
/** 去空白后匹配，避免源级断言对 prettier 换行敏感。 */
const s = (src: string, fragment: string) =>
  src.replace(/\s+/g, '').includes(fragment.replace(/\s+/g, ''));

describe('检验（lab）报告类型多选', () => {
  it('类型控件对 lab / imaging 一律使用 checkbox 多选（不再区分 radio/checkbox）', () => {
    // 不再有 `reportKind === 'imaging' ? 'checkbox' : 'radio'` 分支
    expect(review).not.toContain("? 'checkbox' : 'radio'");
    expect(s(review, 'type="checkbox"')).toBe(true);
    expect(s(review, 'name="report-type"')).toBe(true);
  });

  it('多选切换统一走 toggleReportType（lab 与 imaging 共用一条保存/勾选回路）', () => {
    expect(review).toContain('const toggleReportType = (type: string) =>');
    expect(s(review, 'onChange={() => toggleReportType(t)}')).toBe(true);
    // lab 的 hint 不再表述为「可选择一项」
    expect(review).not.toContain('检验报告可选择一项');
    expect(s(review, '均可多选类型')).toBe(true);
  });

  it('保存：reportTypes 保持多值，且旧 reportType 字段固定取第一项（兼容旧数据）', () => {
    expect(
      s(
        review,
        'reportTypes: reportTypes.length > 0 ? reportTypes : (reportType ? [reportType] : []),',
      ),
    ).toBe(true);
    expect(
      s(review, "reportType: reportTypes[0] ?? (editingReport?.reportType ?? '').trim(),"),
    ).toBe(true);
  });

  it('旧数据回退：normalizeReportTypes 无 reportTypes 时回退为 reportType 单元素数组', () => {
    expect(types).toContain('const types = Array.isArray(report.reportTypes)');
    expect(s(types, 'return legacy ? [legacy] : [];')).toBe(true);
  });
});

describe('类型下拉底部自定义类型管理入口（当前页弹层，不再跳转 DataManager）', () => {
  it('下拉菜单底部提供「管理报告类型…」清晰入口（真实按钮，可操作，打开当前页弹层）', () => {
    expect(s(review, '管理报告类型…')).toBe(true);
    expect(s(review, 'className="report-type-manage-btn"')).toBe(true);
    expect(review).toContain('setTypesManagerOpen(true)');
  });

  it('入口打开当前页内弹层 ReportTypeManagerModal（复用共享面板），不在 ReportReview 复制管理逻辑', () => {
    expect(review).toContain("import { ReportTypeManagerModal } from './ReportTypeManager'");
    expect(s(review, '<ReportTypeManagerModal')).toBe(true);
    expect(review).toContain('onClose={() => setTypesManagerOpen(false)}');
    // 不再有跳转 DataManager 的回调（不再为此关闭向导 / 切页）
    expect(review).not.toContain('onManageTypes');
    // 不在 ReportReview 内复制新增/删除类型逻辑（共享面板/工具负责）
    expect(review).not.toContain('await db.customReportTypes.put');
  });
});

describe('核心筛选下拉不再渲染冗余说明文本（不显示也不占布局），必备筛选控件与空态保留', () => {
  it('Kit 仍提供 SelectEmptyHint 组件（recordrole=status，供其他可选场景复用）', () => {
    expect(kit).toContain('export function SelectEmptyHint(');
    expect(s(kit, 'role="status"')).toBe(true);
  });

  it('ReportReview 报告类型未选择时有明确反馈（aria-live 辅助文本，属于核对输入反馈）', () => {
    expect(review).toContain('aria-live="polite"');
    expect(review).toContain('未匹配报告类型：报告仍可保存');
  });

  it('删除入选的三条筛选/趋势说明文本：ReportManager 成员/类型、趋势成员', () => {
    const manager = read('components/ReportManager.tsx');
    const trend = read('components/TrendView.tsx');
    // 需求删除的辅助说明不再渲染（不显示也不占布局）
    expect(manager).not.toContain('未选择成员，将显示全部成员。');
    expect(manager).not.toContain('未选择报告类型，将显示全部类型。');
    expect(trend).not.toContain('未选择成员：趋势将等待选择成员后展示。');
  });

  it('必备筛选控件与空态仍保留：成员/报告类型 select（TrendView）、「全部成员/全部类型」占位、report Type 必备提示', () => {
    const manager = read('components/ReportManager.tsx');
    const trend = read('components/TrendView.tsx');
    expect(manager).toContain('<option value="">全部成员</option>');
    expect(manager).toContain('<option value="">全部类型</option>');
    expect(trend).toContain("请选择检查项目' : '先选择成员'");
    expect(trend).toContain('label="检查项目 *"');
    expect(trend).toContain('EmptyState');
  });
});
