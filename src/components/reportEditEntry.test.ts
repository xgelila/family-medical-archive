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
const dataManager = read('components/DataManager.tsx');
const typeManager = read('components/ReportTypeManager.tsx');

describe('编辑入口：编辑已有报告进入统一编辑/核对界面（ReportReview），不挂旧界面', () => {
  it('App.tsx 编辑分支渲染 ReportReview 而非旧 ReportForm', () => {
    expect(app).toContain("import { ReportReview } from './components/ReportReview'");
    // 不再导入 / 渲染旧 ReportForm
    expect(app).not.toContain("from './components/ReportForm'");
    expect(app).not.toContain('<ReportForm');
  });

  it('编辑分支把草稿会话的 report 传给 ReportReview，且不触发创建向导', () => {
    // 导航栈：reportEdit 时 current 归入 reports；编辑器由 App 层的持久编辑层渲染
    expect(app).toContain("current.name === 'reportEdit'");
    expect(app).toContain('editSession.mode === \'new\'');
    expect(app).toContain('<NewReportWizard');
    expect(app).toContain('<ReportReview');
    expect(app).toContain('editingReport={editSession.report}');
  });

  it('ReportReview 支持编辑模式：接收 editingReport 并从其加载项目/附件', () => {
    expect(review).toContain('editingReport?: Report | null');
    expect(review).toContain('editingReport?.memberId');
    expect(review).toContain('editingReport?.hospital');
    // 编辑模式通过可单测的加载器从数据库读取既有项目/附件（含加载竞态保护）
    expect(review).toContain('import {');
    expect(review).toContain('loadEditReportData');
    expect(review).toContain('canSaveEditReport');
  });

  it('ReportReview 编辑模式保存保持报告 id 与 createdAt，并支持附件移除/添加', () => {
    expect(review).toContain('const reportId = editingReport?.id ?? uid();');
    expect(review).toContain('createdAt: editingReport?.createdAt ?? ts,');
    expect(review).toContain('removeAttachment');
    expect(review).toContain('添加图片/PDF 附件');
  });

  it('ReportReview 编辑模式不挂载旧识别面板', () => {
    expect(review).not.toContain("from './ReportRecognitionPanel'");
    expect(review).not.toContain('<ReportRecognitionPanel');
  });
});

describe('语义分离：检验目的（testPurpose）≠ 报告类型（reportType）', () => {
  it('血红蛋白 作为检验目的，不匹配任何受控报告类型（映射返回空串）；糖化血红蛋白/血糖 现为独立报告类型', () => {
    // 血红蛋白（非糖化）仍不是受控报告类型，绝不强行映射
    expect(testPurposeToReportType('血红蛋白')).toBe('');
    // 拆分后：糖化血红蛋白 / 血糖 均为受控报告类型，精确映射
    expect(testPurposeToReportType('糖化血红蛋白')).toBe('糖化血红蛋白');
    expect(testPurposeToReportType('血糖')).toBe('血糖');
    expect(testPurposeToReportType('健康体检')).toBe('');
  });

  it('仅当检验目的包含受控 REPORT_TYPES 时才回填报告类型候选', () => {
    expect(testPurposeToReportType('血常规检查')).toBe('血常规');
    expect(testPurposeToReportType('肝功能检验')).toBe('肝功能');
  });

  it('ReportReview 把检验目的作为独立固定字段（Field 检验目的），与报告类型分开显示', () => {
    expect(review.replace(/\s+/g, '')).toContain('className="report-type-title">报告类型 / 检查类别'.replace(/\s+/g, ''));
    expect(review.replace(/\s+/g, '')).toContain('<Field label="检验目的"'.replace(/\s+/g, ''));
    expect(review).toContain('initialReportMeta?.testPurpose ??');
    expect(review).toContain('testPurpose: testPurpose.trim(),');
  });

  it('ReportReview 报告类型 select 仅受控选项 + 保留原值；检验目的不塞进报告类型', () => {
    expect(review).toContain('visibleTypes.map((t) =>');
    expect(review.replace(/\s+/g, '')).toContain(
      '<input type="checkbox"name="report-type"'.replace(/\s+/g, ''),
    );
    expect(review).toContain('reportTypes');
  });
});

describe('未匹配检验目的的一次性保存建议（ReportReview 源级校验）', () => {
  it('包含轻量一次性建议：将检验目的保存为新的报告类型，并提供取消', () => {
    expect(review).toContain('将「');
    expect(review).toContain('保存为新的报告类型');
    expect(review).toContain('取消');
  });

  it('不展示常态化的自定义报告类型管理区（列表/删除/新增输入/空态说明）', () => {
    expect(review).not.toContain('我的报告类型（自定义）');
    expect(review).not.toContain('内置类型不可删除');
    expect(review).not.toContain('新增自定义报告类型名称');
    expect(review).not.toContain('custom-types-manage');
    expect(review).not.toContain('handleAddCustomType');
    expect(review).not.toContain('handleDeleteCustomType');
  });

  it('确认新增后写入 DB 并立即选中：调用 addCustomReportType 且 setReportType(rec.name)', () => {
    expect(review).toContain('addCustomReportType(');
    expect(review).toContain('setReportType(rec.name)');
  });

  it('报告类型下拉合并内置 + 我的报告类型（allTypes = mergeReportTypes(customTypes)）', () => {
    expect(review).toContain('mergeReportTypes(customTypes)');
    expect(review).toContain('visibleTypes.map((t) =>');
  });
});

describe('自定义报告类型管理：共享面板 + 当前页弹层（不再跳转 DataManager）', () => {
  it('DataManager 复用共享管理面板（不复制第二套增删改存储逻辑）', () => {
    expect(dataManager).toContain('自定义报告类型管理');
    expect(dataManager).toContain('<ReportTypeManagerPanel');
    // DataManager 自身不再内嵌增删改存储逻辑（已抽取到共享面板/工具）
    expect(dataManager).not.toContain('handleDeleteCustomType');
    expect(dataManager).not.toContain('await db.customReportTypes.put');
  });

  it('共享面板 ReportTypeManager 包含完整管理（内置只读 / 自定义删除 / 手动新增），且复用 customReportTypes 工具', () => {
    expect(typeManager).toContain('内置类型（不可删除）');
    expect(typeManager).toContain('我的报告类型（自定义）');
    expect(typeManager).toContain('新增自定义报告类型名称');
    expect(typeManager).toContain('addCustomReportType(');
    expect(typeManager).toContain('deleteCustomReportType(');
    // 持久化复用工具函数，不复制存储代码
    expect(typeManager).not.toContain('await db.customReportTypes.put');
  });

  it('App 数据管理分支渲染 DataManager，且不新增无关顶级导航', () => {
    expect(app).toContain("import { DataManager } from './components/DataManager'");
    expect(app).toContain('<DataManager bump={bump} />');
    // App 不再为了管理类型切 tab（不再调用 setTab('data') 的管理入口）
    expect(app).not.toContain('onManageTypes');
  });
});
