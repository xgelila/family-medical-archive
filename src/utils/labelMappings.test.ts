import { describe, expect, it } from 'vitest';
import { mappingNameKey } from './labelMappings';
import { mappingToUserAlias } from './labelDirectory';
import type { LabelMapping } from '../types';

/**
 * 标签映射（家庭级/本地）纯函数测试。
 * 说明：Dexie/indexedDB 持久化不在 Node 单测环境运行（由浏览器运行），
 * 这里只测试纯逻辑：匹配键规范化、映射简表（仅名称到 ID，不含健康数值）。
 */

function makeMapping(over: Partial<LabelMapping> = {}): LabelMapping {
  return {
    id: 'lm1',
    nameKey: 'hba1c',
    rawName: 'HbA1c',
    catalogId: 'lab-hba1c',
    label: '糖化血红蛋白',
    source: 'user-alias',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe('mappingNameKey（匹配键规范化，仅用于定位）', () => {
  it('与目录匹配同一套规范化（trim/空白折叠/大小写）', () => {
    expect(mappingNameKey('HbA1c')).toBe('hba1c');
    expect(mappingNameKey(' 血红蛋白 ')).toBe('血红蛋白');
    expect(mappingNameKey('白 细胞')).toBe('白细胞'); // 与目录同一套规范化：中文内部空格也被移除
  });

  it('不修改展示 raw：rawName 保留原文', () => {
    const m = makeMapping({ rawName: 'HbA1c' });
    expect(m.rawName).toBe('HbA1c');
    expect(m.nameKey).toBe('hba1c');
  });
});

describe('mappingToUserAlias（仅名称到 ID/标签简表）', () => {
  it('不含任何健康数值/历史字段', () => {
    const brief = mappingToUserAlias(
      makeMapping({
        rawName: '糖化血红蛋白',
        nameKey: '糖化血红蛋白',
        catalogId: 'lab-hba1c',
        label: '糖化血红蛋白',
      }),
    );
    expect(brief).toEqual({
      nameKey: '糖化血红蛋白',
      catalogId: 'lab-hba1c',
      label: '糖化血红蛋白',
    });
    const raw = JSON.stringify(brief);
    expect(raw).not.toContain('value');
    expect(raw).not.toContain('result');
    expect(raw).not.toContain('createdAt');
    expect(raw).not.toContain('rawName');
  });
});
