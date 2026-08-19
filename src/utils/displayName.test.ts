import { describe, expect, it } from 'vitest';
import { cleanDisplayName, collapseWhitespace } from './displayName';

/**
 * displayName 低风险展示清理测试。
 * 边界：
 * - 只做展示层清理（去首尾空白/折叠重复空白与换行/去不可见控制字符/去中文内外 OCR 分词空格）；
 * - Al/A1/AI、L/I/1、O/0 等相似字符绝不静默纠正；
 * - 只删空白、不合并/纠正未知词；raw 恒为原文、绝不覆盖。
 */

describe('cleanDisplayName', () => {
  it('去首尾空白并移除中文内部被插入的分词空格（raw 不被覆盖）', () => {
    const r = cleanDisplayName('  白 细胞  ');
    expect(r.raw).toBe('  白 细胞  ');
    expect(r.display).toBe('白细胞'); // 移除中文字符内部单个空格
    expect(r.changed).toBe(true);
  });

  it('OCR 分词噪音：中文内部空格 + 中文与英数间空格一并清理，raw 不变', () => {
    const r = cleanDisplayName('糖化 血红 蛋白 Al');
    expect(r.display).toBe('糖化血红蛋白Al');
    expect(r.raw).toBe('糖化 血红 蛋白 Al'); // 原文保留
    expect(r.changed).toBe(true);
    const r2 = cleanDisplayName('蛋白 Al');
    expect(r2.display).toBe('蛋白Al');
    expect(r2.raw).toBe('蛋白 Al');
  });

  it('折叠重复空白/换行/Tab 为单个空格，并移除中文与紧邻数字间的分词空格', () => {
    const r = cleanDisplayName('血红蛋白\n\n145\ng/L');
    expect(r.display).toBe('血红蛋白145 g/L');
    expect(r.raw).toBe('血红蛋白\n\n145\ng/L'); // raw 恒为原文
  });

  it('移除不可见控制字符（零宽字符/BOM/C0 控制符）', () => {
    const r = cleanDisplayName('白\u200B细胞\uFEFF');
    expect(r.display).toBe('白细胞');
    expect(r.raw).toBe('白\u200B细胞\uFEFF');
    const c = cleanDisplayName('A\u0000B\u001FC');
    expect(c.display).toBe('ABC'); // 不可见字符直接移除（不替换为空格）
    expect(c.raw).toBe('A\u0000B\u001FC');
  });

  it('Al/A1/AI 等相似字符绝不静默纠正（仅可能移除空白，不改字符本身）', () => {
    const r = cleanDisplayName('Al 白蛋白');
    expect(r.display).toBe('Al白蛋白'); // 只移除英数后紧跟的单个空格，Al 原样
    expect(r.raw).toBe('Al 白蛋白');
    const r2 = cleanDisplayName('A1 白蛋白');
    expect(r2.display).toBe('A1白蛋白');
    const r3 = cleanDisplayName('AI 白蛋白');
    expect(r3.display).toBe('AI白蛋白');
    const r4 = cleanDisplayName('HbA1c');
    expect(r4.display).toBe('HbA1c'); // 大小写原样
  });

  it('不做大小写归一、不做形近替换', () => {
    const r = cleanDisplayName('HbAlc');
    expect(r.display).toBe('HbAlc');
    expect(r.display).not.toBe('HbA1c');
    const r2 = cleanDisplayName('白细胞( WBC )');
    expect(r2.display).toBe('白细胞( WBC )');
  });

  it('全角空格/首尾空白折叠；空白-only 输入得到空展示', () => {
    expect(collapseWhitespace('　　')).toBe('');
    expect(collapseWhitespace('a　b')).toBe('a b');
    const r = cleanDisplayName('\n\t \u3000');
    expect(r.display).toBe('');
  });

  it('未修改时 changed=false', () => {
    const r = cleanDisplayName('血红蛋白');
    expect(r.changed).toBe(false);
    expect(r.display).toBe('血红蛋白');
  });
});
