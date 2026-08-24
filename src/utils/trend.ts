import { normalizeReportTypes, type Report, type ReportItem } from '../types';

/**
 * 趋势分析（纯函数，可单测）：
 * 规则——只有「已确认 + 数值型 + 有数值」的条目才参与趋势；
 * 同一条曲线主键（见 buildCurveKey）下才连线。
 * 曲线主键只按检查项名称（name）+ resultKind + unit 分组，**不使用标准标签**。
 */

/**
 * 曲线身份主键（只读、保守、宁拆不合）规则：
 * 曲线主键 = 原始项目名(name) + resultKind + unit。
 * 核心 ID 是检查项名字：不同名称（如 糖化血红蛋白Al / 糖化血红蛋白Alc）永远是不同曲线；
 * 同一名称、同一结果类型、同一单位才合并到同一条曲线。
 * 不再使用 standardLabel / recommendedLabelId 作为趋势主键——即使旧数据同标签，
 * 只要名称不同就不合并。
 */

export interface TrendPoint {
  reportId: string;
  itemId: string;
  date: string; // 报告日期 YYYY-MM-DD
  hospital: string;
  rawValue: string; // 原始录入文本（不归一化）
  numeric: number | null; // 可解析数值，用于同曲线主键连线
  unit: string; // '' = 缺失
  originalName: string; // 报告原文项目名（曲线身份主键核心字段）
  refRange: string;
  confirmed: boolean;
}

export interface TrendSeries {
  unit: string; // '' = 该组单位缺失
  curveKey: string; // 曲线身份主键（name+resultKind+unit）
  originalName: string; // 该系列对应的原始项目名（曲线主键核心）
  points: TrendPoint[]; // 按日期升序
}

export type TrendAnalysis =
  | { kind: 'no-data'; message: string }
  | { kind: 'numeric-single-unit'; series: TrendSeries; warning: string | null }
  | { kind: 'single-series-no-unit'; series: TrendSeries; warning: string }
  | { kind: 'mixed-units'; series: TrendSeries[]; warning: string };

export function parseNumeric(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (t === '' || t === '-' || t === '—') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * 曲线身份主键（保守、宁拆不合）：原始项目名 + resultKind + unit。
 * 同一条曲线只允许这些字段完全一致的条目合并；名称或单位不同即拆成独立候选系列。
 * 不纳入 standardLabel / recommendedLabelId。
 */
export function buildCurveKey(it: ReportItem): string {
  const unit = (it.unit ?? '').trim();
  const original = (it.name ?? '').trim();
  return [original, it.resultKind, unit].join('\u0000');
}

/** 解析曲线主键的组成（仅用于展示/调试，不改变分组逻辑）。 */
export function parseCurveKey(key: string): {
  originalName: string;
  resultKind: string;
  unit: string;
} {
  const p = key.split('\u0000');
  return {
    originalName: p[0] ?? '',
    resultKind: p[1] ?? '',
    unit: p[2] ?? '',
  };
}

/**
 * 把单个条目转为趋势点（报告缺失时返回 null）。
 * 待确认（confirmed=false）条目不参与趋势统计/连线，但列表展示仍需要该结构。
 */
export function buildTrendPoint(it: ReportItem, report: Report | undefined): TrendPoint | null {
  if (!report) return null;
  return {
    reportId: it.reportId,
    itemId: it.id,
    date: report.reportDate,
    hospital: report.hospital,
    rawValue: it.value,
    numeric: parseNumeric(it.value),
    unit: (it.unit ?? '').trim(),
    originalName: (it.name ?? '').trim(),
    refRange: it.refRange ?? '',
    confirmed: it.confirmed,
  };
}

export function analyzeTrend(items: ReportItem[], reportsById: Map<string, Report>, reportType?: string | string[]): TrendAnalysis {
  // 仅「已确认 + 数值型 + 有数值」的条目进入趋势。
  // 不再要求标准标签；趋势主键只按检查项名称分组。
  const requestedTypes = reportType ? (Array.isArray(reportType) ? reportType : [reportType]).filter(Boolean) : [];
  const eligible = items.filter(
    (i) => {
      const report = reportsById.get(i.reportId);
      if (!report || (report.reportKind ?? 'lab') !== 'lab') return false;
      if (requestedTypes.length > 0 && !requestedTypes.some((type) => normalizeReportTypes(report).includes(type))) return false;
      return i.resultKind === 'numeric' && i.value.trim() !== '' && i.confirmed !== false;
    },
  );
  if (eligible.length === 0) {
    return {
      kind: 'no-data',
      message:
        '暂无「已确认 + 数值型 + 有数值」的记录，无法展示趋势（待确认或非数值型记录不参与趋势统计）。',
    };
  }

  // 同一成员（由调用方按成员过滤）、同一曲线主键（name+resultKind+unit）→ 同一系列；
  // 否则并排、不连线。不同名称（如 糖化血红蛋白Al / 糖化血红蛋白Alc）绝不合并。
  const groups = new Map<string, TrendPoint[]>();
  for (const it of eligible) {
    const point = buildTrendPoint(it, reportsById.get(it.reportId));
    if (!point) continue;
    const key = buildCurveKey(it);
    groups.set(key, [...(groups.get(key) ?? []), point]);
  }

  const series: TrendSeries[] = [...groups.entries()]
    .map(([key, pts]) => {
      const parts = parseCurveKey(key);
      return {
        unit: parts.unit,
        curveKey: key,
        originalName: parts.originalName,
        points: [...pts].sort((a, b) => a.date.localeCompare(b.date)),
      };
    })
    .sort(
      (a, b) =>
        a.originalName.localeCompare(b.originalName, 'zh') || a.unit.localeCompare(b.unit, 'zh'),
    );

  if (series.length === 1) {
    const s = series[0];
    if (s.unit === '') {
      return {
        kind: 'single-series-no-unit',
        series: s,
        warning:
          '该曲线（原始检查项）下的记录存在单位缺失：单位缺失时无法可靠比较，故不绘制连线，仅并排展示原始数值。',
      };
    }
    const hasNonNumeric = s.points.some((p) => p.numeric === null);
    return {
      kind: 'numeric-single-unit',
      series: s,
      warning: hasNonNumeric
        ? '部分记录为非数值文本（未能解析为数字），连线图仅覆盖可解析数值的记录，表格展示全部原始值。'
        : null,
    };
  }

  return {
    kind: 'mixed-units',
    series,
    warning:
      '只有「同一成员、同一原始检查项（曲线主键：检查项名称 + 检查类别 + 单位）、单位完全一致」才能连线。' +
      '此处检测到曲线主键不同或部分单位缺失（如 糖化血红蛋白Al 与 糖化血红蛋白Alc 名称不同，始终为独立曲线），' +
      '数值不可直接比较；本应用未做任何自动换算、合并或连线，已按曲线主键分组并排展示原始数值，请自行核对。',
  };
}

/**
 * 汇总某成员的「可用于趋势选择」的检查项名称候选：
 * 数值型且有值的条目上的检查项名称（含待确认，便于在趋势页逐条核对确认）。
 */
export function numericItemNames(items: ReportItem[]): string[] {
  const names = new Set<string>();
  for (const it of items) {
    if (it.resultKind !== 'numeric' || it.value.trim() === '') continue;
    const n = (it.name ?? '').trim();
    if (n !== '') names.add(n);
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'zh'));
}
