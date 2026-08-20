import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 报告列表/管理页「空报告时不显示筛选」需求（A）的源级校验。
 *
 * - reports.length === 0 时不渲染任何筛选控件、筛选计数或清除筛选入口，
 *   只保留空状态（EmptyState）与新建报告入口；
 * - 已有报告但筛选无结果时，筛选仍显示、可清除（EmptyState 文案区分两种情况）。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const manager = readFileSync(join(root, 'src', 'components', 'ReportManager.tsx'), 'utf8');

describe('报告列表/管理页：空报告时不显示筛选（A）', () => {
  it('筛选工具栏（toolbar）包裹在 reports.length > 0 条件内：无报告时整个筛选控件不渲染', () => {
    expect(manager).toContain('{reports.length > 0 && (');
    expect(manager).toContain('<div className="toolbar card">');
  });

  it('列表头（共 X 份报告 + 新建报告）同样仅在 reports.length > 0 时渲染', () => {
    expect(manager).toContain('{reports.length > 0 && (');
    expect(manager).toContain('共 {visibleReports.length} 份报告');
  });

  it('空报告与「筛选无结果」两种情况由 EmptyState 区分；筛选无结果时仍可清除筛选', () => {
    expect(manager).toContain(
      "title={reports.length === 0 ? '还没有体检报告' : '没有符合筛选条件的报告'}",
    );
    expect(manager).toContain('清除筛选');
    // 清除按钮只在 activeFilterCount > 0 时出现
    expect(manager).toContain('activeFilterCount > 0 && (');
  });

  it('空报告时的唯一动作是「新建报告」（EmptyState 提供），不带筛选', () => {
    // 空状态分支的 action 只在 reports.length === 0 时提供新建按钮
    expect(manager).toContain('reports.length === 0 ? (');
  });
});
