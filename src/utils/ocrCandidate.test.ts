import { describe, expect, it } from 'vitest';
import { ocrCandidateToDraft, testPurposeToReportType, type OcrCandidate } from './ocrCandidate';

/**
 * OCR/AI 候选项共享类型的测试：
 * 覆盖「追加到批量编辑列表前的草稿映射」——恒为待确认、无标准标签。
 */

function cand(partial: Partial<OcrCandidate> = {}): OcrCandidate {
  return {
    name: '血红蛋白',
    displayName: '血红蛋白',
    resultKind: 'numeric',
    value: '145',
    unit: 'g/L',
    refRange: '130-175',
    confirmed: false,
    standardLabel: '',
    sourceLine: '血红蛋白 145 g/L 130-175',
    qualityHint: '',
    method: '',
    confidence: 95,
    avgConfidence: null,
    recommendedLabelId: '',
    recommendedLabel: '',
    labelStatus: '',
    labelConfidence: null,
    chosenLabel: '',
    ...partial,
  };
}

describe('testPurposeToReportType（检验目的 → 严格报告类型候选）', () => {
  it('精确/包含命中严格选项时返回对应报告类型', () => {
    expect(testPurposeToReportType('血常规')).toBe('血常规');
    expect(testPurposeToReportType('血常规检查')).toBe('血常规');
    expect(testPurposeToReportType('肝功能检验')).toBe('肝功能');
    expect(testPurposeToReportType('甲状腺功能复查')).toBe('甲状腺功能');
    expect(testPurposeToReportType('肿瘤标志物筛查')).toBe('肿瘤标志物');
  });

  it('拆分后：检验目的「血糖」映射血糖，「糖化血红蛋白」映射糖化血红蛋白（各自独立，互不误归）', () => {
    expect(testPurposeToReportType('血糖')).toBe('血糖');
    expect(testPurposeToReportType('糖化血红蛋白')).toBe('糖化血红蛋白');
    // 包含命中：空腹血糖/餐后血糖 归血糖；糖化血红蛋白报告 归糖化血红蛋白
    expect(testPurposeToReportType('空腹血糖')).toBe('血糖');
    expect(testPurposeToReportType('餐后2小时血糖')).toBe('血糖');
    expect(testPurposeToReportType('糖化血红蛋白A1c')).toBe('糖化血红蛋白');
    // 负例：二者互不为子串，不会相互误归（血糖 不会误归到 糖化血红蛋白，反之亦然）
    expect(testPurposeToReportType('糖化血红蛋白')).not.toBe('血糖');
    expect(testPurposeToReportType('血糖')).not.toBe('糖化血红蛋白');
    // 相关但非受控词：血红蛋白 不是受控报告类型
    expect(testPurposeToReportType('血红蛋白')).toBe('');
  });

  it('无命中（含空/空白/未识别）一律返回空串，绝不猜测回填', () => {
    expect(testPurposeToReportType('')).toBe('');
    expect(testPurposeToReportType('   ')).toBe('');
    expect(testPurposeToReportType('健康体检')).toBe('');
    expect(testPurposeToReportType('年度复查')).toBe('');
    expect(testPurposeToReportType(undefined as unknown as string)).toBe('');
  });

  it('首尾空白不影响命中；不含严格选项的文字不误判', () => {
    expect(testPurposeToReportType('  血常规  ')).toBe('血常规');
    expect(testPurposeToReportType('体检未检出异常')).toBe('');
  });
});

describe('ocrCandidateToDraft（追加到报告前的草稿映射）', () => {
  it('数值型候选映射为草稿行：保持原文字段、待确认、无标准标签', () => {
    const draft = ocrCandidateToDraft(cand());
    expect(draft).toMatchObject({
      name: '血红蛋白',
      resultKind: 'numeric',
      value: '145',
      unit: 'g/L',
      refRange: '130-175',
      notes: '',
      confirmed: false,
      standardLabel: '',
    });
  });

  it('定性候选映射为 qualitative 草稿行', () => {
    const draft = ocrCandidateToDraft(
      cand({ name: '尿蛋白', resultKind: 'qualitative', value: '阴性' }),
    );
    expect(draft.resultKind).toBe('qualitative');
    expect(draft.value).toBe('阴性');
    expect(draft.confirmed).toBe(false);
    expect(draft.standardLabel).toBe('');
  });

  it('映射函数总是输出安全默认值（待确认、无标准标签）', () => {
    const draft = ocrCandidateToDraft(cand({ resultKind: 'qualitative', value: '阳性' }));
    expect(draft.resultKind).toBe('qualitative');
    expect(draft.value).toBe('阳性');
    expect(draft.confirmed).toBe(false);
    expect(draft.standardLabel).toBe('');
  });

  it('推荐标签只是候选：即使带推荐字段，不采用时草稿标准标签仍为空、仍为待确认', () => {
    const draft = ocrCandidateToDraft(
      cand({
        name: 'Al 白蛋白',
        displayName: 'Al 白蛋白',
        recommendedLabelId: 'lab-alb',
        recommendedLabel: '白蛋白',
        labelStatus: 'ai',
        labelConfidence: 0.8,
      }),
    );
    expect(draft.confirmed).toBe(false);
    expect(draft.standardLabel).toBe(''); // 推荐绝不进入 standardLabel
    expect(draft.name).toBe('Al 白蛋白'); // 原文保留
  });

  it('用户显式「采用」后（chosenLabel）才带出标准标签，条目仍为待确认（不进入趋势）', () => {
    const draft = ocrCandidateToDraft(cand({ chosenLabel: '白蛋白' }));
    expect(draft.standardLabel).toBe('白蛋白');
    expect(draft.confirmed).toBe(false); // 趋势要求 confirmed=true，因此仍不会进入趋势
  });

  it('检验方法（method）进入草稿 testMethod 字段（检查项目字段），不再并入 notes/备注', () => {
    const draft = ocrCandidateToDraft(cand({ method: '化学发光法' }));
    expect(draft.testMethod).toBe('化学发光法');
    expect(draft.notes).toBe(''); // 不放入备注
    // 缺失方法 → 空串
    expect(ocrCandidateToDraft(cand({ method: '' })).testMethod).toBe('');
    expect(ocrCandidateToDraft(cand({ method: '   ' })).testMethod).toBe('   '); // 保留原文
  });

  it('采用后 standardLabel 与 chosenLabel 同时带出：草稿标准标签正确传递（含原始空格）', () => {
    const draft = ocrCandidateToDraft(
      cand({
        name: '  Al 白蛋白 ',
        displayName: 'Al 白蛋白',
        value: '  45 ',
        unit: ' g/L ',
        refRange: ' 130-175 ',
        recommendedLabelId: 'lab-alb',
        recommendedLabel: '白蛋白',
        labelStatus: 'ai',
        labelConfidence: 0.8,
        chosenLabel: '白蛋白',
        standardLabel: '白蛋白', // 采用后 rowToCandidate 已写入
      }),
    );
    expect(draft.standardLabel).toBe('白蛋白'); // 确认后的标签正确进入草稿
    expect(draft.confirmed).toBe(false); // 仍为待确认，不会进入趋势
    // 原始字段保持原值（含首尾空格），不被 trim 改写
    expect(draft.name).toBe('  Al 白蛋白 ');
    expect(draft.value).toBe('  45 ');
    expect(draft.unit).toBe(' g/L ');
    expect(draft.refRange).toBe(' 130-175 ');
  });

  it('候选自带 standardLabel（仅来自显式采用）时同样正确带出；无采用时仍为空', () => {
    expect(ocrCandidateToDraft(cand({ standardLabel: '促甲状腺激素' })).standardLabel).toBe(
      '促甲状腺激素',
    );
    expect(ocrCandidateToDraft(cand({ standardLabel: '', chosenLabel: '' })).standardLabel).toBe(
      '',
    );
  });
});
