import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 需求：趋势界面「查看报告」进入生产报告的只读详情（ReportDetailView），
 * 不再进入 ReportReview 编辑界面。
 *
 * 契约校验（源级）：
 * - App 趋势分支渲染 ReportDetailView（只读），趋势「查看报告」不再触发编辑回调；
 * - 只读视图不含保存 / 删除 / 修改入口，但提供编辑入口和返回操作；
 * - 报告列表/管理页的编辑入口（ReportManager → onEdit → ReportReview）保持不变。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, 'src', p), 'utf-8');
/** 去空白匹配，避免对 prettier 换行敏感。 */
const s = (src: string, fragment: string) =>
  src.replace(/\s+/g, '').includes(fragment.replace(/\s+/g, ''));

const app = read('App.tsx');
const detail = read('components/ReportDetailView.tsx');
const trend = read('components/TrendView.tsx');
const manager = read('components/ReportManager.tsx');

describe('趋势「查看报告」进入只读详情（不再进入编辑）', () => {
  it('App 趋势分支渲染 ReportDetailView（只读），并提供只读返回', () => {
    expect(app).toContain("import { ReportDetailView } from './components/ReportDetailView'");
    expect(app).toContain('<ReportDetailView');
    expect(app).toContain('onClose={() => setReadOnlyReport(null)}');
  });

  it('趋势「查看报告」不再调用编辑回调/跳转报告列表编辑：gotoReport 只设置只读态', () => {
    // 趋势分支不再把报告设为 editingReport，也不 setTab('reports')
    expect(app).toContain('gotoReport={(r) => setReadOnlyReport(r)}');
    expect(s(app, 'readOnlyReport ? (<ReportDetailView')).toBe(true);
  });

  it('TrendView 自身不再提供编辑回调：查看报告始终走 gotoReport（只读入口）', () => {
    expect(trend).toContain('gotoReport: (r: Report) => void;');
    expect(trend).toContain('查看报告');
    // 趋势界面上没有保存/删除/编辑按钮
    expect(trend).not.toContain('保存');
    expect(trend).not.toContain('删除');
  });
  it('趋势「查看报告」返回后筛选/图表状态保留：TrendView 以 display:none 保持挂载，而非卸载', () => {
    expect(s(app, "display: readOnlyReport ? 'none' : undefined")).toBe(true);
    expect(app).toContain('gotoReport={(r) => setReadOnlyReport(r)}');
  });
});

describe('只读详情视图无保存/删除/修改入口，但提供编辑入口', () => {
  it('不渲染保存、删除、修改动作', () => {
    expect(detail).not.toContain('保存报告');
    expect(detail).not.toContain('删除该项目');
    expect(detail).not.toContain('deleteReportCascade');
    expect(detail).not.toContain('editingReport');
    expect(detail).not.toContain('canSave');
    // 不引用/渲染确认删除、新增附件`添加`、保存等编辑面控件
    expect(detail).not.toContain('ConfirmButton');
  });

  it('只读详情提供编辑入口：onEdit 回调渲染「编辑」按钮，App 由详情切到编辑表单', () => {
    expect(detail).toContain('onEdit?: (report: Report) => void;');
    expect(detail).toContain('onClick={() => onEdit(report)}');
    expect(detail).toContain('编辑');
    expect(app).toContain('onEdit={openEditFromDetail}');
    expect(app).toContain('const openEditFromDetail');
  });

  it('只读视图提供明确的返回操作', () => {
    expect(detail).toContain('返回');
    expect(detail).toContain('onClick={onClose}');
    expect(detail).toContain('onClose: () => void;');
  });

  it('报告基础信息 → 检查项目 → 报告详情顺序保持，详情默认折叠', () => {
    const order = detail.indexOf('readonly-basic');
    const itemsSection = detail.indexOf('ro-section');
    const detailsSection = detail.indexOf('details-section');
    expect(order).toBeGreaterThan(-1);
    expect(itemsSection).toBeGreaterThan(order);
    expect(detailsSection).toBeGreaterThan(itemsSection);
    expect(detail).toContain('const [detailsOpen, setDetailsOpen] = useState(false)');
    expect(detail).toContain('aria-expanded={detailsOpen}');
  });

  it('保留 lab/imaging/other、reportTypes、imaging.exams、附件、testPurpose 展示', () => {
    expect(detail).toContain('normalizeReportTypes');
    expect(detail).toContain('reportKind');
    expect(detail).toContain('imagingExams');
    expect(detail).toContain('attachments');
    expect(detail).toContain('testPurpose');
    expect(detail).toContain('附件');
  });
});

describe('列表查看/编辑入口仍为可编辑（仅趋势「查看报告」改只读）', () => {
  it('ReportManager 列表「编辑」保持 onEdit 入口', () => {
    expect(manager).toContain('onEdit: (r: Report) => void;');
    expect(manager).toContain('编辑');
    expect(manager).toContain('onClick={() => onEdit(r)}');
  });

  it('报告列表卡片为摘要入口：点击 onView 打开只读详情（App 报告中 tab 也渲染 ReportDetailView）', () => {
    expect(manager).toContain('onView: (r: Report) => void;');
    expect(manager).toContain('onClick={() => onView(r)}');
    // App 报告 tab：点击列表卡片进入只读详情（readOnlyReport 态），并在该 tab 渲染 ReportDetailView
    expect(app).toContain('onView={(r) => setReadOnlyReport(r)}');
    expect(s(app, 'readOnlyReport ? (<ReportDetailView')).toBe(true);
  });

  it('App 报告列表编辑仍走 ReportReview（不因只读改造改变列表编辑路径）', () => {
    expect(app).toContain('<ReportReview');
    expect(app).toContain('editingReport={editingReport}');
    // 列表直接编辑：记录 source=list 后打开 ReportReview（返回回列表）
    expect(app).toContain("setEditOrigin('list')");
    expect(app).toContain('setEditingReport(r)');
  });
});
