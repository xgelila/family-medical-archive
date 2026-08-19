import { describe, expect, it } from 'vitest';
import {
  GLUCOSE_REPORT_TYPE,
  GLUCOSE_STANDARD_LABELS,
  REPORT_TYPES,
  THYROID_REPORT_TYPE,
  THYROID_STANDARD_LABELS,
} from '../types';
import {
  emptyDraft,
  isGlucoseReportType,
  isThyroidReportType,
  nonEmptyItemDrafts,
  quickAddGlucoseDraft,
  quickAddThyroidDraft,
  standardLabelCandidatesForType,
  type ItemDraft,
} from './labels';

describe('报告类型/检查类别严格选项', () => {
  it('新增/编辑报告仅提供以下固定选项（含“不选择”，且不含旧版自由文本类别）', () => {
    expect([...REPORT_TYPES]).toEqual([
      '综合体检',
      '血常规',
      '尿常规',
      '肝功能',
      '肾功能',
      '血脂',
      '血糖/糖化血红蛋白',
      '甲状腺功能',
      '肿瘤标志物',
      '影像检查',
      '其他',
    ]);
    expect(REPORT_TYPES).not.toContain('年度体检');
    expect(REPORT_TYPES).not.toContain('入职体检');
  });
});

describe('甲功常用项目快速添加（仅限「甲状腺功能」报告类型）', () => {
  it('候选仅含 5 个明确甲功标签', () => {
    expect([...THYROID_STANDARD_LABELS]).toEqual(['TSH', 'FT3', 'FT4', 'TPOAb', 'TgAb']);
  });

  it('仅在报告类型精确等于「甲状腺功能」时提供候选，其他类型无预置候选', () => {
    expect(isThyroidReportType(THYROID_REPORT_TYPE)).toBe(true);
    expect(isThyroidReportType('综合体检')).toBe(false);
    expect(isThyroidReportType('')).toBe(false);
    expect(standardLabelCandidatesForType(THYROID_REPORT_TYPE)).toEqual([
      'TSH',
      'FT3',
      'FT4',
      'TPOAb',
      'TgAb',
    ]);
    expect(standardLabelCandidatesForType('综合体检')).toEqual([]);
    expect(standardLabelCandidatesForType('血常规')).toEqual([]);
  });

  it('快速添加只生成「显式标签 + 空结果」的条目：不默认数值、不要求补齐、不丢弃其它项目', () => {
    for (const label of THYROID_STANDARD_LABELS) {
      const d = quickAddThyroidDraft(label);
      expect(d.name).toBe(label);
      expect(d.standardLabel).toBe(label);
      expect(d.value).toBe('');
      expect(d.unit).toBe('');
      expect(d.refRange).toBe('');
      expect(d.notes).toBe('');
      expect(d.confirmed).toBe(false);
    }
    // 任意自定义项目仍可追加（add 按钮不在本纯函数范围内，但草稿可随意组合）
    const custom = { ...emptyDraft(), name: '医院自定义项', standardLabel: '' };
    expect(custom.name).toBe('医院自定义项');
    expect(custom.standardLabel).toBe('');
  });

  it('不存在“按项目名自动映射标准标签”的逻辑：草稿标签默认恒为空，必须显式赋值', () => {
    const d = emptyDraft();
    d.name = '促甲状腺激素';
    expect(d.standardLabel).toBe(''); // 项目名不会自动推导出 TSH 等标签
  });
});

describe('血糖常用项目快速添加（仅限「血糖/糖化血红蛋白」报告类型，且不做自动标准化）', () => {
  it('候选仅含 5 个明确血糖项目名', () => {
    expect([...GLUCOSE_STANDARD_LABELS]).toEqual([
      '空腹血糖',
      '餐后2小时血糖',
      '随机血糖',
      '糖化血红蛋白',
      '估算平均血糖',
    ]);
  });

  it('仅在报告类型精确等于严格选项「血糖/糖化血红蛋白」时展示；其他类型/自由文本不展示', () => {
    expect(GLUCOSE_REPORT_TYPE).toBe('血糖/糖化血红蛋白');
    expect(isGlucoseReportType(GLUCOSE_REPORT_TYPE)).toBe(true);
    expect(isGlucoseReportType('血糖')).toBe(false); // 不在严格选项内的自由文本不触发
    expect(isGlucoseReportType('糖化血红蛋白')).toBe(false);
    expect(isGlucoseReportType('综合体检')).toBe(false);
    expect(isGlucoseReportType('')).toBe(false);
    expect(isGlucoseReportType('血糖报告')).toBe(false);
  });

  it('血糖快速添加只生成「空白、待确认、无标准标签」条目：无数值/无单位/无区间', () => {
    for (const name of GLUCOSE_STANDARD_LABELS) {
      const d = quickAddGlucoseDraft(name);
      expect(d.name).toBe(name);
      expect(d.standardLabel).toBe(''); // 血糖不做自动标准化
      expect(d.value).toBe('');
      expect(d.unit).toBe('');
      expect(d.refRange).toBe('');
      expect(d.notes).toBe('');
      expect(d.confirmed).toBe(false); // 待确认
    }
  });

  it('nonEmptyItemDrafts：trim 仅用于判断空项目，不改写任何原始字段（含首尾/行内空格）', () => {
    const drafts: ItemDraft[] = [
      {
        ...emptyDraft(),
        name: ' 血红蛋白 ',
        value: ' 145 ',
        unit: ' g/L ',
        refRange: ' 130-175 ',
        notes: ' 备注 ',
      },
      { ...emptyDraft(), name: '   ' }, // 纯空白项目名 → 视为空项目
      { ...emptyDraft(), name: '' }, // 空项目名 → 视为空项目
      { ...emptyDraft(), name: 'A1 糖化血红蛋白', value: ' 5.1 ' }, // 正常项目：原始字段保持原值
    ];
    const kept = nonEmptyItemDrafts(drafts);
    expect(kept).toHaveLength(2);
    expect(kept[0].name).toBe(' 血红蛋白 ');
    expect(kept[0].value).toBe(' 145 ');
    expect(kept[0].unit).toBe(' g/L ');
    expect(kept[0].refRange).toBe(' 130-175 ');
    expect(kept[0].notes).toBe(' 备注 ');
    expect(kept[1].name).toBe('A1 糖化血红蛋白'); // 相似字 Al/A1/AI 不做任何纠正
    expect(kept[1].value).toBe(' 5.1 ');
  });

  it('standardLabelCandidatesForType：血糖与甲功各自提供候选，其他类型为空', () => {
    expect([...standardLabelCandidatesForType(GLUCOSE_REPORT_TYPE)]).toEqual([
      ...GLUCOSE_STANDARD_LABELS,
    ]);
    expect(standardLabelCandidatesForType(THYROID_REPORT_TYPE)).toEqual([
      ...THYROID_STANDARD_LABELS,
    ]);
    expect(standardLabelCandidatesForType('综合体检')).toEqual([]);
  });
});
