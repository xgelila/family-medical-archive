import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cleanAiReportStructured } from './aiStructure';
import { REPORT_FIELD_KEYS } from '../shared/structureSchema';
import { REPORT_STRUCTURE_SYSTEM_PROMPT } from '../shared/structurePrompt';
import { testPurposeToReportType } from './ocrCandidate';

/**
 * 检验目的（testPurpose）真实协议链路测试。
 *
 * 覆盖需求 D：
 * - 请求侧 JSON 结构化 schema 的 report 明确包含 testPurpose（中文语义「检验目的」，非项目名）；
 * - 服务端提示词明确要求每张整张报告必填该字段（看不出时填空字符串，严禁编造）；
 * - 响应解析（cleanAiReportStructured）不会因 allowlist/schema 清洗丢弃 testPurpose；
 * - 映射：testPurpose 优先规范化映射为受控 REPORT_TYPES；无法映射时不伪造类型（reportType 保持空），
 *   且检验目的作为报告结构的固定字段独立保存/展示，绝不混入 details/附件信息或通用附加列表；
 * - 核对页（ReportReview）把识别出的 testPurpose 映射进 reportType，并作为固定「检验目的」字段显示。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, 'src', p), 'utf-8');
const review = read('components/ReportReview.tsx');

describe('请求侧：报告结构 schema 明确包含 testPurpose 字段', () => {
  it('REPORT_FIELD_KEYS 包含 testPurpose（位于 report 固定字段中）', () => {
    expect(REPORT_FIELD_KEYS).toContain('testPurpose');
  });

  it('固定 schema JSON（报告字段清单）包含 "testPurpose" 键，供模型输出', () => {
    // FIXED_SCHEMA_JSON 由 REPORT_FIELD_KEYS 生成，两端都必须含该键
    expect(REPORT_STRUCTURE_SYSTEM_PROMPT).toContain('"testPurpose":""');
  });
});

describe('请求侧：提示词明确要求每张整张报告必填检验目的（看不出填空字符串）', () => {
  it('整张报告提示词声明 testPurpose 为必填并解释中文语义「检验目的」', () => {
    expect(REPORT_STRUCTURE_SYSTEM_PROMPT).toContain('testPurpose=检验目的');
    expect(REPORT_STRUCTURE_SYSTEM_PROMPT).toContain('必填');
    expect(REPORT_STRUCTURE_SYSTEM_PROMPT).toContain('严禁编造');
  });

  it('「检验目的」是中文语义（检验/送检/检查目的），非项目名称', () => {
    expect(REPORT_STRUCTURE_SYSTEM_PROMPT).toMatch(/检验目的/);
    expect(REPORT_STRUCTURE_SYSTEM_PROMPT).not.toContain('testPurpose=项目名称');
  });
});

describe('响应解析：testPurpose 不被 allowlist/schema 清洗丢弃', () => {
  const SENT = '市第一人民医院 2026-01-05 血常规检查\n血红蛋白 145 g/L';

  it('cleanAiReportStructured 保留 report.testPurpose（正例）', () => {
    const got = cleanAiReportStructured(
      {
        report: {
          hospital: '市第一人民医院',
          reportDate: '2026-01-05',
          testPurpose: '血常规检查',
        },
        items: [
          {
            name: '血红蛋白',
            result: '145',
            unit: 'g/L',
            referenceRange: '',
            sourceText: '血红蛋白 145 g/L',
            confidence: 0.9,
          },
        ],
        unresolvedText: '',
      },
      SENT,
    );
    expect(got.report.testPurpose).toBe('血常规检查');
  });

  it('testPurpose 缺失/空白时补空串，不猜测（负例）', () => {
    const got = cleanAiReportStructured({ report: { hospital: 'A' }, items: [] }, SENT);
    expect(got.report.testPurpose).toBe('');
  });
});

describe('映射：testPurpose 优先规范化映射为受控 REPORT_TYPES，无法映射则不伪造类型、不混入 details', () => {
  it('包含命中受控 REPORT_TYPES 时返回对应报告类型', () => {
    expect(testPurposeToReportType('血常规检查')).toBe('血常规');
    expect(testPurposeToReportType('肝功能检验')).toBe('肝功能');
    expect(testPurposeToReportType('甲状腺功能复查')).toBe('甲状腺功能');
  });

  it('无法映射到受控 REPORT_TYPES 时返回空串（不伪造类型）', () => {
    expect(testPurposeToReportType('健康体检')).toBe('');
    expect(testPurposeToReportType('年度复查')).toBe('');
    expect(testPurposeToReportType('')).toBe('');
  });

  it('识别面板不再把 testPurpose 注入附加信息/通用 details 列表（REPORT_EXTRA_LABELS 不含 检验目的）', () => {
    const panel = read('components/ReportRecognitionPanel.tsx');
    // 检验目的必须是固定字段，不得作为附加信息/details 字段
    expect(panel).not.toContain("['testPurpose', '检验目的']");
    expect(panel).toContain('matchTestPurposeToType');
    // 面板把检验目的保留在报告元数据固定字段中（reportMeta.testPurpose），而非 details
    expect(panel).toContain('testPurpose: reportMeta.testPurpose.trim()');
  });
});

describe('核对页：testPurpose 进入 reportType 且作为固定「检验目的」字段', () => {
  it('ReportReview 用 initialReportMeta.reportType 作为报告类型 select 的值', () => {
    expect(review).toContain('initialReportMeta?.reportType ??');
    expect(review).toContain('报告类型 / 检查类别');
  });

  it('ReportReview 把「检验目的」做成固定字段，与医院/日期/报告类型并列，默认可见可编辑', () => {
    expect(review).toContain('initialReportMeta?.testPurpose ??');
    expect(review).toContain('<Field label="检验目的">');
  });

  it('ReportReview 保存时把 testPurpose 作为报告固定字段写入（不入 details）', () => {
    expect(review).toContain('testPurpose: testPurpose.trim(),');
  });
});
