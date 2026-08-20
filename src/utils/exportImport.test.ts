import { describe, expect, it } from 'vitest';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  type CustomReportType,
  type ExportPayload,
  type LabelMapping,
  type Member,
  type Report,
  type ReportItem,
  type SerializedAttachment,
} from '../types';
import { buildCleanImport, validatePayload } from './exportImport';

const member: Member = {
  id: 'm1',
  name: '张三',
  gender: '男',
  birthDate: '1990-01-01',
  relation: '本人',
  createdAt: 1,
  updatedAt: 1,
};

function report(id: string, attachmentIds: string[]): Report {
  return {
    id,
    memberId: 'm1',
    hospital: '甲医院',
    reportDate: '2024-01-01',
    reportType: '年度体检',
    title: '报告',
    notes: '',
    attachmentIds,
    createdAt: 1,
    updatedAt: 1,
  };
}

function attachment(id: string, reportId: string): SerializedAttachment {
  return {
    id,
    reportId,
    name: 'a1.png',
    mimeType: 'image/png',
    size: 5,
    kind: 'image',
    dataUrl: 'data:text/plain;base64,aGVsbG8=',
    createdAt: 1,
  };
}

function item(over: Partial<ReportItem> = {}): ReportItem {
  return {
    id: 'i1',
    reportId: 'r1',
    memberId: 'm1',
    index: 0,
    name: '促甲状腺激素',
    resultKind: 'numeric',
    value: '2.1',
    unit: 'mIU/L',
    refRange: '0.27-4.2',
    notes: '',
    confirmed: true,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function payload(
  over: {
    reports?: Report[];
    items?: ReportItem[];
    attachments?: SerializedAttachment[];
    labelMappings?: LabelMapping[];
    customReportTypes?: CustomReportType[];
  } = {},
): ExportPayload {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: '2024-01-01T00:00:00.000Z',
    app: 'family-medical-archive',
    members: [member],
    reports: over.reports ?? [],
    items: over.items ?? [],
    attachments: over.attachments ?? [],
    labelMappings: over.labelMappings ?? [],
    customReportTypes: over.customReportTypes ?? [],
  };
}

describe('validatePayload', () => {
  it('接受合法 payload，拒绝格式/版本/结构错误', () => {
    expect(validatePayload(payload()).ok).toBe(true);
    expect(validatePayload({ format: 'other' }).ok).toBe(false);
    expect(validatePayload({ ...payload(), version: 99 }).ok).toBe(false);
    expect(validatePayload({ ...payload(), items: undefined }).ok).toBe(false);
  });
});

describe('buildCleanImport 附件有效性（reportId 必须指向已导入报告，不留孤立附件/引用）', () => {
  it('reportId 指向不存在报告的附件被跳过，且报告无残留引用', async () => {
    const clean = await buildCleanImport(
      payload({ reports: [report('r1', ['a1'])], attachments: [attachment('a1', 'ghost-report')] }),
    );
    expect(clean.attachments).toHaveLength(0);
    expect(clean.reports).toHaveLength(1);
    expect(clean.reports[0].attachmentIds).toEqual([]);
  });

  it('有效附件被导入，报告 attachmentIds 与实际导入一致', async () => {
    const clean = await buildCleanImport(
      payload({ reports: [report('r1', ['a1'])], attachments: [attachment('a1', 'r1')] }),
    );
    expect(clean.attachments).toHaveLength(1);
    expect(clean.attachments[0].id).toBe('a1');
    expect(clean.attachments[0].reportId).toBe('r1');
    expect(clean.reports[0].attachmentIds).toEqual(['a1']);
  });

  it('附件属于 r1，却被 r2 引用 → 该无效引用被删除（附件本身保留在 r1 下）', async () => {
    const clean = await buildCleanImport(
      payload({
        reports: [report('r1', []), report('r2', ['a1'])],
        attachments: [attachment('a1', 'r1')],
      }),
    );
    expect(clean.attachments).toHaveLength(1);
    expect(clean.reports[0].attachmentIds).toEqual([]);
    expect(clean.reports[1].attachmentIds).toEqual([]);
  });

  it('损坏的 dataUrl 附件被跳过，其引用同步删除', async () => {
    const clean = await buildCleanImport(
      payload({
        reports: [report('r1', ['a1'])],
        attachments: [{ ...attachment('a1', 'r1'), dataUrl: 'not-a-data-url' }],
      }),
    );
    expect(clean.attachments).toHaveLength(0);
    expect(clean.reports[0].attachmentIds).toEqual([]);
  });

  it('附件 id 缺失时生成新 id；报告中原引用无法解析 → 删除不残留', async () => {
    const clean = await buildCleanImport(
      payload({ reports: [report('r1', ['a1'])], attachments: [attachment('', 'r1')] }),
    );
    expect(clean.attachments).toHaveLength(1);
    expect(clean.attachments[0].id.length).toBeGreaterThan(0);
    expect(clean.attachments[0].reportId).toBe('r1');
    expect(clean.reports[0].attachmentIds).toEqual([]);
  });
});

describe('buildCleanImport 标签映射（家庭级/本地，仅名称到 ID）', () => {
  it('有效映射被清洗导入；旧版导出缺省时为空数组', async () => {
    const lm: LabelMapping = {
      id: 'lm1',
      nameKey: 'hba1c',
      rawName: 'HbA1c',
      catalogId: 'lab-hba1c',
      label: '糖化血红蛋白',
      source: 'user-alias',
      createdAt: 1,
      updatedAt: 1,
    };
    const clean = await buildCleanImport(payload({ labelMappings: [lm] }));
    expect(clean.labelMappings).toHaveLength(1);
    expect(clean.labelMappings[0]).toMatchObject({
      nameKey: 'hba1c',
      rawName: 'HbA1c',
      catalogId: 'lab-hba1c',
      label: '糖化血红蛋白',
      source: 'user-alias',
    });
    const legacy = await buildCleanImport(payload());
    expect(legacy.labelMappings).toEqual([]);
  });

  it('损坏映射（缺 catalogId/label/rawName）被跳过，不猜测补全', async () => {
    const bad = [
      {
        id: 'x',
        nameKey: 'k',
        rawName: 'R',
        catalogId: '',
        label: 'L',
        source: 'ai-recommendation',
      },
      {
        id: 'y',
        nameKey: 'k2',
        rawName: '',
        catalogId: 'lab-tsh',
        label: '促甲状腺激素',
        source: 'x',
      },
    ] as unknown as LabelMapping[];
    const clean = await buildCleanImport(payload({ labelMappings: bad }));
    expect(clean.labelMappings).toEqual([]);
  });

  it('非法 source 回退为 ai-recommendation；字段长度截断', async () => {
    const lm = {
      id: 'lm2',
      nameKey: 'k',
      rawName: 'R'.repeat(300),
      catalogId: 'lab-hba1c',
      label: '糖化血红蛋白',
      source: 'not-a-source',
      createdAt: 1,
      updatedAt: 1,
    } as unknown as LabelMapping;
    const clean = await buildCleanImport(payload({ labelMappings: [lm] }));
    expect(clean.labelMappings).toHaveLength(1);
    expect(clean.labelMappings[0].rawName).toHaveLength(200);
    expect(clean.labelMappings[0].source).toBe('ai-recommendation');
  });
});

describe('buildCleanImport 标准标签（显式设置；缺省视为未设置）', () => {
  it('清洗导入时保留标准标签，原文项目名不变', async () => {
    const clean = await buildCleanImport(
      payload({
        reports: [report('r1', [])],
        items: [item({ id: 'i1', reportId: 'r1', name: '促甲状腺激素', standardLabel: 'TSH' })],
      }),
    );
    expect(clean.items).toHaveLength(1);
    expect(clean.items[0].name).toBe('促甲状腺激素');
    expect(clean.items[0].standardLabel).toBe('TSH');
  });

  it('旧版导出缺省标准标签 → 清洗为未设置（空串），不丢其它字段', async () => {
    const { standardLabel: _omit, ...legacyItem } = item({ id: 'i1' });
    const clean = await buildCleanImport(
      payload({
        reports: [report('r1', [])],
        items: [legacyItem as ReportItem],
      }),
    );
    expect(clean.items).toHaveLength(1);
    expect(clean.items[0].standardLabel).toBe('');
    expect(clean.items[0].value).toBe('2.1');
  });
});

describe('buildCleanImport 用户自定义报告类型（导入导出保留，旧数据不报错）', () => {
  it('旧版导出缺省 customReportTypes → 清洗为空数组，不报错', async () => {
    const legacy = payload() as ExportPayload;
    delete (legacy as { customReportTypes?: unknown }).customReportTypes;
    const clean = await buildCleanImport(legacy);
    expect(clean.customReportTypes).toEqual([]);
  });

  it('有效自定义类型被清洗导入（名称去空白，别名去重去空）', async () => {
    const crt: CustomReportType[] = [
      {
        id: 'crt1',
        name: ' 心 脏 超 声 ',
        aliases: [' 心脏彩超 ', '心脏彩超', ''],
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const clean = await buildCleanImport(payload({ customReportTypes: crt }));
    expect(clean.customReportTypes).toHaveLength(1);
    expect(clean.customReportTypes[0].name).toBe('心脏超声');
    expect(clean.customReportTypes[0].aliases).toEqual(['心脏彩超']);
  });

  it('与内置类型重复的自定义类型被跳过（不导入）', async () => {
    const crt: CustomReportType[] = [
      { id: 'crt1', name: '血常规', aliases: [], createdAt: 1, updatedAt: 1 },
    ];
    const clean = await buildCleanImport(payload({ customReportTypes: crt }));
    expect(clean.customReportTypes).toEqual([]);
  });

  it('空名 / 过长的自定义类型被跳过，不猜测补全', async () => {
    const crt: CustomReportType[] = [
      { id: 'a', name: '   ', aliases: [], createdAt: 1, updatedAt: 1 },
      {
        id: 'b',
        name: '一二三四五六七八九十一二三四五六七八九十一',
        aliases: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const clean = await buildCleanImport(payload({ customReportTypes: crt }));
    expect(clean.customReportTypes).toEqual([]);
  });

  it('同名字段清理后重复的自定义类型仅保留一个', async () => {
    const crt: CustomReportType[] = [
      { id: 'a', name: '眼科', aliases: [], createdAt: 1, updatedAt: 1 },
      { id: 'b', name: ' 眼科 ', aliases: [], createdAt: 1, updatedAt: 1 },
    ];
    const clean = await buildCleanImport(payload({ customReportTypes: crt }));
    expect(clean.customReportTypes).toHaveLength(1);
    expect(clean.customReportTypes[0].name).toBe('眼科');
  });
});
