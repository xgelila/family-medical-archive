import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 需求：报告草稿跨一级导航保持（新建/编辑过程中切换 Tab 再回来，表单内容/步骤/
 * 识别结果/检查项目/附件不能丢），避免编辑子栈被 switchTab 重置为根时组件卸载丢状态。
 *
 * 契约（源级校验）：
 * - App 在顶层持有持久化的草稿会话 editSession（type EditSession：new | edit{report}）；
 * - 编辑器在持久层渲染，挂载条件只依赖 editSession 是否存在（而非当前路由），
 *   因此 switchTab（把导航栈复位到 tab 根）不会卸载编辑器；
 * - 组件用稳定 key，切走再切回复用同一实例，内部 state（含附件 blob/data URL）不被重建；
 * - 用 element.css hidden 隐藏（而非卸载），保持组件挂载以保证文件/blob 资源生命周期延长；
 * - 会话仅在「保存成功」或显式「取消」时清空（closeReportForm / cancelEdit → setEditSession(null)）。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, 'src', p), 'utf-8');
const s = (src: string, fragment: string) =>
  src.replace(/\s+/g, '').includes(fragment.replace(/\s+/g, ''));

const app = read('App.tsx');
const styles = readFileSync(join(root, 'src', 'styles.css'), 'utf-8');

describe('App 层持久的编辑/新建草稿会话（keep-alive）', () => {
  it('声明 EditSession 类型：new | edit{report}，并持有一个顶层 editSession 状态', () => {
    expect(app).toContain('type EditSession =');
    expect(app).toContain("| { mode: 'new' }");
    expect(app).toContain("| { mode: 'edit'; report: Report }");
    expect(app).toContain('useState<EditSession | null>(null)');
  });

  it('openEdit 进入编辑器：report=null 走新建，report 非空走编辑', () => {
    expect(app).toContain('const openEdit = useCallback(');
    expect(app).toContain("report === null ? { mode: 'new' } : { mode: 'edit', report }");
    expect(s(app, "push({ name: 'reportEdit', report })")).toBe(true);
    // 首页「新建第一份报告」用 freshRoot 把栈复位到报告列表根
    expect(app).toContain("setStack([{ name: 'reports' }, { name: 'reportEdit', report }])");
  });

  it('openEdit 复用已存在的草稿会话（同 id 编辑 / 新建），不重新挂载', () => {
    expect(app).toContain("if (report === null && prev.mode === 'new') return prev;");
    expect(app).toContain("prev.mode === 'edit' && prev.report.id === report.id");
    expect(app).toContain('return prev; // 复用同一份报告已在进行中的编辑草稿');
  });

  it('编辑器在持久层渲染：仅依赖 editSession 是否存在，而不依赖当前路由，切 Tab 不卸载', () => {
    // 渲染条件必须是 editSession（而非 current.name==='reportEdit'）——这是 keep-alive 的关键
    expect(s(app, '{editSession && (')).toBe(true);
    expect(s(app, 'key="report-editor-layer"')).toBe(true);
    // 当前路由非 reportEdit 时仅加 editor-hidden 隐藏，组件仍挂载
    expect(app).toContain("current.name === 'reportEdit' ? 'editor-layer'");
    expect(app).toContain(": 'editor-layer editor-hidden'");
    expect(app).toContain("aria-hidden={current.name !== 'reportEdit'}");
  });

  it('新建 / 编辑组件使用稳定 key，切走再切回复用同一实例（内部草稿/附件不被重建）', () => {
    expect(app).toContain('key="report-edit-new"');
    expect(app).toContain('key={`report-edit-${editSession.report.id}`}');
  });

  it('新建向导与编辑核对都挂在持久层并沿用 onDone/onCancel/编辑输入', () => {
    expect(app).toContain('<NewReportWizard');
    expect(app).toContain('onCancel={cancelEdit}');
    expect(app).toContain('onDone={closeReportForm}');
    expect(app).toContain("onGoToMembers={() => switchTab('members')}");
    expect(app).toContain('<ReportReview');
    expect(app).toContain('editingReport={editSession.report}');
    expect(app).toContain('initialMemberId={editSession.report.memberId}');
  });

  it('会话生命周期：保存成功或显式取消才清空草稿，切 Tab（switchTab）不清空', () => {
    // 保存/取消 → setEditSession(null)
    expect(app).toContain('setEditSession(null);');
    expect(app).toContain('const cancelEdit = useCallback(() => {');
    // switchTab 只重建导航栈根（并针对 reports 恢复编辑子栈），不触碰草稿会话
    expect(app).toContain('const switchTab = useCallback(');
    expect(app).toContain('setStack([{ name: t } as Route]);');
  });

  it('切编辑→其他 tab→再切回 reports：恢复「报告根 + reportEdit」子栈，编辑器自动显示并复用草稿实例', () => {
    // 未进行草稿时切回 reports 仍回到报告根（不影响其它 tab 行为）
    expect(app).toContain("if (t === 'reports' && editSession) {");
    // 进行中草稿时回到报告根 + reportEdit：current 变回 reportEdit，keep-alive 层自动显示
    expect(app).toContain("{ name: 'reports' },");
    expect(app).toContain("{ name: 'reportEdit', report: editSession.mode === 'new' ? null : editSession.report },");
    // 其它 tab 仍回根
    expect(app).toContain('setStack([{ name: t } as Route]);');
  });

  it('editor-hidden 用 display:none 隐藏（非卸载），保持编辑器挂载与 blob 生命周期', () => {
    expect(styles).toContain('.editor-hidden {\n  display: none;\n}');
    expect(styles).toContain('.editor-layer');
  });
});