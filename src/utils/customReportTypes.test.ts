import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../db';
import { REPORT_TYPES } from '../types';
import {
  addCustomReportType,
  deleteCustomReportType,
  loadCustomReportTypes,
  matchTestPurposeToType,
  mergeReportTypes,
  normalizeReportTypeName,
  validateCustomReportTypeName,
  type CustomReportType,
} from './customReportTypes';

/**
 * 用户自定义报告类型：
 * - 纯逻辑：合并去重、名称规范化/校验（空值/长度/重复/内置负例）、
 *   testPurpose 严格匹配（内置 / 用户类型 / 已确认别名；未匹配返回空串）；
 * - 持久化（Dexie v3 表 customReportTypes，fake-indexeddb）：确认新增写入、读取、删除；
 *   内置 REPORT_TYPES 永不修改。
 */

/* ------------------------------------------------------------------ *
 * 纯逻辑
 * ------------------------------------------------------------------ */

const custom = (over: Partial<CustomReportType> = {}): CustomReportType => ({
  id: 'c1',
  name: '心脏超声',
  aliases: [],
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('mergeReportTypes（内置 + 用户类型，去重）', () => {
  it('合并内置与自定义，内置在前、不重复', () => {
    const merged = mergeReportTypes([custom({ name: '心脏超声' }), custom({ name: '眼科' })]);
    expect(merged.slice(0, REPORT_TYPES.length)).toEqual([...REPORT_TYPES]);
    expect(merged).toContain('心脏超声');
    expect(merged).toContain('眼科');
    expect(new Set(merged).size).toBe(merged.length); // 无重复
  });

  it('自定义名称与内置重复（含空白变体）被去重，不重复添加', () => {
    const merged = mergeReportTypes([custom({ name: ' 血 常规 ' })]);
    // 与内置「血常规」去重后仅出现一次
    expect(merged.filter((t) => t === '血常规')).toHaveLength(1);
  });
});

describe('normalizeReportTypeName / validateCustomReportTypeName', () => {
  it('去首尾与内部空白（名称规范化）', () => {
    expect(normalizeReportTypeName(' 心 脏 超 声 ')).toBe('心脏超声');
  });

  it('空值（空/纯空白）不入库：校验失败', () => {
    expect(validateCustomReportTypeName('', [...REPORT_TYPES]).ok).toBe(false);
    expect(validateCustomReportTypeName('   ', [...REPORT_TYPES]).ok).toBe(false);
  });

  it('长度合理：超过上限校验失败', () => {
    expect(validateCustomReportTypeName('一二三四五六七八九十一二三四五六七八九十一', []).ok).toBe(
      false,
    );
    expect(validateCustomReportTypeName('心脏超声', []).ok).toBe(true);
  });

  it('与内置类型重复（负例）：拒绝新增，不修改内置', () => {
    const v = validateCustomReportTypeName('血常规', [...REPORT_TYPES]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain('已存在');
    expect([...REPORT_TYPES]).toContain('血常规'); // 内置不被修改
  });

  it('与已有自定义类型重复：拒绝新增', () => {
    const v = validateCustomReportTypeName('心脏超声', ['心脏超声']);
    expect(v.ok).toBe(false);
  });

  it('合法名称校验通过并返回规范化名称', () => {
    const v = validateCustomReportTypeName(' 心 脏 超 声 ', [...REPORT_TYPES]);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.normalized).toBe('心脏超声');
  });
});

describe('matchTestPurposeToType（testPurpose 严格匹配：内置/用户类型/已确认别名）', () => {
  it('匹配内置类型（精确/包含命中）', () => {
    expect(matchTestPurposeToType('血常规检查', [])).toBe('血常规');
    expect(matchTestPurposeToType('肝功能检验', [])).toBe('肝功能');
  });

  it('匹配用户自定义类型名称', () => {
    const cts = [custom({ name: '心脏超声' })];
    expect(matchTestPurposeToType('心脏超声检查', cts)).toBe('心脏超声');
  });

  it('匹配已确认别名（把某段检验目的确认给自定义类型后，下次识别该检验目的即命中）', () => {
    const cts = [custom({ name: '心脏超声', aliases: ['心脏彩超'] })];
    expect(matchTestPurposeToType('心脏彩超', cts)).toBe('心脏超声');
  });

  it('未匹配（含空/空白/无关文本）返回空串，不猜测、不自动新增', () => {
    expect(matchTestPurposeToType('', [])).toBe('');
    expect(matchTestPurposeToType('健康体检', [])).toBe('');
    expect(matchTestPurposeToType('年度复查', [])).toBe('');
    expect(matchTestPurposeToType('血红蛋白', [])).toBe(''); // 不强行分类为血常规
  });
});

/* ------------------------------------------------------------------ *
 * 持久化（Dexie v3 表 customReportTypes，fake-indexeddb）
 * ------------------------------------------------------------------ */

describe('DB schema/升级：ArchiveDB v3 含 customReportTypes 表', () => {
  it('数据库版本 >= 3，且表集合包含 customReportTypes', () => {
    expect(db.verno).toBeGreaterThanOrEqual(3);
    expect(db.tables.map((t) => t.name)).toContain('customReportTypes');
  });
});

describe('确认新增持久化 + 下次可选 + 删除', () => {
  afterAll(async () => {
    // 清理测试写入，避免影响其它用例
    await db.customReportTypes.clear();
  });

  it('addCustomReportType 写入 DB，loadCustomReportTypes 可读回（持久化）', async () => {
    const rec = await addCustomReportType('心脏超声', ['心脏彩超']);
    expect(rec).not.toBeNull();
    if (!rec) return;
    expect(rec.name).toBe('心脏超声');
    expect(rec.aliases).toEqual(['心脏彩超']);

    const loaded = await loadCustomReportTypes();
    const found = loaded.find((c) => c.id === rec.id);
    expect(found?.name).toBe('心脏超声');
    expect(found?.aliases).toEqual(['心脏彩超']);
  });

  it('重复名称不重复写入（返回 null 且不新增）', async () => {
    await addCustomReportType('眼科');
    const before = (await loadCustomReportTypes()).length;
    const again = await addCustomReportType('眼科');
    expect(again).toBeNull();
    const after = (await loadCustomReportTypes()).length;
    expect(after).toBe(before);
  });

  it('空值不入库：返回 null 且数量不变', async () => {
    const before = (await loadCustomReportTypes()).length;
    expect(await addCustomReportType('   ')).toBeNull();
    expect(await addCustomReportType('')).toBeNull();
    expect((await loadCustomReportTypes()).length).toBe(before);
  });

  it('删除自定义类型生效；内置类型无删除入口（REPORT_TYPES 常量不变）', async () => {
    const rec = await addCustomReportType('可删除类型');
    if (!rec) throw new Error('expect added');
    expect((await loadCustomReportTypes()).some((c) => c.id === rec.id)).toBe(true);
    await deleteCustomReportType(rec.id);
    expect((await loadCustomReportTypes()).some((c) => c.id === rec.id)).toBe(false);
    // 内置类型不随自定义操作变化
    expect([...REPORT_TYPES]).toContain('血常规');
    expect([...REPORT_TYPES]).toContain('综合体检');
  });
});
