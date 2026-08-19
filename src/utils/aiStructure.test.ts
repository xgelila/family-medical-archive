import { describe, expect, it } from 'vitest';
import {
  aiStructureItemToCandidate,
  cleanAiReportStructured,
  cleanAiStructured,
  parseAiReplyContent,
} from './aiStructure';
import { STRUCTURE_SYSTEM_PROMPT, REPORT_STRUCTURE_SYSTEM_PROMPT } from '../shared/structurePrompt';

/**
 * 识别服务本地校验/清洗的单元测试。
 *
 * 覆盖边界：
 * - schema 清洗：合法字段保留、confidence 收敛到 0..1、非法项拒绝；
 * - sourceText 不在「实际发送文本」中 → 整项拒绝（防模型改写/补造）；
 * - 模型返回的 standardLabel 一律丢弃，候选恒为待确认且无标准标签；
 * - 提示词不含「诊断/治疗/换算」等请求类指令（只含禁止类约束）。
 */

describe('parseAiReplyContent', () => {
  it('解析纯 JSON', () => {
    const parsed = parseAiReplyContent('{"items":[],"unresolvedText":""}');
    expect(parsed).toEqual({ items: [], unresolvedText: '' });
  });

  it('剥离 Markdown 代码块后解析', () => {
    const parsed = parseAiReplyContent(
      '```json\n{"items":[{"name":"血红蛋白"}],"unresolvedText":"x"}\n```',
    );
    expect(parsed).toEqual({
      items: [{ name: '血红蛋白' }],
      unresolvedText: 'x',
    });
  });

  it('容忍前后多余说明文字（截取第一个大括号区间）', () => {
    const parsed = parseAiReplyContent(
      '好的，结果如下：\n{"items":[{"name":"A"}],"unresolvedText":""}\n以上。',
    );
    expect(parsed).toEqual({ items: [{ name: 'A' }], unresolvedText: '' });
  });

  it('无法解析的内容返回 null', () => {
    expect(parseAiReplyContent('')).toBeNull();
    expect(parseAiReplyContent('不是 JSON')).toBeNull();
    expect(parseAiReplyContent('[1,2,3]')).toBeNull();
  });
});

describe('cleanAiStructured（schema 校验与清洗）', () => {
  const SENT = '血红蛋白 145 g/L 130-175\n血小板 200 10^9/L 125-350';

  it('合法返回：逐项清洗，恒为待确认、无标准标签，confidence 收敛', () => {
    const payload = {
      items: [
        {
          name: '血红蛋白',
          result: '145',
          unit: 'g/L',
          referenceRange: '130-175',
          sourceText: '血红蛋白 145 g/L 130-175',
          confidence: 0.95,
        },
        {
          name: '血小板',
          result: '200',
          unit: '10^9/L',
          referenceRange: '125-350',
          sourceText: '血小板 200 10^9/L 125-350',
          confidence: 0.5,
        },
      ],
      unresolvedText: '仅供参考 请遵医嘱',
    };
    const got = cleanAiStructured(payload, SENT);
    expect(got.items).toHaveLength(2);
    expect(got.rejected).toHaveLength(0);
    expect(got.unresolvedText).toBe('仅供参考 请遵医嘱');
    for (const it of got.items) {
      expect(it.confirmed).toBe(false); // 恒为待确认
      expect(it.standardLabel).toBe(''); // 无标准标签
    }
    expect(got.items[0]).toMatchObject({
      name: '血红蛋白',
      result: '145',
      unit: 'g/L',
      referenceRange: '130-175',
      sourceText: '血红蛋白 145 g/L 130-175',
      confidence: 0.95,
    });
    expect(got.items[1].confidence).toBe(0.5);
  });

  it('sourceText 不在发送文本中（模型改写/补造）→ 整项拒绝', () => {
    const payload = {
      items: [
        {
          name: '伪造项目',
          result: '12.3',
          unit: 'mmol/L',
          referenceRange: '',
          sourceText: '原文里根本没有的这一行',
          confidence: 0.9,
        },
        {
          name: '血红蛋白',
          result: '145',
          unit: 'g/L',
          referenceRange: '130-175',
          sourceText: '血红蛋白 145 g/L 130-175',
          confidence: 0.9,
        },
      ],
      unresolvedText: '',
    };
    const got = cleanAiStructured(payload, SENT);
    expect(got.items).toHaveLength(1);
    expect(got.items[0].name).toBe('血红蛋白');
    expect(got.rejected).toHaveLength(1);
    expect(got.rejected[0].reason).toContain('sourceText');
  });

  it('sourceText 必须逐字命中：首尾空白/改写都不算精确命中', () => {
    const payload = {
      items: [
        {
          name: '血红蛋白',
          result: '145',
          unit: 'g/L',
          referenceRange: '',
          sourceText: '血红蛋白 145 g/L 131-176', // 区间被改写
          confidence: 0.9,
        },
      ],
      unresolvedText: '',
    };
    const got = cleanAiStructured(payload, SENT);
    expect(got.items).toHaveLength(0);
    expect(got.rejected).toHaveLength(1);
  });

  it('每项必须有 name 与 result：缺失即拒绝', () => {
    const payload = {
      items: [
        { result: '145', unit: '', referenceRange: '', sourceText: 'x', confidence: 0.5 },
        { name: '无结果', unit: '', referenceRange: '', sourceText: 'y', confidence: 0.5 },
        {
          name: '正常有效',
          result: '阴性',
          unit: '',
          referenceRange: '',
          sourceText: '正常有效',
          confidence: 0.5,
        },
      ],
      unresolvedText: '',
    };
    const got = cleanAiStructured(payload, '正常有效');
    expect(got.items).toHaveLength(1);
    expect(got.items[0].name).toBe('正常有效');
    expect(got.rejected).toHaveLength(2);
  });

  it('原始 OCR 字段保持原文：首尾/行内空格原样保留，Al/A1/AI 不纠正（trim 仅判断空值）', () => {
    const SENT2 =
      '  Al 白蛋白  45 g/L  130-175 \nA1 糖化血红蛋白 5.1 %\nAI 磷酸肌酸激酶 120 U/L 40-200';
    const payload = {
      items: [
        {
          name: '  Al 白蛋白 ', // 首尾空格保留
          result: '  45 ', // 首尾空格保留
          unit: ' g/L ',
          referenceRange: ' 130-175 ',
          sourceText: '  Al 白蛋白  45 g/L  130-175 ', // 行内多空格 + 首尾空格，逐字命中
          confidence: 0.9,
        },
        {
          name: 'A1 糖化血红蛋白',
          result: '5.1',
          unit: '%',
          referenceRange: '',
          sourceText: 'A1 糖化血红蛋白 5.1 %',
          confidence: 0.9,
        },
        {
          name: 'AI 磷酸肌酸激酶',
          result: '120',
          unit: 'U/L',
          referenceRange: '40-200',
          sourceText: 'AI 磷酸肌酸激酶 120 U/L 40-200',
          confidence: 0.9,
        },
      ],
      unresolvedText: '',
    };
    const got = cleanAiStructured(payload, SENT2);
    expect(got.items).toHaveLength(3);
    // 落库/候选 raw 保持原值（含空格）——trim 不改写内容
    expect(got.items[0].name).toBe('  Al 白蛋白 ');
    expect(got.items[0].result).toBe('  45 ');
    expect(got.items[0].unit).toBe(' g/L ');
    expect(got.items[0].referenceRange).toBe(' 130-175 ');
    expect(got.items[0].sourceText).toBe('  Al 白蛋白  45 g/L  130-175 ');
    // 展示层清理不受影响（仅展示，不覆盖 raw）：移除中文与紧邻英数间的空白
    expect(got.items[0].displayName).toBe('Al白蛋白');
    // Al/A1/AI 相似字绝不静默纠正
    expect(got.items[1].name).toBe('A1 糖化血红蛋白');
    expect(got.items[2].name).toBe('AI 磷酸肌酸激酶');
  });

  it('仅空白内容的 name/result/sourceText 按空项目拒绝（保留内容但不接受纯空白）', () => {
    const SENT3 = 'A 1\nB 2';
    const payload = {
      items: [
        {
          name: '   ', // 纯空白项目名
          result: '1',
          unit: '',
          referenceRange: '',
          sourceText: 'A 1',
          confidence: 0.5,
        },
        {
          name: 'B',
          result: ' \n ', // 纯空白结果
          unit: '',
          referenceRange: '',
          sourceText: 'B 2',
          confidence: 0.5,
        },
      ],
      unresolvedText: '',
    };
    const got = cleanAiStructured(payload, SENT3);
    expect(got.items).toHaveLength(0);
    expect(got.rejected).toHaveLength(2);
  });

  it('confidence 清洗：越界收敛、非法置 null', () => {
    const payload = {
      items: [
        {
          name: 'A',
          result: '1',
          unit: '',
          referenceRange: '',
          sourceText: 'A 1',
          confidence: 7,
        },
        {
          name: 'B',
          result: '2',
          unit: '',
          referenceRange: '',
          sourceText: 'B 2',
          confidence: -3,
        },
        {
          name: 'C',
          result: '3',
          unit: '',
          referenceRange: '',
          sourceText: 'C 3',
          confidence: 0.4,
        },
      ],
      unresolvedText: '',
    };
    const got = cleanAiStructured(payload, 'A 1\nB 2\nC 3');
    expect(got.items[0].confidence).toBe(1);
    expect(got.items[1].confidence).toBe(0);
    expect(got.items[2].confidence).toBe(0.4);
  });

  it('模型返回的 standardLabel 一律丢弃', () => {
    const payload = {
      items: [
        {
          name: '促甲状腺激素',
          result: '2.3',
          unit: 'mIU/L',
          referenceRange: '',
          standardLabel: 'TSH', // 模型擅自给的标签
          sourceText: '促甲状腺激素 2.3 mIU/L',
          confidence: 0.8,
        },
      ],
      unresolvedText: '',
    };
    const got = cleanAiStructured(payload, '促甲状腺激素 2.3 mIU/L');
    expect(got.items).toHaveLength(1);
    // 清洗后的候选恒为无标准标签（模型给的标签被丢弃）
    expect(got.items[0].standardLabel).toBe('');
    expect(got.items[0].confirmed).toBe(false);
  });

  it('非法 payload（非对象/无 items 数组/对象条目）→ 全部拒绝或置空，不猜测', () => {
    expect(cleanAiStructured(null, SENT)).toMatchObject({
      items: [],
      rejected: [],
      extraFields: [],
      notes: [],
      unresolvedText: '',
    });
    expect(cleanAiStructured(null, SENT).report.hospital).toBe('');
    expect(cleanAiStructured('字符串', SENT).items).toHaveLength(0);
    expect(cleanAiStructured({ items: [42, 'x', null] }, SENT).rejected).toHaveLength(3);
    expect(cleanAiStructured({ items: [] }, SENT).items).toHaveLength(0);
    expect(cleanAiStructured({ items: 'not-array' }, SENT).items).toHaveLength(0);
  });
});

describe('aiStructureItemToCandidate（追加到报告的前置转换）', () => {
  it('数值型 → numeric 候选，携带可追溯的 sourceLine 与置信度', () => {
    const cand = aiStructureItemToCandidate({
      name: '血红蛋白',
      displayName: '血红蛋白',
      result: '145',
      unit: 'g/L',
      referenceRange: '130-175',
      sourceText: '血红蛋白 145 g/L 130-175',
      confidence: 0.95,
      method: '',
      standardLabel: '',
      confirmed: false,
      recommendedLabelId: '',
      recommendedLabel: '',
      labelConfidence: null,
      labelStatus: '',
    });
    expect(cand).toMatchObject({
      name: '血红蛋白',
      resultKind: 'numeric',
      value: '145',
      unit: 'g/L',
      refRange: '130-175',
      confirmed: false,
      standardLabel: '',
      sourceLine: '血红蛋白 145 g/L 130-175',
      confidence: 95,
    });
  });

  it('AI 清洗后的候选项 → 候选：待确认、无标准标签（推荐字段仅为兼容保留）', () => {
    const cand = aiStructureItemToCandidate({
      name: 'Al 白蛋白',
      displayName: 'Al 白蛋白',
      result: '45',
      unit: 'g/L',
      referenceRange: '',
      sourceText: 'Al 白蛋白 45 g/L',
      confidence: 0.9,
      method: '',
      standardLabel: '',
      confirmed: false,
      recommendedLabelId: '',
      recommendedLabel: '',
      labelConfidence: null,
      labelStatus: '',
    });
    expect(cand).toMatchObject({
      name: 'Al 白蛋白', // 原文保留，不做 Al→ALB 之类纠正
      confirmed: false,
      standardLabel: '', // 候选恒无标准标签
      chosenLabel: '',
    });
  });
});

describe('cleanAiStructured（推荐标签字段一律忽略，识别不再产生标签）', () => {
  const SENT = '促甲状腺激素 2.3 mIU/L\n血红蛋白 145 g/L';

  it('模型返回任何 recommendedLabel 字段都一律忽略，候选恒为空、待确认、无标准标签', () => {
    const payload = {
      items: [
        {
          name: '促甲状腺激素',
          result: '2.3',
          unit: 'mIU/L',
          referenceRange: '',
          sourceText: '促甲状腺激素 2.3 mIU/L',
          confidence: 0.9,
          recommendedLabelId: 'lab-tsh',
          recommendedLabel: '模型乱写的标签文本',
          labelConfidence: 0.7,
          labelStatus: 'ai',
        },
      ],
      unresolvedText: '',
    };
    const got = cleanAiStructured(payload, SENT);
    expect(got.items).toHaveLength(1);
    expect(got.items[0].recommendedLabelId).toBe('');
    expect(got.items[0].recommendedLabel).toBe('');
    expect(got.items[0].labelStatus).toBe('');
    expect(got.items[0].labelConfidence).toBeNull();
    expect(got.items[0].confirmed).toBe(false);
    expect(got.items[0].standardLabel).toBe('');
  });

  it('模型不返回 recommendedLabel 字段也能正常解析（字段恒为空）', () => {
    const payload = {
      items: [
        {
          name: '血红蛋白',
          result: '145',
          unit: 'g/L',
          referenceRange: '',
          sourceText: '血红蛋白 145 g/L',
          confidence: 0.95,
        },
      ],
      unresolvedText: '',
    };
    const got = cleanAiStructured(payload, SENT);
    expect(got.items).toHaveLength(1);
    expect(got.items[0].recommendedLabelId).toBe('');
    expect(got.items[0].labelStatus).toBe('');
    expect(got.items[0].labelConfidence).toBeNull();
    expect(got.items[0].standardLabel).toBe('');
    expect(got.items[0].confirmed).toBe(false);
  });

  it('name 保留原文，displayName 仅做低风险清理（Al/A1/AI 不被改写）', () => {
    const payload = {
      items: [
        {
          name: 'Al\u200B 白蛋白',
          result: '45',
          unit: 'g/L',
          referenceRange: '',
          sourceText: 'Al\u200B 白蛋白 45 g/L',
          confidence: 0.9,
        },
      ],
      unresolvedText: '',
    };
    const got = cleanAiStructured(payload, 'Al\u200B 白蛋白 45 g/L');
    expect(got.items).toHaveLength(1);
    expect(got.items[0].name).toBe('Al\u200B 白蛋白'); // 原文（含零宽字符）保留
    expect(got.items[0].displayName).toBe('Al白蛋白'); // 展示层移除不可见字符、折叠空白并去分词空格
  });
});

describe('cleanAiReportStructured（整张报告识别：报告信息候选 + 项目候选）', () => {
  const catalogIds = new Set(['lab-hgb']);
  const catalogLabels = new Map([['lab-hgb', '血红蛋白']]);
  const opts = { catalogIds, catalogLabels };
  const SENT = '市第一人民医院 2026-01-05 体检报告\n血红蛋白 145 g/L';

  it('报告信息与条目一次返回：全部为候选（不写入、不确认）', () => {
    const payload = {
      report: {
        hospital: '市第一人民医院',
        reportDate: '2026-01-05',
        reportType: '综合体检',
        title: '2026 年度体检',
        notes: '仅供参考 请遵医嘱',
      },
      items: [
        {
          name: '血红蛋白',
          result: '145',
          unit: 'g/L',
          referenceRange: '',
          sourceText: '血红蛋白 145 g/L',
          confidence: 0.95,
          recommendedLabelId: 'lab-hgb',
          recommendedLabel: '血红蛋白',
          labelConfidence: 0.8,
          labelStatus: 'catalog',
        },
      ],
      unresolvedText: '',
    };
    const got = cleanAiReportStructured(payload, SENT, opts);
    expect(got.report).toMatchObject({
      hospital: '市第一人民医院',
      reportDate: '2026-01-05',
      reportType: '综合体检',
      title: '2026 年度体检',
    });
    expect(got.items).toHaveLength(1);
    // 推荐标签字段一律忽略，恒为空
    expect(got.items[0].recommendedLabelId).toBe('');
    expect(got.items[0].labelStatus).toBe('');
    expect(got.items[0].confirmed).toBe(false);
    expect(got.items[0].standardLabel).toBe('');
  });

  it('缺少 report 对象或条目非法时置空/拒绝，不猜测', () => {
    const got = cleanAiReportStructured({ items: [] }, SENT, opts);
    expect(got.report).toMatchObject({
      hospital: '',
      reportDate: '',
      reportType: '',
      title: '',
    });
    const got2 = cleanAiReportStructured(
      {
        report: {
          hospital: 'A',
          reportDate: '2026-01-05',
          reportType: 'T',
          title: 'X',
          notes: 'N',
        },
        items: [{ name: '无结果', sourceText: '无结果 1', confidence: 0.5 }],
      },
      '无结果 1',
      opts,
    );
    expect(got2.report.hospital).toBe('A');
    expect(got2.items).toHaveLength(0);
    expect(got2.rejected).toHaveLength(1);
  });
});

describe('STRUCTURE_SYSTEM_PROMPT / REPORT_STRUCTURE_SYSTEM_PROMPT（极简服务端提示词，仅 Node 侧使用）', () => {
  it('包含全部输出字段名（name/result/unit/referenceRange/sourceText/confidence/unresolvedText）', () => {
    for (const f of [
      'report',
      'items',
      'extraFields',
      'notes',
      'unresolvedText',
      'name',
      'result',
      'referenceRange',
      'unit',
      'method',
      'sourceText',
    ]) {
      expect(STRUCTURE_SYSTEM_PROMPT).toContain(f);
    }
  });

  it('提示词以「从文字中识别出检查单的所有检查项目和各个字段值，生成结构化数据」为核心', () => {
    expect(STRUCTURE_SYSTEM_PROMPT).toContain(
      '从文字中识别出检查单的所有检查项目和各个字段值，生成结构化数据',
    );
  });

  it('提示词只做「禁止类」约束，不请求诊断/治疗建议/单位换算；不含标签/受控目录上下文', () => {
    expect(STRUCTURE_SYSTEM_PROMPT).toContain('不做');
    expect(STRUCTURE_SYSTEM_PROMPT).toContain('诊断');
    expect(STRUCTURE_SYSTEM_PROMPT).toContain('治疗');
    expect(STRUCTURE_SYSTEM_PROMPT).toContain('单位换算');
    expect(/请(?:输出|给出|提供|生成)\S*(?:诊断|治疗|建议)/.test(STRUCTURE_SYSTEM_PROMPT)).toBe(
      false,
    );
    expect(/解释.{0,6}(?:结果|含义)/.test(STRUCTURE_SYSTEM_PROMPT)).toBe(false);
    // 不再包含标签/受控目录/别名上下文
    expect(STRUCTURE_SYSTEM_PROMPT).not.toContain('受控目录');
    expect(STRUCTURE_SYSTEM_PROMPT).not.toContain('recommendedLabelId');
    expect(STRUCTURE_SYSTEM_PROMPT).not.toContain('recommendedLabel');
    expect(STRUCTURE_SYSTEM_PROMPT).not.toContain('labelStatus');
    expect(STRUCTURE_SYSTEM_PROMPT).not.toContain('labelConfidence');
    expect(STRUCTURE_SYSTEM_PROMPT).not.toContain('别名');
  });

  it('提示词含「sourceText 必须逐字匹配输入」的强约束与 Al/A1 不改写约束', () => {
    expect(STRUCTURE_SYSTEM_PROMPT).toContain('逐字');
    expect(STRUCTURE_SYSTEM_PROMPT).toContain('Al');
  });

  it('整张报告提示词：报告信息候选字段 + 严格报告类型选项 + 无标签上下文', () => {
    for (const f of ['hospital', 'reportDate', 'reportType', 'title', 'notes', 'name']) {
      expect(REPORT_STRUCTURE_SYSTEM_PROMPT).toContain(f);
    }
    expect(REPORT_STRUCTURE_SYSTEM_PROMPT).toContain('YYYY-MM-DD');
    expect(REPORT_STRUCTURE_SYSTEM_PROMPT).toContain('reportType');
    expect(REPORT_STRUCTURE_SYSTEM_PROMPT).toContain(
      '从文字中识别出整张报告的信息与检查单的所有检查项目和各个字段值，生成结构化数据',
    );
    expect(REPORT_STRUCTURE_SYSTEM_PROMPT).not.toContain('受控目录');
    expect(REPORT_STRUCTURE_SYSTEM_PROMPT).not.toContain('recommendedLabelId');
    expect(REPORT_STRUCTURE_SYSTEM_PROMPT).not.toContain('labelStatus');
    expect(
      /请(?:输出|给出|提供|生成)\S*(?:诊断|治疗|建议)/.test(REPORT_STRUCTURE_SYSTEM_PROMPT),
    ).toBe(false);
  });
});
