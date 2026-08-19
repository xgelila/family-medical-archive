import { describe, expect, it } from 'vitest';
import {
  CONTROLLED_LAB_CATALOG,
  CONTROLLED_LAB_CATALOG_ENTRY_COUNT,
  CATALOG_RECOMMENDABLE,
  LOINC_LICENSE_NOTICE,
  findCatalogEntryById,
  buildCatalogBrief,
} from '../data/controlledLabCatalog';
import {
  cleanModelRecommendation,
  emptyLabelRecommendation,
  getCatalogBriefForProxy,
  matchCatalogByName,
  normalizeNameForMatch,
  recommendFromDirectory,
  resolveFinalRecommendation,
  mappingToUserAlias,
  type UserAliasRecord,
} from './labelDirectory';
import { mappingNameKey } from './labelMappings';
import type { LabelMapping } from '../types';

/**
 * 受控目录 + 确定性匹配（先于模型）测试。
 * 边界：
 * - 目录条目结构完整、数量 ≥30、reviewState 恒为 human_review_required、nationalCode 恒为 null；
 * - 规范化仅用于匹配，绝不修改展示 raw；
 * - 目录/别名/用户别名精确命中才推荐；否则才允许模型从目录 ID 中推荐；
 * - 目录外 AI ID 一律不通过；Al/A1/AI 不被规则静默改写；
 * - 所有推荐恒为候选。
 */

describe('受控目录（本地首版）', () => {
  it('首版至少 30 个候选，字段结构完整且未宣称已核验', () => {
    expect(CONTROLLED_LAB_CATALOG_ENTRY_COUNT).toBeGreaterThanOrEqual(30);
    for (const e of CONTROLLED_LAB_CATALOG) {
      expect(e.id).toMatch(/^lab-[a-z0-9-]+$/);
      expect(e.displayName.trim()).not.toBe('');
      expect(Array.isArray(e.aliases)).toBe(true);
      expect(e.reviewState).toBe('human_review_required'); // 待人工审核，绝不声称已核验
      expect(e.nationalCode).toBeNull(); // 不填伪造的国家代码
      expect(e.source).not.toBe('');
      expect(e.sourceUrl).not.toBe('');
      expect(e.sourceVersion).not.toBe('');
      expect(e.unitHints.length).toBeGreaterThan(0);
      if (e.loincCodeCandidates && e.loincCodeCandidates.length > 0) {
        // 使用 LOINC 字段必须保留许可声明
        expect(e.licenseNote).toContain('LOINC');
      }
    }
  });

  it('目录 ID 唯一；findCatalogEntryById 可查找', () => {
    const ids = new Set(CONTROLLED_LAB_CATALOG.map((e) => e.id));
    expect(ids.size).toBe(CONTROLLED_LAB_CATALOG.length);
    expect(findCatalogEntryById('lab-hgb')?.displayName).toBe('血红蛋白');
    expect(findCatalogEntryById('not-exist')).toBeNull();
  });

  it('HbA1c：LOINC 4548-4 官方候选需审核、59261-8 IFCC 候选；非已核验映射', () => {
    const e = findCatalogEntryById('lab-hba1c');
    expect(e).not.toBeNull();
    const candidates = e?.loincCodeCandidates ?? [];
    const codes = candidates.map((c) => c.code);
    expect(codes).toContain('4548-4');
    expect(codes).toContain('59261-8');
    expect(candidates.find((c) => c.code === '4548-4')?.protocol).toBe('NGSP');
    expect(candidates.find((c) => c.code === '59261-8')?.protocol).toBe('IFCC-RMP');
    for (const c of candidates) {
      expect(c.url).toMatch(/^https:\/\/loinc\.org\//);
      expect(c.conditions).not.toBe('');
    }
  });

  it('目录简表只含 id 与名称（不含健康数值）', () => {
    const brief = buildCatalogBrief();
    expect(brief.length).toBe(CATALOG_RECOMMENDABLE.length);
    expect(brief.map((b) => b.id)).not.toContain('lab-dbil');
    for (const b of brief) {
      expect(typeof b.id).toBe('string');
      expect(b.names.length).toBeGreaterThan(0);
      expect(JSON.stringify(b)).not.toContain('value');
    }
  });

  it('本批七项仅在显示名/血清标本/LOINC 代码对应时提升，且方法保持未指定', () => {
    const expected = {
      'lab-alt': ['丙氨酸氨基转移酶', '1742-6'],
      'lab-ast': ['天门冬氨酸氨基转移酶', '1920-8'],
      'lab-ggt': ['γ-谷氨酰转移酶', '2324-2'],
      'lab-alp': ['碱性磷酸酶', '6768-6'],
      'lab-tbil': ['总胆红素', '1975-2'],
      'lab-alb': ['白蛋白', '1751-7'],
      'lab-ua': ['尿酸', '3084-1'],
    } as const;
    for (const [id, [displayName, code]] of Object.entries(expected)) {
      const entry = findCatalogEntryById(id);
      expect(entry?.displayName).toBe(displayName);
      expect(entry?.specimen).toBe('血清');
      expect(entry?.method).toBeNull();
      expect(entry?.loincCodeCandidates?.map((candidate) => candidate.code)).toContain(code);
      expect(entry?.evidenceStatus).toBe('verified_candidate');
    }
  });

  it('总胆红素不等于直接胆红素，且直接胆红素仍暂缓', () => {
    const total = findCatalogEntryById('lab-tbil');
    const direct = findCatalogEntryById('lab-dbil');
    expect(total?.loincCodeCandidates?.map((candidate) => candidate.code)).toContain('1975-2');
    expect(direct?.loincCodeCandidates?.map((candidate) => candidate.code)).toContain('1968-7');
    expect(total?.loincCodeCandidates?.map((candidate) => candidate.code)).not.toContain('1968-7');
    expect(direct?.evidenceStatus).toBe('withheld');
  });

  it('提升项目可由目录名称自动匹配', () => {
    expect(matchCatalogByName('ALT')?.id).toBe('lab-alt');
    expect(matchCatalogByName('ALT')?.evidenceStatus).toBe('verified_candidate');
  });

  it('本批六项（钠/钾/氯/总钙/普通CRP/ESR）在目录中无对应条目：不新增、不推断映射', () => {
    // 证据已核验，但现有目录中不存在对应条目；按约定不得新增、不得推断医学映射。
    const names = [
      '钠',
      '钾',
      '氯',
      '总钙',
      '离子钙',
      'CRP',
      'hs-CRP',
      'ESR',
      '血沉',
      'Westergren',
      'Wintrobe',
    ];
    for (const n of names) {
      expect(matchCatalogByName(n)).toBeNull();
    }
    const allCodes = CONTROLLED_LAB_CATALOG.flatMap(
      (e) => e.loincCodeCandidates?.map((c) => c.code) ?? [],
    );
    // 已核验候选代码在目录无对应条目，绝不出现
    for (const code of ['2951-2', '2823-3', '2075-0', '17861-6', '1988-5', '30341-2']) {
      expect(allCodes).not.toContain(code);
    }
    // 目录不把总钙等同离子钙、普通CRP等同hs-CRP，也不推断ESR方法（Westergren/Wintrobe）
    for (const e of CONTROLLED_LAB_CATALOG) {
      if (typeof e.method === 'string') {
        expect(e.method).not.toMatch(/Westergren|Wintrobe/i);
      }
      expect(e.displayName).not.toMatch(/离子钙|hs-crp|high.?sensitivity/i);
    }
  });

  it('LOINC 许可声明文本保留', () => {
    expect(LOINC_LICENSE_NOTICE).toContain('LOINC');
    expect(LOINC_LICENSE_NOTICE).toContain('Regenstrief');
  });
});

describe('规范化与精确匹配（仅用于匹配，不修改展示 raw）', () => {
  it('规范化：trim/空白折叠/大小写/去控制字符', () => {
    expect(normalizeNameForMatch('  HbA1c  ')).toBe('hba1c');
    expect(normalizeNameForMatch('糖化\r\n血红蛋白')).toBe('糖化血红蛋白');
    expect(normalizeNameForMatch('白\u200B细胞')).toBe('白细胞');
    expect(normalizeNameForMatch('')).toBe('');
  });

  it('目录显示名/别名精确命中（大小写与空白不敏感）', () => {
    expect(matchCatalogByName('血红蛋白')?.id).toBe('lab-hgb');
    expect(matchCatalogByName('HbA1c')?.id).toBe('lab-hba1c');
    expect(matchCatalogByName('hba1c')?.id).toBe('lab-hba1c');
    expect(matchCatalogByName('餐后2小时血糖')?.id).toBe('lab-2hpg');
    expect(matchCatalogByName('2hPG')?.id).toBe('lab-2hpg');
    expect(matchCatalogByName('促 甲状 腺激素')?.id).toBe('lab-tsh'); // 中文内部 OCR 空格也被清理
    expect(matchCatalogByName('尿素')).toBeNull(); // 血尿素氮不等于尿素
  });

  it('HbA1c 常见写法稳定命中 lab-hba1c（含中文 + Al/Alc/A1c 与 OCR 空格）', () => {
    expect(matchCatalogByName('糖化血红蛋白A1c')?.id).toBe('lab-hba1c');
    expect(matchCatalogByName('糖化血红蛋白Al')?.id).toBe('lab-hba1c');
    expect(matchCatalogByName('糖化血红蛋白Alc')?.id).toBe('lab-hba1c');
    expect(matchCatalogByName('HbA1c')?.id).toBe('lab-hba1c');
    expect(matchCatalogByName('hba1c')?.id).toBe('lab-hba1c');
    expect(matchCatalogByName('HBA1C')?.id).toBe('lab-hba1c');
    // OCR 分词空格在匹配时同样被清理后命中
    expect(matchCatalogByName('糖化 血红 蛋白 Al')?.id).toBe('lab-hba1c');
    expect(matchCatalogByName('糖化 血 红 蛋白 A1c')?.id).toBe('lab-hba1c');
  });

  it('needsReviewAliases（OCR 易混淆拼写）即使规范化一致也不自动命中', () => {
    expect(matchCatalogByName('HbAlc')).toBeNull(); // l 疑似 1，不自动命中
    expect(matchCatalogByName('糖化血红蛋')).toBeNull(); // 截断，不自动命中
    expect(matchCatalogByName('HbA1c')?.id).toBe('lab-hba1c'); // 正式写法仍命中
  });

  it('独立的 Al/A1/AI 不误命中任何目录项', () => {
    expect(matchCatalogByName('Al')).toBeNull();
    expect(matchCatalogByName('A1')).toBeNull();
    expect(matchCatalogByName('AI')).toBeNull();
    expect(matchCatalogByName('Al 白蛋白')).toBeNull();
    expect(matchCatalogByName('A1 白蛋白')).toBeNull();
    expect(matchCatalogByName('AI 白蛋白')).toBeNull();
    expect(matchCatalogByName('白蛋白Al')).toBeNull(); // 白蛋白+Al ≠ 糖化血红蛋白Al
  });

  it('本批四项（中性粒细胞/淋巴细胞/空腹血糖/促甲状腺激素）已提升为 verified_candidate 且可自动命中', () => {
    const expected = {
      'lab-neut-pct': ['中性粒细胞百分比', 'NEUT%'],
      'lab-lymph-pct': ['淋巴细胞百分比', 'LYMPH%'],
      'lab-fpg': ['空腹血糖', 'FPG'],
      'lab-tsh': ['促甲状腺激素', 'TSH'],
    } as const;
    for (const [id, [displayName, alias]] of Object.entries(expected)) {
      const entry = findCatalogEntryById(id);
      expect(entry?.displayName).toBe(displayName);
      expect(entry?.evidenceStatus).toBe('verified_candidate');
      // 提升项可由目录显示名/保留别名自动精确命中
      expect(matchCatalogByName(displayName)?.id).toBe(id);
      expect(matchCatalogByName(alias)?.id).toBe(id);
    }
  });

  it('空腹血糖已提升但普通血糖/血糖/葡萄糖不与空腹混为一谈', () => {
    // lab-fpg 已提升为 verified_candidate，其「空腹」语义别名（FPG/显示名 空腹血糖）可自动命中；
    // 但普通血糖语义（血糖/GLU/葡萄糖/普通血糖）绝不并入空腹血糖，也不作为独立目录条目。
    expect(findCatalogEntryById('lab-fpg')?.evidenceStatus).toBe('verified_candidate');
    expect(matchCatalogByName('空腹血糖')?.id).toBe('lab-fpg');
    expect(matchCatalogByName('FPG')?.id).toBe('lab-fpg');
    expect(matchCatalogByName('血糖')).toBeNull();
    expect(matchCatalogByName('GLU')).toBeNull();
    expect(matchCatalogByName('葡萄糖')).toBeNull();
    expect(matchCatalogByName('普通血糖')).toBeNull();
  });

  it('本批三项（高密度/低密度脂蛋白胆固醇、总蛋白）已提升为 verified_candidate，且彼此不混同', () => {
    const expected = {
      'lab-hdl': ['高密度脂蛋白胆固醇', 'HDL-C'],
      'lab-ldl': ['低密度脂蛋白胆固醇', 'LDL-C'],
      'lab-tp': ['总蛋白', 'TP'],
    } as const;
    for (const [id, [displayName, alias]] of Object.entries(expected)) {
      const entry = findCatalogEntryById(id);
      expect(entry?.displayName).toBe(displayName);
      expect(entry?.method).toBeNull();
      expect(entry?.evidenceStatus).toBe('verified_candidate');
      // 提升项可由目录显示名/保留别名自动精确命中
      expect(matchCatalogByName(displayName)?.id).toBe(id);
      expect(matchCatalogByName(alias)?.id).toBe(id);
    }
  });

  it('高密度/低密度脂蛋白各自独立，不混成单一项目', () => {
    expect(matchCatalogByName('HDL')?.id).toBe('lab-hdl');
    expect(matchCatalogByName('LDL')?.id).toBe('lab-ldl');
    expect(matchCatalogByName('HDL')?.id).not.toBe('lab-ldl');
    expect(matchCatalogByName('LDL')?.id).not.toBe('lab-hdl');
  });

  it('总蛋白与白蛋白不混同', () => {
    expect(matchCatalogByName('总蛋白')?.id).toBe('lab-tp');
    expect(matchCatalogByName('白蛋白')?.id).toBe('lab-alb');
    expect(matchCatalogByName('总蛋白')?.id).not.toBe('lab-alb');
    expect(matchCatalogByName('白蛋白')?.id).not.toBe('lab-tp');
  });

  it('本批三项（游离三碘甲状腺原氨酸/游离甲状腺素/甲状腺过氧化物酶抗体）已提升为 verified_candidate 且可自动命中，彼此不混同', () => {
    const expected = {
      'lab-ft3': ['游离三碘甲状腺原氨酸', 'FT3'],
      'lab-ft4': ['游离甲状腺素', 'FT4'],
      'lab-tpoab': ['甲状腺过氧化物酶抗体', 'TPOAb'],
    } as const;
    for (const [id, [displayName, alias]] of Object.entries(expected)) {
      const entry = findCatalogEntryById(id);
      expect(entry?.displayName).toBe(displayName);
      expect(entry?.specimen).toBe('血清');
      expect(entry?.evidenceStatus).toBe('verified_candidate');
      // 提升项可由目录显示名/保留别名自动精确命中
      expect(matchCatalogByName(displayName)?.id).toBe(id);
      expect(matchCatalogByName(alias)?.id).toBe(id);
    }
    // 三项各自独立、绝不混成单一项目，也不与促甲状腺激素（TSH）混同
    expect(matchCatalogByName('FT3')?.id).toBe('lab-ft3');
    expect(matchCatalogByName('FT4')?.id).toBe('lab-ft4');
    expect(matchCatalogByName('TPOAb')?.id).toBe('lab-tpoab');
    expect(matchCatalogByName('FT3')?.id).not.toBe('lab-ft4');
    expect(matchCatalogByName('FT4')?.id).not.toBe('lab-tpoab');
    expect(matchCatalogByName('TPOAb')?.id).not.toBe('lab-tsh');
    // 空名称不会命中任何条目
    expect(matchCatalogByName('')).toBeNull();
  });

  it('Al/A1/AI 不被规则静默改写：既不命中目录也不被纠正', () => {
    // 这些名称在目录中没有对应别名，绝不允许规则把它们“纠正”成 AI/白蛋白 等
    expect(matchCatalogByName('Al 白蛋白')).toBeNull();
    expect(matchCatalogByName('A1 白蛋白')).toBeNull();
    expect(normalizeNameForMatch('Al').toUpperCase()).toBe('AL'); // 仅用于匹配定位
  });

  it('模糊/包含/相似名称不命中（不做猜测）', () => {
    expect(matchCatalogByName('白蛋白测定')).toBeNull();
    expect(matchCatalogByName('全血血红蛋白')).toBeNull();
    expect(matchCatalogByName('TSH2')).toBeNull();
  });
});

function lm(partial: Partial<LabelMapping>): LabelMapping {
  return {
    id: 'lm1',
    nameKey: mappingNameKey(partial.rawName ?? 'x'),
    rawName: partial.rawName ?? 'x',
    catalogId: partial.catalogId ?? 'lab-tsh',
    label: partial.label ?? '促甲状腺激素',
    source: 'user-alias',
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('确定性推荐优先于模型（目录 → 用户别名 → 模型）', () => {
  const userAliases: UserAliasRecord[] = [
    mappingToUserAlias(lm({ rawName: '甲功TSH', catalogId: 'lab-tsh', label: '促甲状腺激素' })),
  ];

  it('目录精确命中 → status catalog（优先于用户别名/模型）', () => {
    const r = recommendFromDirectory('糖化血红蛋白', userAliases);
    expect(r?.entry.id).toBe('lab-hba1c');
    expect(r?.status).toBe('catalog');
  });

  it('HbA1c 常见写法（含 OCR 空格）均经目录精确命中 lab-hba1c', () => {
    for (const name of [
      '糖化血红蛋白Al',
      '糖化血红蛋白Alc',
      '糖化血红蛋白A1c',
      '糖化 血红 蛋白 Al',
      'HbA1c',
      'HBA1C',
    ]) {
      const r = recommendFromDirectory(name, []);
      expect(r?.entry.id).toBe('lab-hba1c');
      expect(r?.status).toBe('catalog');
      expect(r?.entry.displayName).toBe('糖化血红蛋白'); // 推荐标签恒为目录显示名
    }
    // 易混淆写法不自动命中
    expect(recommendFromDirectory('HbAlc', [])).toBeNull();
    expect(recommendFromDirectory('Al 白蛋白', [])).toBeNull();
  });

  it('规范化键命中用户已确认别名 → status user-alias（仅名称到 ID）', () => {
    const r = recommendFromDirectory('甲功TSH', userAliases);
    expect(r?.entry.id).toBe('lab-tsh');
    expect(r?.status).toBe('user-alias');
  });

  it('无确定性命中 → 允许模型推荐（status 强制 ai）', () => {
    const model = {
      recommendedLabelId: 'lab-tg',
      recommendedLabel: '甘油三酯',
      labelConfidence: 0.7,
      labelStatus: 'ai' as const,
    };
    const r = resolveFinalRecommendation('TG 甘油三酯', userAliases, model);
    expect(r.recommendedLabelId).toBe('lab-tg');
    expect(r.labelStatus).toBe('ai');
  });

  it('确定性命中时覆盖模型推荐', () => {
    const model = {
      recommendedLabelId: 'lab-ua',
      recommendedLabel: '尿酸',
      labelConfidence: 0.9,
      labelStatus: 'ai' as const,
    };
    const r = resolveFinalRecommendation('餐后2小时血糖', userAliases, model);
    expect(r.recommendedLabelId).toBe('lab-2hpg');
    expect(r.labelStatus).toBe('catalog'); // 已核验目录精确命中优先
    expect(r.labelConfidence).toBeNull();
  });

  it('目录外 AI ID 不得通过：cleanModelRecommendation 置空', () => {
    const r = cleanModelRecommendation({
      recommendedLabelId: 'not-in-catalog',
      recommendedLabel: '伪造',
      labelConfidence: 0.9,
      labelStatus: 'ai',
    });
    expect(r).toEqual(emptyLabelRecommendation());
  });

  it('模型自报 catalog/user-alias 但本地未命中 → 视为 ai（不信任模型自报状态）', () => {
    const model = {
      recommendedLabelId: 'lab-hdl',
      recommendedLabel: '高密度脂蛋白胆固醇',
      labelConfidence: 0.8,
      labelStatus: 'catalog' as const, // 模型自报，但名称本地未命中
    };
    const r = resolveFinalRecommendation('高密脂蛋白', [], model); // 本地仍不命中（非别名）→ 采用模型
    expect(r).toEqual({
      recommendedLabelId: 'lab-hdl',
      recommendedLabel: '高密度脂蛋白胆固醇',
      labelConfidence: 0.8,
      labelStatus: 'ai',
    });
  });

  it('推荐恒为候选：本模块不输出 confirmed/standardLabel', () => {
    const r = recommendFromDirectory('血红蛋白', userAliases);
    expect(Object.keys(r ?? {})).not.toContain('standardLabel');
    const rec = resolveFinalRecommendation('血红蛋白', userAliases, {
      recommendedLabelId: 'lab-hgb',
      recommendedLabel: '血红蛋白',
      labelConfidence: 0.8,
      labelStatus: 'ai',
    });
    expect(rec).not.toHaveProperty('confirmed');
    expect(rec).not.toHaveProperty('standardLabel');
  });

  it('getCatalogBriefForProxy 与目录一致', () => {
    expect(getCatalogBriefForProxy().length).toBe(CATALOG_RECOMMENDABLE.length);
    expect(getCatalogBriefForProxy().map((b) => b.id)).not.toContain('lab-dbil');
  });
});
