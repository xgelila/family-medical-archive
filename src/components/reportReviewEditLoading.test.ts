import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 阶段 1（P0 安全性）+ 阶段 3（移动端核对/编辑信息架构）的源级校验：
 *
 * 阶段 1 —— 编辑既有报告异步加载/保存竞态：
 * - 编辑模式加载项目/附件未完成时显示轻量加载态，禁用保存；
 * - 加载失败显示简短错误与「重试」；
 * - 仅当加载成功且 reportId 与编辑对象一致时允许保存（用 canSaveEditReport 门槛）；
 * - 不得用空数组覆盖既有项目/附件（保存前双重校验）。
 *
 * 阶段 3 —— 核对/编辑移动端：
 * - 移动端项目卡片（item-cards-mobile）与桌面宽表格（item-table-desktop）并存；
 * - 卡片首屏只显示状态/项目名/结果/单位，低频字段放「更多」折叠；
 * - 删除放卡片底部危险操作区（item-card-danger）；
 * - 待确认数量显示在标题附近并提供「定位下一项」；
 * - 不显示 standardLabel。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, 'src', p), 'utf-8');

const review = read('components/ReportReview.tsx');
const styles = readFileSync(join(root, 'src', 'styles.css'), 'utf-8');

describe('阶段 1：编辑加载竞态 —— 加载态 / 失败重试 / 保存门槛', () => {
  it('编辑模式有明确加载状态（loading），并显示轻量加载文字', () => {
    expect(review).toContain("setEditStatus('loading')");
    expect(review).toContain('正在加载既有项目与附件…');
    expect(review).toContain('正在加载检查项目…');
  });

  it('加载失败显示简短错误与「重试」（retryEditLoad）', () => {
    expect(review).toContain("setEditStatus('error')");
    expect(review).toContain('setEditError(');
    expect(review).toContain('retryEditLoad');
    expect(review).toContain('重试');
  });

  it('仅当加载成功且 reportId 与编辑对象一致时允许保存（canSaveEditReport 门槛 + save 双重校验）', () => {
    expect(review).toContain("import {\n  canSaveEditReport,");
    expect(review).toContain('const editReady = canSaveEditReport(');
    expect(review).toContain('const canSave = fieldsReady && editReady;');
    expect(review).toContain("if (editingReport && (editStatus !== 'ready' || loadedReportId !== editingReport.id)) return;");
  });

  it('保存按钮在编辑加载完成前禁用（disabled 含 editReady 与 busy）', () => {
    expect(review).toContain('disabled={!canSave || busy}');
  });

  it('新建模式不增加等待（非编辑时 editStatus 置 idle，不阻塞保存）', () => {
    expect(review).toContain("setEditStatus('idle');");
    expect(review).toContain('if (!editingReport) {');
  });
});

describe('阶段 3：核对/编辑移动端信息架构', () => {
  it('桌面宽表格（item-table-desktop）与移动端项目卡片（item-cards-mobile）并存', () => {
    expect(review).toContain('className="table-wrap item-table-desktop"');
    expect(review).toContain('className="item-cards-mobile"');
    expect(styles).toContain('.item-table-desktop');
    expect(styles).toContain('.item-cards-mobile');
  });

  it('移动端卡片：状态第一、含项目名/结果/单位，低频字段放「更多」折叠', () => {
    expect(review).toContain('item-card-top');
    expect(review).toContain('aria-pressed={it.confirmed}');
    expect(review).toContain('item-card-more-toggle');
    expect(review).toContain('更多（参考区间 / 检验方法 / 备注）');
    expect(review).toContain('item-card-more');
  });

  it('删除放在卡片底部危险操作区（item-card-danger）', () => {
    expect(review).toContain('className="item-card-danger"');
    expect(review).toContain('删除该项目');
  });

  it('待确认数量显示在标题附近并提供「定位下一项」按钮', () => {
    expect(review).toContain('{pendingCount} 项待确认');
    expect(review).toContain('定位下一项');
    expect(review).toContain('scrollToPending');
    expect(review).toContain('data-item-pending="true"');
  });

  it('检查项目状态仍是第一信息，不显示 standardLabel', () => {
    expect(review).toContain('className="col-status">状态</th>');
    expect(review).not.toContain('标准标签（可选）');
    expect(review).not.toContain('col-label');
  });
});
