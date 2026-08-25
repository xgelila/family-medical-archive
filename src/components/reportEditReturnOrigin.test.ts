import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 需求：报告详情页进入编辑后，返回/取消/保存应回到报告详情页（上一页），而不是报告列表。
 *
 * 实现：App.tsx 增加 editOrigin 记录编辑来源（'list' | 'detail'），
 * - 列表 onEdit 记 origin='list'（回到列表）；
 * - openEditFromDetail 记 origin='detail' 且不清空 readOnlyReport（作为返回目标）；
 * - closeForm 按 origin 决定返回目的页，详情来源保存成功后用 db.reports.get 重载最新报告。
 * 渲染优先级 editingReport 优先于 readOnlyReport 保持不变。
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, 'src', p), 'utf-8');
const s = (src: string, fragment: string) =>
  src.replace(/\s+/g, '').includes(fragment.replace(/\s+/g, ''));

const app = read('App.tsx');

describe('编辑来源记录（editOrigin）：详情进入编辑后返回详情页', () => {
  it('App.tsx 声明 editOrigin 状态（list | detail）', () => {
    expect(app).toContain(
      "const [editOrigin, setEditOrigin] = useState<'list' | 'detail'>('list')",
    );
  });

  it('列表直接编辑：onEdit 设置 origin=list 后开编辑表单', () => {
    expect(s(app, "onEdit={(r)=>{setEditOrigin('list');setEditingReport(r);}}")).toBe(true);
    expect(app).toContain("setEditOrigin('list')");
    expect(app).toContain('setEditingReport(r)');
  });

  it('详情进入编辑：openEditFromDetail 设置 origin=detail 且不清空 readOnlyReport（作为返回目标）', () => {
    expect(app).toContain("setEditOrigin('detail')");
    expect(app).toContain('setEditingReport(r)');
    // 不再清空 readOnlyReport
    expect(app).not.toMatch(/openEditFromDetail[\s\S]{0,80}setReadOnlyReport\(null\)/);
  });

  it('渲染优先级不变：editingReport 优先于 readOnlyReport（编辑时两者并存仍渲染编辑表单）', () => {
    expect(app).toContain('creatingReport || editingReport ?');
    expect(app).toContain('readOnlyReport ?');
    expect(app).toContain('<ReportReview');
    expect(app).toContain('editingReport={editingReport}');
  });
});

describe('closeForm 按来源返回目的页', () => {
  it('closeForm 记录 origin 与 readOnlyReport?.id，并清空 editingReport/creatingReport/editOrigin', () => {
    expect(app).toContain('const origin = editOrigin;');
    expect(app).toContain('const roId = readOnlyReport?.id;');
    expect(app).toContain("setEditOrigin('list')");
    expect(app).toContain('setEditingReport(null)');
    expect(app).toContain('setCreatingReport(false)');
  });

  it('origin=detail 且保存成功：用 db.reports.get(roId) 重载最新报告并 setReadOnlyReport', () => {
    expect(app).toContain("origin === 'detail' && roId");
    expect(app).toContain('const fresh = await db.reports.get(roId);');
    expect(app).toContain('if (fresh) setReadOnlyReport(fresh);');
  });

  it('origin=detail 取消（saved=false）也保留 readOnlyReport（编辑时未清空）从而回到详情页', () => {
    // saved 分支仅在 reload 时使用；取消时 readOnlyReport 仍在 → 详情页渲染
    expect(app).toContain('if (saved) {\n        try {');
    expect(app).toContain('if (saved) bump();');
  });

  it('origin=list（列表直接编辑/新建）保持 readOnlyReport 为 null（回到列表）', () => {
    // closeForm 的 else 分支（非 detail 来源）清空只读详情 → 回到列表
    const closeFormStart = app.indexOf('const closeForm');
    const elseIdx = app.indexOf('} else {', closeFormStart);
    expect(elseIdx).toBeGreaterThan(closeFormStart);
    const tail = app.slice(elseIdx, elseIdx + 160);
    expect(tail).toContain('setReadOnlyReport(null)');
  });

  it('bump() 逻辑保持：保存成功后触发刷新', () => {
    expect(app).toContain('if (saved) bump();');
  });
});
