import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 需求：报告详情页进入编辑后，返回/取消/保存应回到报告详情页（上一页），而不是报告列表。
 *
 * 实现：App.tsx 用统一导航栈（Route[] + push/pop）替代平铺 state：
 * - 列表 onView/onEdit、详情 onEdit、趋势 gotoReport 都是 push 到栈顶；
 * - 所有「返回」统一为 pop()，天然回到上一页；
 * - closeReportForm 保存成功后若返回目标是详情页，用 db.reports.get 重载最新报告。
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, 'src', p), 'utf-8');
const s = (src: string, fragment: string) =>
  src.replace(/\s+/g, '').includes(fragment.replace(/\s+/g, ''));

const app = read('App.tsx');

describe('统一导航栈（Route[] + push/pop）替代平铺状态', () => {
  it('App.tsx 声明 Route 类型与 stack 状态，并导出 push/pop/switchTab', () => {
    expect(app).toContain('type Route =');
    expect(app).toContain("| { name: 'reportDetail'; report: Report }");
    expect(app).toContain("| { name: 'reportEdit'; report: Report | null }");
    expect(app).toContain("useState<Route[]>([{ name: 'overview' }])");
    expect(app).toContain('const push = useCallback((r: Route) => setStack((s) => [...s, r]), []);');
    expect(app).toContain(
      'const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);',
    );
    expect(app).toContain('const switchTab = useCallback((t: Tab) => setStack([{ name: t } as Route]), []);');
  });

  it('列表 onView/onEdit 均 push（进入详情/编辑，不破坏列表层级）', () => {
    expect(s(app, "onCreate={() => push({ name: 'reportEdit', report: null })}")).toBe(true);
    expect(s(app, "onEdit={(r) => push({ name: 'reportEdit', report: r })}")).toBe(true);
    expect(s(app, "onView={(r) => push({ name: 'reportDetail', report: r })}")).toBe(true);
  });

  it('详情 onClose 返回上一页（pop），onEdit 进入编辑（push）', () => {
    expect(s(app, 'onClose={pop}')).toBe(true);
    expect(s(app, "onEdit={(r) => push({ name: 'reportEdit', report: r })}")).toBe(true);
  });
});

describe('closeReportForm：保存/取消返回上一页，保存后刷新返回目标', () => {
  it('编辑/新建 onDone 走 closeReportForm（pop 回上一页）', () => {
    expect(app).toContain('onDone={closeReportForm}');
    expect(app).toContain('const closeReportForm = async (saved: boolean) => {');
    expect(app).toContain('const target = stack[stack.length - 2];');
  });

  it('保存成功且返回目标为详情页：用 db.reports.get 重载最新报告', () => {
    expect(app).toContain("target?.name === 'reportDetail'");
    expect(app).toContain('const fresh = await db.reports.get(target.report.id);');
    expect(app).toContain("{ name: 'reportDetail', report: fresh }");
  });

  it('保存成功后调用 bump()，且最终 pop() 返回上一页', () => {
    expect(app).toContain('if (saved) {');
    expect(app).toContain('bump();');
    expect(app).toContain('pop();');
  });

  it('趋势 gotoReport 也是 push（进入详情，返回 pop 回到趋势且筛选状态保留）', () => {
    expect(s(app, "gotoReport={(r) => push({ name: 'reportDetail', report: r })}")).toBe(true);
    // 趋势筛选状态提升到 App 层（受控），栈 pop 回趋势时状态不丢
    expect(app).toContain('const [trendFilter, setTrendFilter] = useState');
    expect(app).toContain('memberId={trendFilter.memberId}');
    expect(app).toContain('name={trendFilter.name}');
    expect(app).toContain('onFilterChange={(patch) => setTrendFilter((f) => ({ ...f, ...patch }))}');
  });
});

describe('tab 切换清空栈回到根', () => {
  it('主导航点击 switchTab（回到该 tab 根，丢弃报告子栈）', () => {
    expect(app).toContain('onClick={() => switchTab(t.key)}');
    // activeTab 把 reportDetail/reportEdit 归入 reports
    expect(app).toContain("current.name === 'reportDetail' || current.name === 'reportEdit'");
  });
});
