import { describe, expect, it } from 'vitest';
import type { Report, ReportItem } from '../types';
import { analyzeTrend, buildCurveKey, numericItemNames, parseNumeric } from './trend';

function report(id: string, date: string, hospital: string): Report {
  return {
    id,
    memberId: 'm1',
    hospital,
    reportDate: date,
    reportType: '综合体检',
    title: '',
    notes: '',
    attachmentIds: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function item(
  reportId: string,
  id: string,
  name: string,
  value: string,
  unit: string,
  resultKind: ReportItem['resultKind'] = 'numeric',
  confirmed = true,
): ReportItem {
  return {
    id,
    reportId,
    memberId: 'm1',
    index: 0,
    name,
    resultKind,
    value,
    unit,
    refRange: '',
    notes: '',
    confirmed,
    createdAt: 0,
    updatedAt: 0,
  };
}

const reports = new Map([
  ['r1', report('r1', '2024-01-01', '甲医院')],
  ['r2', report('r2', '2025-01-01', '乙医院')],
]);

describe('parseNumeric', () => {
  it('解析常见数值文本', () => {
    expect(parseNumeric('145')).toBe(145);
    expect(parseNumeric('5.2')).toBe(5.2);
    expect(parseNumeric('94,5')).toBe(94.5);
  });

  it('非数值返回 null（不换算、不猜测）', () => {
    expect(parseNumeric('')).toBeNull();
    expect(parseNumeric('-')).toBeNull();
    expect(parseNumeric('阴性')).toBeNull();
    expect(parseNumeric('<5.2')).toBeNull();
  });
});

function reportNoType(id: string, date: string, hospital: string): Report {
  return {
    id,
    memberId: 'm1',
    hospital,
    reportDate: date,
    reportType: '', // 无报告类型的 lab 报告
    reportTypes: [],
    title: '',
    notes: '',
    attachmentIds: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('analyzeTrend 不按报告类型过滤（报告类型不参与趋势）', () => {
  it('无报告类型（reportType 为空）的 lab 报告，其数值条目也进入趋势候选与曲线', () => {
    const r = analyzeTrend(
      [item('r1', 'i1', '血糖', '5.2', 'mmol/L', 'numeric', true)],
      new Map([['r1', reportNoType('r1', '2024-01-01', '甲医院')]]),
    );
    expect(r.kind).toBe('numeric-single-unit');
    if (r.kind === 'numeric-single-unit') {
      expect(r.series.originalName).toBe('血糖');
      expect(r.series.points).toHaveLength(1);
      expect(r.series.points[0].itemId).toBe('i1');
    }
  });

  it('不同报告类型的同成员同项目同单位仍合并为一条曲线（报告类型不拆线）', () => {
    const typedA = { ...reports.get('r1')!, reportType: '血糖', reportTypes: ['血糖'] };
    const typedB = { ...reports.get('r2')!, reportType: '血常规', reportTypes: ['血常规'] };
    const r = analyzeTrend(
      [
        item('r1', 'i1', '血糖', '5.2', 'mmol/L', 'numeric', true),
        item('r2', 'i2', '血糖', '6.1', 'mmol/L', 'numeric', true),
      ],
      new Map([
        ['r1', typedA],
        ['r2', typedB],
      ]),
    );
    expect(r.kind).toBe('numeric-single-unit');
    if (r.kind === 'numeric-single-unit') {
      expect(r.series.points).toHaveLength(2);
    }
  });
});

describe('analyzeTrend 按检查项名称分组（不再依赖标准标签）', () => {
  it('同成员、同一检查项名称、同单位 → numeric-single-unit 可连线（无需标准标签）', () => {
    const r = analyzeTrend(
      [item('r1', 'i1', '身高', '175', 'cm'), item('r2', 'i2', '身高', '176', 'cm')],
      reports,
    );
    expect(r.kind).toBe('numeric-single-unit');
    if (r.kind === 'numeric-single-unit') {
      expect(r.series.originalName).toBe('身高');
      expect(r.series.unit).toBe('cm');
      expect(r.series.points).toHaveLength(2);
    }
  });

  it('不同名称（糖化血红蛋白Al / 糖化血红蛋白Alc）同单位也拆成两条独立曲线，绝不合并', () => {
    const r = analyzeTrend(
      [
        item('r1', 'i1', '糖化血红蛋白Al', '5.4', '%', 'numeric', true),
        item('r2', 'i2', '糖化血红蛋白Alc', '6.2', '%', 'numeric', true),
      ],
      reports,
    );
    expect(r.kind).toBe('mixed-units');
    if (r.kind === 'mixed-units') {
      expect(r.series).toHaveLength(2);
      expect(r.series.map((s) => s.originalName).sort()).toEqual(
        ['糖化血红蛋白Al', '糖化血红蛋白Alc'].sort(),
      );
      expect(r.series.every((s) => s.points.length === 1)).toBe(true);
    }
  });

  it('名称不同（血红蛋白 / HGB）→ 不合并，拆成两条曲线', () => {
    const r = analyzeTrend(
      [
        item('r1', 'i1', '血红蛋白', '145', 'g/L', 'numeric', true),
        item('r2', 'i2', 'HGB', '152', 'g/L', 'numeric', true),
      ],
      reports,
    );
    expect(r.kind).toBe('mixed-units');
    if (r.kind === 'mixed-units') {
      expect(r.series).toHaveLength(2);
      expect(r.series.map((s) => s.originalName).sort()).toEqual(['HGB', '血红蛋白'].sort());
    }
  });

  it('同一名称、同单位 → 合并为一条曲线', () => {
    const r = analyzeTrend(
      [
        item('r1', 'i1', '身高', '175', 'cm'),
        item('r2', 'i2', '身高', '176', 'cm'),
        item('r3', 'i3', '身高', '177', 'cm'),
      ],
      new Map([...reports, ['r3', report('r3', '2026-01-01', '丙医院')]]),
    );
    expect(r.kind).toBe('numeric-single-unit');
    if (r.kind === 'numeric-single-unit') {
      expect(r.series.points).toHaveLength(3);
      expect(r.series.originalName).toBe('身高');
    }
  });

  it('同一名称不同单位 → 按单位拆开（line 不可跨单位）', () => {
    const r = analyzeTrend(
      [item('r1', 'i1', '空腹血糖', '5.2', 'mmol/L'), item('r2', 'i2', '空腹血糖', '94', 'mg/dL')],
      reports,
    );
    expect(r.kind).toBe('mixed-units');
    if (r.kind === 'mixed-units') {
      expect(r.series).toHaveLength(2);
      expect(r.series.map((s) => s.unit).sort()).toEqual(['mg/dL', 'mmol/L'].sort());
    }
  });

  it('单位缺失 → single-series-no-unit，不连线', () => {
    const r = analyzeTrend(
      [item('r1', 'i1', '体重', '72', ''), item('r2', 'i2', '体重', '74.5', '')],
      reports,
    );
    expect(r.kind).toBe('single-series-no-unit');
  });

  it('单位缺失与有单位混在一起 → mixed-units', () => {
    const r = analyzeTrend(
      [item('r1', 'i1', '体重', '72', ''), item('r2', 'i2', '体重', '74.5', 'kg')],
      reports,
    );
    expect(r.kind).toBe('mixed-units');
  });

  it('定性条目不参与趋势', () => {
    const r = analyzeTrend(
      [
        item('r1', 'i1', '尿蛋白', '阴性', '', 'qualitative'),
        item('r2', 'i2', '尿蛋白', '阳性', '', 'qualitative'),
      ],
      reports,
    );
    expect(r.kind).toBe('no-data');
  });

  it('无数据 → no-data', () => {
    expect(analyzeTrend([], reports).kind).toBe('no-data');
  });
});

describe('analyzeTrend 待确认规则（confirmed=false 不参与统计/连线）', () => {
  it('待确认数值条目不进入系列（不连线、不计数）', () => {
    const r = analyzeTrend(
      [
        item('r1', 'i1', '血糖', '5.2', 'mmol/L', 'numeric', true),
        item('r2', 'i2', '血糖', '6.1', 'mmol/L', 'numeric', false),
      ],
      reports,
    );
    expect(r.kind).toBe('numeric-single-unit');
    if (r.kind === 'numeric-single-unit') {
      expect(r.series.points).toHaveLength(1);
      expect(r.series.points[0].itemId).toBe('i1');
      expect(r.series.points[0].confirmed).toBe(true);
    }
  });

  it('全部条目待确认 → 无趋势统计（no-data）', () => {
    const r = analyzeTrend([item('r1', 'i1', '血糖', '5.2', 'mmol/L', 'numeric', false)], reports);
    expect(r.kind).toBe('no-data');
  });

  it('待确认条目的单位不参与分组判定（不会把同名称同单位系列搅成 mixed-units）', () => {
    const r = analyzeTrend(
      [
        item('r1', 'i1', '血糖', '5.2', 'mmol/L', 'numeric', true),
        item('r2', 'i2', '血糖', '94', 'mg/dL', 'numeric', false), // 待确认：不同单位
      ],
      reports,
    );
    expect(r.kind).toBe('numeric-single-unit');
  });
});

describe('buildCurveKey 曲线主键（名称 + 结果类型 + 单位）', () => {
  it('主键只由 名称 + resultKind + unit 组成；不同名称 → 主键不同（不合并）', () => {
    const a = item('r1', 'i1', '糖化血红蛋白Al', '5.4', '%', 'numeric', true);
    const b = item('r2', 'i2', '糖化血红蛋白Alc', '6.2', '%', 'numeric', true);
    const c = item('r3', 'i3', '糖化血红蛋白Al', '5.5', '%', 'numeric', true);
    // 名称不同 → 主键不同（不合并）
    expect(buildCurveKey(a)).not.toBe(buildCurveKey(b));
    // 名称相同（仅内容/日期不同）→ 主键相同（合并）
    expect(buildCurveKey(a)).toBe(buildCurveKey(c));
  });

  it('同一名称同单位 → 主键相同（合并为一条曲线）', () => {
    const a = item('r1', 'i1', '身高', '175', 'cm', 'numeric', true);
    const b = item('r2', 'i2', '身高', '176', 'cm', 'numeric', true);
    expect(buildCurveKey(a)).toBe(buildCurveKey(b));
  });
});

describe('numericItemNames', () => {
  it('汇总数值型且有值的项目名称，去重排序（含待确认，便于核对）', () => {
    const names = numericItemNames([
      item('r1', 'i1', '身高', '175', 'cm', 'numeric', true),
      item('r2', 'i2', '身高', '176', 'cm', 'numeric', true),
      item('r1', 'i3', '尿蛋白', '阴性', '', 'qualitative'),
      item('r1', 'i4', '体重', '', 'kg', 'numeric', true), // 无值
      item('r1', 'i5', '血糖', '5.2', 'mmol/L', 'numeric', false), // 待确认也包含
    ]);
    expect(names).toEqual(['身高', '血糖']);
  });
});
