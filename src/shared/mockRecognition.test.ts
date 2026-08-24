import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCleanSentText,
  cleanAiReportStructured,
  cleanAiStructured,
  isMockStructuredReply,
} from '../utils/aiStructure';
import type { RecognizeMode } from './recognizeProtocol';
import {
  adaptSampleToPayload,
  buildMockRecognizeContent,
  isMockRecognitionEnabled,
  mockDelayMs,
  readMockSample,
  resolveSamplePath,
} from './mockRecognition';

/**
 * 识别 mock（开发环境）测试：
 * - 开关：MOCK_RECOGNITION=true 启用；未设置 / 其它值保持真实行为（不回归）；
 * - sample 解析：只从 docs/sample.json 读取；适配为与真实识别接口相同的
 *   report/items/extraFields/notes/unresolvedText 结构；
 * - 保留 report.testPurpose、items、details（→report 字段 + extraFields）、report meta；
 * - mock 不进入上游：buildMockRecognizeContent 不调用 fetch / 网络 / 任何上游；
 * - 真实模式不回归：默认开关关闭，真实识别路径不受影响。
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isMockRecognitionEnabled（开关，默认关闭不回归）', () => {
  it('未设置时返回 false（保持真实行为）', () => {
    expect(isMockRecognitionEnabled({})).toBe(false);
  });

  it('MOCK_RECOGNITION=true 时启用', () => {
    expect(isMockRecognitionEnabled({ MOCK_RECOGNITION: 'true' })).toBe(true);
  });

  it('其它值（false/1/空串）均视为未启用', () => {
    expect(isMockRecognitionEnabled({ MOCK_RECOGNITION: 'false' })).toBe(false);
    expect(isMockRecognitionEnabled({ MOCK_RECOGNITION: '1' })).toBe(false);
    expect(isMockRecognitionEnabled({ MOCK_RECOGNITION: '' })).toBe(false);
  });
});

describe('mockDelayMs（短暂模拟延迟，可关）', () => {
  it('未设置时回退默认 150ms', () => {
    expect(mockDelayMs({})).toBe(150);
  });

  it('读取 MOCK_RECOGNITION_DELAY_MS；0 表示不等待', () => {
    expect(mockDelayMs({ MOCK_RECOGNITION_DELAY_MS: '0' })).toBe(0);
    expect(mockDelayMs({ MOCK_RECOGNITION_DELAY_MS: '300' })).toBe(300);
  });

  it('非法值回退默认', () => {
    expect(mockDelayMs({ MOCK_RECOGNITION_DELAY_MS: 'abc' })).toBe(150);
  });
});

describe('sample 解析与适配（docs/sample.json 真实数据）', () => {
  it('从 docs/sample.json 读取，不改样品内容', () => {
    expect(resolveSamplePath()).toContain('docs/sample.json');
    const sample = readMockSample();
    expect(Array.isArray(sample.reports)).toBe(true);
    expect(Array.isArray(sample.items)).toBe(true);
    expect(sample.reports!.length).toBeGreaterThan(0);
    expect(sample.items!.length).toBeGreaterThan(0);
  });

  it('report 模式适配为统一识别结构，保留 report meta / testPurpose / details / items', () => {
    const sample = readMockSample();
    const payload = adaptSampleToPayload(sample, 'report');

    // 统一结构：report / items / extraFields / notes / unresolvedText
    expect(payload.report).toBeDefined();
    expect(Array.isArray(payload.items)).toBe(true);
    expect(Array.isArray(payload.extraFields)).toBe(true);
    expect(Array.isArray(payload.notes)).toBe(true);
    expect(typeof payload.unresolvedText).toBe('string');

    // report meta（医院 / 报告日期 / 类型 / 标题）来自 sample.reports[0]
    const rec = sample.reports![0];
    expect(payload.report.hospital).toBe(rec.hospital);
    expect(payload.report.reportDate).toBe(rec.reportDate);
    expect(payload.report.reportType).toBe(rec.reportType ?? '');
    expect(payload.report.title).toBe(rec.title ?? '');

    // report.testPurpose：从 details 的「检验目的」适配而来（保留）
    expect(payload.report.testPurpose).toBe('糖化血红蛋白');

    // details → report 固定字段（分院/报告编号/采样/接收/打印/送检医生/检验者/审核者）
    expect(payload.report.branch).toBe('滨江');
    expect(payload.report.reportNo).toBe('140861985100');
    expect(payload.report.sampleDate).toBe('2026-08-17');
    expect(payload.report.receiveDate).toBe('2026-08-17');
    expect(payload.report.printDate).toBe('2026-08-17');
    expect(payload.report.senderDoctor).toBe('俞莹莹');
    expect(payload.report.inspector).toBe('斐关等');
    expect(payload.report.reviewer).toBe('本如');

    // details 未命中 report 字段的进入 extraFields（含页脚 section）
    expect(payload.extraFields.length).toBeGreaterThan(0);
    expect(payload.extraFields.some((f) => f.section === 'footer')).toBe(true);

    // items 逐项适配（name/result/unit/refRange/method）
    expect(payload.items.length).toBe(sample.items!.length);
    const it = payload.items[0];
    expect(it.name).toBe(sample.items![0].name);
    expect(it.result).toBe(sample.items![0].value);
    expect(it.unit).toBe(sample.items![0].unit);
    expect(it.referenceRange).toBe(sample.items![0].refRange);
  });

  it('items 模式仅返回 items（report/详情为空），与「仅识别检查项目」语义一致', () => {
    const sample = readMockSample();
    const payload = adaptSampleToPayload(sample, 'items');
    expect(payload.items.length).toBe(sample.items!.length);
    expect(payload.report.hospital).toBe('');
    expect(payload.report.testPurpose).toBe('');
    expect(payload.extraFields).toHaveLength(0);
  });
});

describe('mock 内容与真实清洗路径（前端协议不变）', () => {
  it('buildMockRecognizeContent 返回可解析的统一结构，report 模式含 testPurpose 与 items', () => {
    const content = buildMockRecognizeContent('report');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed.report).toBeDefined();
    expect(parsed.items).toBeDefined();
    expect(parsed.extraFields).toBeDefined();
    expect(parsed.notes).toBeDefined();
    expect(parsed.unresolvedText).toBeDefined();
    expect((parsed.report as { testPurpose: string }).testPurpose).toBe('糖化血红蛋白');
  });

  it('report 模式经真实 cleanAiReportStructured 保留 report 字段与 details/extraFields', () => {
    const content = buildMockRecognizeContent('report');
    // 真实清洗路径（sentText 需包含项目名 sourceText，故用项目名拼出）
    const sample = readMockSample();
    const sentText = sample.items!.map((i) => i.name).join('\n');
    const cleaned = cleanAiReportStructured(JSON.parse(content), sentText);
    expect(cleaned.report.hospital).toBe('浙江大学医学院附属第二医院');
    expect(cleaned.report.testPurpose).toBe('糖化血红蛋白');
    expect(cleaned.items.length).toBe(sample.items!.length);
    expect(cleaned.extraFields.length).toBeGreaterThan(0);
  });

  it('items 模式经真实 cleanAiStructured 保留 items', () => {
    const content = buildMockRecognizeContent('items');
    const sample = readMockSample();
    const sentText = sample.items!.map((i) => i.name).join('\n');
    const cleaned = cleanAiStructured(JSON.parse(content), sentText);
    expect(cleaned.items.length).toBe(sample.items!.length);
  });

  it('mock report 返回 items 非空，且每项字段可被前端清洗解析（整张报告模式走项目列表）', () => {
    const content = buildMockRecognizeContent('report');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect((parsed.items as unknown[]).length).toBeGreaterThan(0);

    // 模拟真实运行：OCR 原文（字符被打散），不含 sample 干净项目名；
    // 用 mock 时前端补充的 grounding 文本（buildCleanSentText + includeParsedItemNames）走真实清洗路径。
    const realisticOcrText =
      '0 Preview Download\\n人\\n四 轩 力 [| 病案 与 国 国 多 临床 诊断 :\\n如 国 . v 检验 目的 : 糖化 血红 蛋白';
    const sentText = buildCleanSentText(parsed, realisticOcrText, {
      includeParsedItemNames: true,
    });
    const cleaned = cleanAiReportStructured(parsed, sentText);
    // 整张报告模式走项目列表：items 非空、每个项目字段可被解析
    expect(cleaned.items.length).toBeGreaterThan(0);
    expect(cleaned.items.length).toBe((parsed.items as unknown[]).length);
    for (const it of cleaned.items) {
      expect(it.name.trim()).not.toBe('');
      expect(it.result.trim()).not.toBe('');
      expect(typeof it.unit).toBe('string');
      expect(typeof it.referenceRange).toBe('string');
      expect(typeof it.method).toBe('string');
      expect(it.confirmed).toBe(false);
      expect(it.standardLabel).toBe('');
    }
  });

  it('buildCleanSentText 默认（真实模式）只用 OCR 原文；mock 开关才补入项目名', () => {
    const parsed = JSON.parse(buildMockRecognizeContent('report')) as Record<string, unknown>;
    const ocr = '原始 OCR 文本';
    expect(buildCleanSentText(parsed, ocr)).toBe(ocr); // 真实模式不补
    const grounded = buildCleanSentText(parsed, ocr, { includeParsedItemNames: true });
    expect(grounded.startsWith(ocr)).toBe(true);
    expect(grounded).toContain('糖化血红蛋白A1c'); // 项目名补入，未复制到其它源码
    expect(buildCleanSentText(null, ocr, { includeParsedItemNames: true })).toBe(ocr);
  });

  it('isMockStructuredReply：mock debug（无上游尝试）为真，真实 debug 为假', () => {
    expect(isMockStructuredReply({ upstreamTried: [], selectedUpstream: null })).toBe(true);
    expect(isMockStructuredReply(null)).toBe(false);
    expect(
      isMockStructuredReply({ upstreamTried: ['deepseek'], selectedUpstream: 'deepseek' }),
    ).toBe(false);
  });
});

describe('mock 不进入上游 / 真实模式不回归', () => {
  it('buildMockRecognizeContent 只读 sample，不调用任何 fetch / 网络 / 上游', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const content = buildMockRecognizeContent('report');
    expect(typeof content).toBe('string');
    expect(content.length).toBeGreaterThan(0);
    // 绝不调用网络 / 上游
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('默认（未设置 MOCK_RECOGNITION）开关关闭 → 真实模式不受影响', () => {
    expect(isMockRecognitionEnabled({ DEEPSEEK_API_KEY: 'k' })).toBe(false);
    expect(isMockRecognitionEnabled(process.env as Record<string, string>)).toBe(false);
  });

  it('适配层可处理结构缺失的样品（不抛错、字段置空）', () => {
    const payload = adaptSampleToPayload({}, 'report' as RecognizeMode);
    expect(payload.report.hospital).toBe('');
    expect(payload.items).toEqual([]);
    expect(payload.extraFields).toEqual([]);
  });
});
