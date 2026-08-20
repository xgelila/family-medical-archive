import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { testPurposeToReportType } from '../utils/ocrCandidate';

/**
 * 编辑入口 + 检验目的/报告类型语义分离（源级 + 纯函数校验）。
 *
 * 覆盖本轮需求：
 * 1. 编辑已有报告必须进入重新设计的统一编辑/核对界面（ReportReview），
 *    不得回到旧识别界面或旧 ReportForm；
 * 2. 检验目的（testPurpose）与报告类型/检查类别（reportType）是两个独立概念：
 *    - 检验目的是报告结构的固定字段（如「血红蛋白」「糖化血红蛋白」），独立于报告类型；
 *    - 报告类型是严格受控选项列表；检验目的无法匹配受控列表时，报告类型保持为空，
 *      检验目的仍作为独立固定字段显示/保存，绝不把检验目的伪装成报告类型。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, 'src', p), 'utf-8');

const app = read('App.tsx');
const review = read('components/ReportReview.tsx');

describe('编辑入口：编辑已有报告进入统一编辑/核对界面（ReportReview），不挂旧界面', () => {
  it('App.tsx 编辑分支渲染 ReportReview 而非旧 ReportForm', () => {
    expect(app).toContain("import { ReportReview } from './components/ReportReview'");
    // 不再导入 / 渲染旧 ReportForm
    expect(app).not.toContain("from './components/ReportForm'");
    expect(app).not.toContain('<ReportForm');
  });

  it('编辑分支把 editingReport 传给 ReportReview，且不触发创建向导', () => {
    // 编辑（editingReport 非空）走 ReportReview；创建（creatingReport 且非编辑）走 NewReportWizard
    expect(app).toContain('creatingReport && !editingReport ?');
    expect(app).toContain('<ReportReview');
    expect(app).toContain('editingReport={editingReport}');
  });

  it('ReportReview 支持编辑模式：接收 editingReport 并从其初始化/加载项目附件', () => {
    expect(review).toContain('editingReport?: Report | null');
    expect(review).toContain('editingReport?.memberId');
    expect(review).toContain('editingReport?.hospital');
    expect(review).toContain("db.items.where('reportId').equals(editingReport.id)");
    expect(review).toContain("db.attachments.where('reportId').equals(editingReport.id)");
  });

  it('ReportReview 编辑模式保存保持报告 id 与 createdAt，并支持附件移除/添加', () => {
    expect(review).toContain('const reportId = editingReport?.id ?? uid();');
    expect(review).toContain('createdAt: editingReport?.createdAt ?? ts,');
    expect(review).toContain('removeAttachment');
    expect(review).toContain('+ 添加图片/PDF 附件');
  });

  it('ReportReview 编辑模式不挂载旧识别面板', () => {
    expect(review).not.toContain("from './ReportRecognitionPanel'");
    expect(review).not.toContain('<ReportRecognitionPanel');
  });
});

describe('语义分离：检验目的（testPurpose）≠ 报告类型（reportType）', () => {
  it('血红蛋白/糖化血红蛋白 作为检验目的，不匹配任何受控报告类型（映射返回空串）', () => {
    // 检验目的原文（如单查血红蛋白/糖化血红蛋白）绝不强行映射成报告类型
    expect(testPurposeToReportType('血红蛋白')).toBe('');
    expect(testPurposeToReportType('糖化血红蛋白')).toBe('');
    expect(testPurposeToReportType('健康体检')).toBe('');
  });

  it('仅当检验目的包含受控 REPORT_TYPES 时才回填报告类型候选', () => {
    expect(testPurposeToReportType('血常规检查')).toBe('血常规');
    expect(testPurposeToReportType('肝功能检验')).toBe('肝功能');
  });

  it('ReportReview 把检验目的作为独立固定字段（Field 检验目的），与报告类型分开显示', () => {
    expect(review).toContain('<Field label="报告类型 / 检查类别"');
    expect(review).toContain('<Field label="检验目的"');
    // 报告类型受控 select 与检验目的 input 是两个独立字段
    expect(review).toContain('initialReportMeta?.testPurpose ??');
    expect(review).toContain('testPurpose: testPurpose.trim(),');
  });

  it('ReportReview 报告类型 select 仅受控选项 + 保留原值；检验目的不塞进报告类型', () => {
    expect(review).toContain('allTypes.map((t) =>');
    expect(review).toContain('（不选择）');
  });
});

describe('未匹配检验目的三选一（ReportReview 源级校验）', () => {
  it('包含「发现新的检验类别」提示与三种操作（保存新类型/选择已有/暂不设置）', () => {
    expect(review).toContain('发现新的检验类别');
    expect(review).toContain('作为新的报告类型保存');
    expect(review).toContain('手动选择已有类型');
    expect(review).toContain('暂不设置');
  });

  it('不强行把血红蛋白分类为血常规：文案声明 AI 仅作建议、不会强行归类', () => {
    expect(review).toMatch(/AI\s*仅作建议/);
    expect(review).toContain('不会把条目强行归类');
    expect(review).toContain('血红蛋白');
  });

  it('确认新增后写入 DB 并立即选中：调用 addCustomReportType 且 setReportType(rec.name)', () => {
    expect(review).toContain('addCustomReportType(');
    expect(review).toContain('setReportType(rec.name)');
  });

  it('报告类型下拉合并内置 + 我的报告类型（allTypes = mergeReportTypes(customTypes)）', () => {
    expect(review).toContain('mergeReportTypes(customTypes)');
    expect(review).toContain('allTypes.map((t) =>');
  });
});
