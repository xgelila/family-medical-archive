import { db, now, uid } from './db';
import type { Member, Report, ReportItem } from './types';

export interface SampleBundle {
  members: Member[];
  reports: Report[];
  items: ReportItem[];
}

/**
 * 示例数据（仅用户主动点击“载入示例数据”时写入）。
 * 特意包含：
 * - 跨医院同标签不同单位（空腹血糖 mmol/L vs mg/dL）→ 演示“不可直接比较”并排展示；
 * - 单位缺失（体重一次缺单位）→ 演示不可比较提示；
 * - 甲状腺功能报告（TSH/FT3/FT4/TPOAb/TgAb，显式设置标准标签）与跨年同标签趋势；
 * - 待确认项目（总胆固醇）→ 演示不参与趋势；标准标签仅作兼容保留，不影响趋势。
 */
export function buildSampleData(): SampleBundle {
  const t = now();
  const m1 = uid();
  const m2 = uid();
  const m3 = uid();

  const members: Member[] = [
    {
      id: m1,
      name: '李建国',
      gender: '男',
      birthDate: '1968-05-12',
      relation: '本人',
      createdAt: t,
      updatedAt: t,
    },
    {
      id: m2,
      name: '王秀兰',
      gender: '女',
      birthDate: '1970-02-03',
      relation: '配偶',
      createdAt: t,
      updatedAt: t,
    },
    {
      id: m3,
      name: '李小明',
      gender: '男',
      birthDate: '1998-11-20',
      relation: '儿子',
      createdAt: t,
      updatedAt: t,
    },
  ];

  const r1 = uid();
  const r2 = uid();
  const r3 = uid();
  const r4 = uid();
  const r5 = uid();

  const reports: Report[] = [
    {
      id: r1,
      memberId: m3,
      hospital: '市第一人民医院',
      reportDate: '2024-06-15',
      reportType: '综合体检',
      title: '2024 年度体检',
      notes: '',
      attachmentIds: [],
      createdAt: t,
      updatedAt: t,
    },
    {
      id: r2,
      memberId: m3,
      hospital: '市中心医院',
      reportDate: '2025-05-20',
      reportType: '综合体检',
      title: '2025 年度体检',
      notes: '',
      attachmentIds: [],
      createdAt: t,
      updatedAt: t,
    },
    {
      id: r3,
      memberId: m1,
      hospital: '市第一人民医院',
      reportDate: '2023-10-08',
      reportType: '甲状腺功能',
      title: '',
      notes: '',
      attachmentIds: [],
      createdAt: t,
      updatedAt: t,
    },
    {
      id: r4,
      memberId: m2,
      hospital: '社区卫生服务中心',
      reportDate: '2024-03-02',
      reportType: '综合体检',
      title: '',
      notes: '',
      attachmentIds: [],
      createdAt: t,
      updatedAt: t,
    },
    {
      id: r5,
      memberId: m1,
      hospital: '市中心医院',
      reportDate: '2024-10-10',
      reportType: '甲状腺功能',
      title: '',
      notes: '',
      attachmentIds: [],
      createdAt: t,
      updatedAt: t,
    },
  ];

  const mk = (
    reportId: string,
    memberId: string,
    index: number,
    name: string,
    value: string,
    unit: string,
    refRange: string,
    confirmed: boolean,
    notes = '',
    standardLabel = '',
  ): ReportItem => ({
    id: uid(),
    reportId,
    memberId,
    index,
    name,
    resultKind: /[0-9]/.test(value) ? 'numeric' : 'qualitative',
    value,
    unit,
    refRange,
    notes,
    confirmed,
    standardLabel,
    createdAt: t,
    updatedAt: t,
  });

  const items: ReportItem[] = [
    // 李小明：同标签同单位（身高）→ 可连线
    mk(r1, m3, 1, '身高', '175', 'cm', '无', true, '', '身高'),
    mk(r2, m3, 1, '身高', '176', 'cm', '无', true, '', '身高'),
    // 同标签不同单位（空腹血糖 mmol/L vs mg/dL）→ 并排 + 不可比较提示
    mk(r1, m3, 2, '空腹血糖', '5.2', 'mmol/L', '3.9-6.1', true, '', '空腹血糖'),
    mk(
      r2,
      m3,
      2,
      '空腹血糖',
      '94',
      'mg/dL',
      '70-110',
      true,
      '跨医院不同单位，并排展示不连线',
      '空腹血糖',
    ),
    // 单位缺失示例（体重，一处缺单位）→ 并排 + 不可比较提示
    mk(r1, m3, 3, '体重', '72', 'kg', '无', true, '', '体重'),
    mk(r2, m3, 3, '体重', '74.5', '', '无', true, '单位缺失：不连线', '体重'),
    // 定性条目：定性结果不参与趋势
    mk(r1, m3, 4, '尿常规·蛋白', '阴性', '', '阴性', true, '定性条目不参与趋势'),
    // 李建国：甲状腺功能报告（显式标准标签）
    mk(
      r3,
      m1,
      1,
      '促甲状腺激素',
      '2.1',
      'mIU/L',
      '0.27-4.2',
      true,
      '原文名保留，标签为 TSH',
      'TSH',
    ),
    mk(r3, m1, 2, '游离三碘甲状腺原氨酸', '4.5', 'pmol/L', '3.28-6.47', true, '', 'FT3'),
    mk(r3, m1, 3, '游离甲状腺素', '16.2', 'pmol/L', '12.0-22.0', true, '', 'FT4'),
    mk(r3, m1, 4, '甲状腺过氧化物酶抗体', '15.0', 'IU/mL', '<34', true, '', 'TPOAb'),
    mk(r3, m1, 5, '甲状腺球蛋白抗体', '22.0', 'IU/mL', '<115', true, '', 'TgAb'),
    // 待确认 + 未设置标签：不参与趋势
    mk(
      r3,
      m1,
      6,
      '总胆固醇',
      '5.6',
      'mmol/L',
      '<5.2',
      false,
      '待确认项目不参与趋势',
      '',
    ),
    // 李建国：次年甲功复查（TSH/FT4 同标签同单位 → 可连线）
    mk(
      r5,
      m1,
      1,
      '促甲状腺激素',
      '2.8',
      'mIU/L',
      '0.27-4.2',
      true,
      '原文名保留，标签为 TSH',
      'TSH',
    ),
    mk(r5, m1, 2, '游离甲状腺素', '17.5', 'pmol/L', '12.0-22.0', true, '', 'FT4'),
    // 影像类项目：定性结果不参与趋势
    mk(
      r5,
      m1,
      3,
      '甲状腺超声',
      '大小正常',
      '',
      '大小正常',
      true,
      '定性结果不参与趋势',
    ),
    // 王秀兰
    mk(r4, m2, 1, '身高', '160', 'cm', '无', true, '', '身高'),
    mk(r4, m2, 2, '空腹血糖', '5.1', 'mmol/L', '3.9-6.1', true, '', '空腹血糖'),
  ];

  return { members, reports, items };
}

export async function loadSampleData(): Promise<{
  members: number;
  reports: number;
  items: number;
}> {
  const bundle = buildSampleData();
  await db.transaction('rw', db.members, db.reports, db.items, async () => {
    await db.members.bulkAdd(bundle.members);
    await db.reports.bulkAdd(bundle.reports);
    await db.items.bulkAdd(bundle.items);
  });
  return {
    members: bundle.members.length,
    reports: bundle.reports.length,
    items: bundle.items.length,
  };
}
