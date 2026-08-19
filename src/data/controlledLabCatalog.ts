/**
 * 受控检验项目目录（本地首版）——「待人工审核候选目录」。
 *
 * ⚠️ 重要边界（请同时阅读 docs/controlled-lab-catalog.md）：
 * - 本目录只是**候选**：reviewState 全部为 'human_review_required'；evidenceStatus 只表达
 *   「证据已核验为候选 / 待复核 / 暂缓」，不含任何医学/临床业务最终签核结论；
 * - nationalCode 一律为 null（不伪造、不填写未经逐项核验的国家代码）；
 * - LOINC 代码仅以「候选」形式出现（loincCodeCandidates），并保留许可声明（licenseStatus /
 *   licenseNote），本地自有 id 不伪装成 LOINC 代码；
 * - 目录仅用于「推荐」：推荐必须由用户显式确认后才可写入条目；绝不自动映射/合并；
 * - 规范化只用于匹配定位，绝不修改展示用原文；
 * - 证据核验时间：2026-08-18（仅核验为候选证据，不构成医学最终签核）。
 */

/** 来源：仅人工整理的本地候选（负责人工/医学审核前不得视为已核验） */
export const CATALOG_REVIEW_STATE = 'human_review_required' as const;

/** 证据核验日期（2026-08-18；仅候选证据，最终医学/业务签核未完成） */
export const CATALOG_CHECKED_AT = '2026-08-18' as const;

/** LOINC 许可声明（使用任何 LOINC 字段时必须随附保留） */
export const LOINC_LICENSE_NOTICE =
  '本材料包含来自 LOINC®（https://loinc.org）的内容；按官方当前许可证使用并保留来源声明（详见 https://loinc.org/license/）。' +
  'LOINC 为 Regenstrief Institute, Inc. 注册商标。';

/**
 * 国家现行标准证据（已实施，当前有效）：
 * WS/T 363.9—2023《卫生健康信息数据元目录 第9部分：实验室检查》。
 * 官方 PDF 抓取/核对于 2026-08-18。
 */
export const WS_T_363_9_2023 = {
  number: 'WS/T 363.9—2023',
  name: '卫生健康信息数据元目录 第9部分：实验室检查',
  url: 'https://www.nhc.gov.cn/fzs/c100048/202310/16a32e2b1c0b42e99480b945ef10c0dc/files/1733821985769_72953.pdf',
  issuedAt: '2023-10-07',
  effectiveAt: '2024-04-01',
  status: 'current' as const,
};

/**
 * 未来标准：WS/T 886—2026《临床检验常用项目名称及代码》。
 * 已于 2026-05-25 发布、2026-11-01 实施；截至 2026-08-18 **尚未实施**，
 * 目录绝不将其作为当前标准来源，也绝不据此填任何国家代码。
 */
export const WS_T_886_2026 = {
  number: 'WS/T 886—2026',
  name: '临床检验常用项目名称及代码',
  url: 'https://www.nhc.gov.cn/fzs/c100048/202606/1d8e67475848413cb4447e1b49037888/files/WST%20886%E2%80%942026.pdf',
  issuedAt: '2026-05-25',
  effectiveAt: '2026-11-01',
  status: 'future' as const, // 尚未实施：绝不作为当前标准
};

/** 条目证据状态：verified_candidate=已核验候选（可自动命中）；pending_review=待复核（仅 AI 可推荐、须用户采用）；withheld=暂缓（不参与推荐） */
export type EvidenceStatus = 'verified_candidate' | 'pending_review' | 'withheld';

/** 该条目所涉国家标准的当前状态：current=WS/T 363.9—2023 当前有效；unverified=暂无已核验数据元依据；绝不为 future（WS/T 886—2026 未实施） */
export type NationalStandardStatus = 'current' | 'future' | 'unverified';

/** LOINC 许可状态：notice-retained=已保留许可声明且未修改官方字段；not-applicable=未使用 LOINC 字段 */
export type LicenseStatus = 'notice-retained' | 'not-applicable';

/** 已核验的国家标准数据元证据（仅 WS/T 363.9—2023 当前有效时填写） */
export interface NationalStandardRef {
  number: string;
  name: string;
  url: string;
  issuedAt: string;
  effectiveAt: string;
  status: 'current' | 'future';
  /** 标准中的中文数据元名称 */
  dataElementName?: string;
  /** 标准给出的单位（定性项目可省略） */
  unit?: string;
}

/** LOINC 候选代码（含官方条目 URL 与使用条件；均为候选，须人工复核/用户采用后才可使用） */
export interface LoincCodeCandidate {
  code: string;
  /** LOINC 官方条目 URL（2026-08-18 核对） */
  url: string;
  /** 官方名称（显示名/全名，如已逐项核对则填写） */
  officialName?: string;
  /** 报告协议/体系（如 NGSP、IFCC-RMP）；无协议省略 */
  protocol?: string;
  /** 使用条件 / 不可互换边界 / 待复核点（单位、标本、方法不由中文名推断） */
  conditions: string;
}

/**
 * 受控目录条目。字段含义：
 * - id：本应用内的 canonical id（仅本地用途，不是任何国家/国际编码）；
 * - displayName：中文显示名（目录推荐采用的「标准标签」文本）；
 * - aliases：自动命名的常见别名（规范化后用于精确匹配）；
 * - needsReviewAliases：**不参与自动命中**的别名（OCR 易混淆拼写，如 HbAlc），
 *   规范化后也绝不用于精确匹配；
 * - specimen/property/method/unitHints：仅供用户与后续人工审核参考的提示，可空/可为非单位提示；
 * - source/sourceUrl/sourceVersion：来源记录（发布/实施时可能引用标准/规范，均为“候选引用”）；
 * - evidenceStatus：证据状态（verified_candidate / pending_review / withheld）；
 * - nationalStandard/nationalStandardStatus：已核验的国家标准数据元证据；null=暂无逐项核验；
 * - checkedAt：证据核验日期；
 * - nationalCode：国家代码。**未经逐项核验的目录一律为 null**；
 * - loincCodeCandidates：LOINC 候选代码（含官方 URL/条件与许可声明），非已核验映射；
 * - licenseStatus/licenseNote：LOINC 许可状态与声明（使用 LOINC 字段时随附保留）。
 */
export interface ControlledLabCatalogEntry {
  id: string;
  displayName: string;
  aliases: string[];
  needsReviewAliases?: string[];
  specimen?: string | null;
  property?: string | null;
  method?: string | null;
  unitHints: string[];
  source: string;
  sourceUrl: string;
  sourceVersion: string;
  reviewState: typeof CATALOG_REVIEW_STATE;
  evidenceStatus: EvidenceStatus;
  nationalStandard: NationalStandardRef | null;
  nationalStandardStatus: NationalStandardStatus;
  checkedAt: typeof CATALOG_CHECKED_AT;
  nationalCode: null;
  loincCodeCandidates?: LoincCodeCandidate[];
  licenseStatus: LicenseStatus;
  licenseNote?: string;
}

/** 已核验的国家标准条目统一来源描述 */
const SOURCE_VERIFIED =
  'WS/T 363.9—2023《卫生健康信息数据元目录 第9部分：实验室检查》官方 PDF（抓取/核对于 2026-08-18）';
const SOURCE_VERSION_CURRENT = 'WS/T 363.9—2023（2023-10-07 发布，2024-04-01 实施，当前有效）';
/** 未取得逐项国家标准数据元的条目统一来源描述（不把 WS/T 886—2026 当作当前来源） */
const SOURCE_PENDING =
  '人工整理的本地候选（该项目国家标准数据元未逐项核验；见 docs/controlled-lab-catalog.md）';
const SOURCE_VERSION_PENDING =
  'WS/T 363.9—2023 通用参考（当前有效；本项目数据元未逐项核验；WS/T 886—2026 未实施、不作为当前来源）';

/** 构造已核验的国家标准数据元引用（WS/T 363.9—2023，current） */
function ns(dataElementName: string, unit?: string): NationalStandardRef {
  return {
    number: WS_T_363_9_2023.number,
    name: WS_T_363_9_2023.name,
    url: WS_T_363_9_2023.url,
    issuedAt: WS_T_363_9_2023.issuedAt,
    effectiveAt: WS_T_363_9_2023.effectiveAt,
    status: 'current',
    dataElementName,
    unit,
  };
}

/**
 * 受控目录（当前 32 个候选）。
 * 来源说明（详见 docs/controlled-lab-catalog.md）：
 * - WS/T 363.9—2023《卫生健康信息数据元目录 第9部分：实验室检查》：**当前有效**（实施 2024-04-01），
 *   可确认多条中文数据元名称、定义与单位；
 * - WS/T 886—2026《临床检验常用项目名称及代码》：已发布但 **2026-11-01 才实施**，
 *   目录**不作为当前标准**，绝不据此填任何国家代码；
 * - LOINC 官方条目（URL 见各候选的 loincCodeCandidates）：现有代码及边界仅作为候选，
 *   保留按官方当前许可证使用的来源声明，不构成最终映射。
 * 逐条来源以条目内 source* 字段为准；未逐项核验的不填任何 nationalCode。
 */
export const CONTROLLED_LAB_CATALOG: ControlledLabCatalogEntry[] = [
  {
    id: 'lab-wbc',
    displayName: '白细胞计数',
    aliases: ['WBC', '白血球', '白细胞'],
    specimen: '全血',
    property: '数量浓度',
    method: null,
    unitHints: ['×10^9/L', '10^9/L', 'G/L'],
    source: SOURCE_VERIFIED,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_CURRENT,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: ns('白细胞计数值', 'G/L'),
    nationalStandardStatus: 'current',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '26464-8',
        url: 'https://loinc.org/26464-8',
        officialName: 'Leukocytes [#/volume] in Blood',
        conditions:
          '官方页面核验（Bld/NCnc/Pt/Qn，method NULL，示例 10*3/uL）。国家数据元单位为 G/L，LOINC 示例单位不同；单位以实际报告为准，不由中文名推断。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-rbc',
    displayName: '红细胞计数',
    aliases: ['RBC'],
    specimen: '全血',
    property: '数量浓度',
    method: null,
    unitHints: ['×10^12/L', '10^12/L'],
    source: SOURCE_VERIFIED,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_CURRENT,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: ns('红细胞计数值', 'G/L'),
    nationalStandardStatus: 'current',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '789-8',
        url: 'https://loinc.org/789-8',
        officialName: 'Erythrocytes [#/volume] in Blood by Automated count',
        conditions:
          '自动计数方法项需按实际检测方法确认后才能采用；国家数据元单位为 G/L，与 LOINC 示例单位不同，单位以实际报告为准。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-hgb',
    displayName: '血红蛋白',
    aliases: ['HGB', 'Hb', '血色素'],
    specimen: '全血',
    property: '质量浓度',
    method: null,
    unitHints: ['g/L', 'g/dL'],
    source: SOURCE_VERIFIED,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_CURRENT,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: ns('血红蛋白值', 'g/L'),
    nationalStandardStatus: 'current',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '718-7',
        url: 'https://loinc.org/718-7',
        officialName: 'Hemoglobin [Mass/volume] in Blood',
        conditions: '方法需按实际检测方法确认后才能采用；单位以实际报告为准，不由中文名推断。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-plt',
    displayName: '血小板计数',
    aliases: ['PLT'],
    specimen: '全血',
    property: '数量浓度',
    method: null,
    unitHints: ['×10^9/L', '10^9/L'],
    source: SOURCE_VERIFIED,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_CURRENT,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: ns('血小板计数值', 'G/L'),
    nationalStandardStatus: 'current',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '777-3',
        url: 'https://loinc.org/777-3',
        officialName: 'Platelets [#/volume] in Blood by Automated count',
        conditions:
          '自动计数方法项需按实际检测方法确认后才能采用；国家数据元单位为 G/L，与 LOINC 示例单位不同，单位以实际报告为准。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-hct',
    displayName: '红细胞压积',
    aliases: ['HCT', '血细胞比容', '红细胞比容'],
    specimen: '全血',
    property: '容积分数',
    method: null,
    unitHints: ['%', 'L/L'],
    source: SOURCE_PENDING,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_PENDING,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: null,
    nationalStandardStatus: 'unverified',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '4544-3',
        url: 'https://loinc.org/4544-3',
        officialName: 'Hematocrit [Volume Fraction] of Blood by Automated count',
        conditions: '候选；字段、单位与标本须按当前 LOINC 发布包核对，单位以实际报告为准。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-mcv',
    displayName: '平均红细胞体积',
    aliases: ['MCV'],
    specimen: '全血',
    property: '体积',
    method: null,
    unitHints: ['fL'],
    source: SOURCE_PENDING,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_PENDING,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: null,
    nationalStandardStatus: 'unverified',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '787-2',
        url: 'https://loinc.org/787-2',
        officialName: 'MCV [Entitic mean volume] in Red Blood Cells',
        conditions: '候选；字段、单位与标本须按当前 LOINC 发布包核对，单位以实际报告为准。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-neut-pct',
    displayName: '中性粒细胞百分比',
    aliases: ['NEUT%', '中性粒细胞比率'],
    specimen: '全血',
    property: '数量分数',
    method: '分类计数',
    unitHints: ['%'],
    source: SOURCE_PENDING,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_PENDING,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: null,
    nationalStandardStatus: 'unverified',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    licenseStatus: 'not-applicable',
  },
  {
    id: 'lab-lymph-pct',
    displayName: '淋巴细胞百分比',
    aliases: ['LYMPH%', '淋巴细胞比率'],
    specimen: '全血',
    property: '数量分数',
    method: '分类计数',
    unitHints: ['%'],
    source: SOURCE_PENDING,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_PENDING,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: null,
    nationalStandardStatus: 'unverified',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    licenseStatus: 'not-applicable',
  },
  {
    id: 'lab-fpg',
    displayName: '空腹血糖',
    // 仅保留「空腹」语义的别名；普通血糖/GLU/葡萄糖/血糖 不得自动并入空腹血糖
    aliases: ['FPG'],
    specimen: '血清/血浆',
    property: '质量浓度',
    method: null,
    unitHints: ['mmol/L', 'mg/dL'],
    source: SOURCE_VERIFIED,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_CURRENT,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: ns('空腹血糖值', 'mmol/L'),
    nationalStandardStatus: 'current',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '2339-0',
        url: 'https://loinc.org/2339-0',
        officialName: 'Glucose [Mass/volume] in Blood',
        conditions:
          'LOINC 2339-0 为普通血糖（Bld/MCnc/Pt/Qn，method NULL，示例 mg/dL），不能仅凭代码宣称“空腹”；空腹须由临床上下文/挑战条件另行确认；标本须匹配。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-2hpg',
    displayName: '餐后2小时血糖',
    aliases: ['2hPG', '餐后2小时', '餐后两小时血糖'],
    specimen: '血清/血浆',
    property: '质量浓度',
    method: '口服葡萄糖耐量试验后2小时',
    unitHints: ['mmol/L', 'mg/dL'],
    source: SOURCE_VERIFIED,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_CURRENT,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: ns('餐后两小时血糖值', 'mmol/L'),
    nationalStandardStatus: 'current',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '6689-4',
        url: 'https://loinc.org/6689-4',
        officialName: 'Glucose [Mass/volume] in Blood --2 hours post meal',
        conditions:
          '官方页面核验（Bld/MCnc/Pt/Qn，challenge=2H post meal，method NULL，示例 mg/dL）。适用于**全血**标本；国家数据元单位为 mmol/L，单位以实际报告为准。',
      },
      {
        code: '1521-4',
        url: 'https://loinc.org/1521-4',
        officialName: 'Glucose [Mass/volume] in Serum or Plasma --2 hours post meal',
        conditions:
          '血清/血浆标本的餐后2小时血糖候选；加载本条目（默认血清/血浆）时标本必须匹配，仅 6689-4（全血）或 1521-4（血清/血浆）二选一，不可混用。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-hba1c',
    displayName: '糖化血红蛋白',
    // 补齐 OCR 常见写法（含 A1c/Al/Alc 等同义拼写）以稳定命中；
    // 仍为精确匹配：不含独立 Al/A1/AI，避免误命中其他目录项。
    aliases: ['HbA1c', 'GHb', '糖化血红蛋白A1c', '糖化血红蛋白Al', '糖化血红蛋白Alc', 'HBA1C'],
    // OCR 易混淆拼写（不自动命中，须用户显式采用）：
    // HbAlc（l 疑似 1）、截断的糖化血红蛋。
    needsReviewAliases: ['HbAlc', '糖化血红蛋'],
    specimen: '全血',
    property: '质量分数',
    method: null,
    unitHints: ['%', 'mmol/mol'],
    source: SOURCE_VERIFIED,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_CURRENT,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: ns('糖化血红蛋白值', '%'),
    nationalStandardStatus: 'current',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '4548-4',
        url: 'https://loinc.org/4548-4',
        officialName: 'Hemoglobin A1c/Hemoglobin.total in Blood',
        protocol: 'NGSP',
        conditions:
          'NGSP 协议（美国常规报告语境，Bld/MFr/Pt/Qn，示例单位 %）。与 IFCC-RMP 代码 59261-8 按不同协议产生数值，**不可互换**，不得合并为一个标签；选择前必须确认报告协议与单位。',
      },
      {
        code: '59261-8',
        url: 'https://loinc.org/59261-8',
        officialName: 'Hemoglobin A1c/Hemoglobin.total standardized per IFCC-RMP for CDT in Blood',
        protocol: 'IFCC-RMP',
        conditions:
          'IFCC-RMP 协议（Bld/SFr/Pt/Qn，页面上“standardized per IFCC-RMP for CDT”）。官方建议按 mmol/mol 报告以避免与 NGSP 数值混淆；与 4548-4 **不可互换**；不得仅凭“糖化血红蛋白”中文名决定代码。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-tg',
    displayName: '甘油三酯',
    aliases: ['TG'],
    specimen: '血清/血浆',
    property: '质量浓度',
    method: null,
    unitHints: ['mmol/L', 'mg/dL'],
    source: SOURCE_VERIFIED,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_CURRENT,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: ns('甘油三酯值', 'mmol/L'),
    nationalStandardStatus: 'current',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '2571-8',
        url: 'https://loinc.org/2571-8',
        officialName: 'Triglyceride [Mass/volume] in Serum or Plasma',
        conditions:
          '候选；血清/血浆与质量浓度需确认；国家数据元单位为 mmol/L，LOINC 示例 mg/dL，单位由实际报告决定，不由中文名推断。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-tc',
    displayName: '总胆固醇',
    aliases: ['TC', '胆固醇'],
    specimen: '血清/血浆',
    property: '质量浓度',
    method: null,
    unitHints: ['mmol/L', 'mg/dL'],
    source: SOURCE_VERIFIED,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_CURRENT,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: ns('总胆固醇值', 'mmol/L'),
    nationalStandardStatus: 'current',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '2093-3',
        url: 'https://loinc.org/2093-3',
        officialName: 'Cholesterol [Mass/volume] in Serum or Plasma',
        conditions: '候选；单位由实际报告决定，不由中文名推断。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-hdl',
    displayName: '高密度脂蛋白胆固醇',
    aliases: ['HDL-C', 'HDL', '高密度脂蛋白'],
    specimen: '血清/血浆',
    property: '质量浓度',
    method: null,
    unitHints: ['mmol/L', 'mg/dL'],
    source: SOURCE_PENDING,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_PENDING,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: null,
    nationalStandardStatus: 'unverified',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    licenseStatus: 'not-applicable',
  },
  {
    id: 'lab-ldl',
    displayName: '低密度脂蛋白胆固醇',
    aliases: ['LDL-C', 'LDL', '低密度脂蛋白'],
    specimen: '血清/血浆',
    property: '质量浓度',
    method: null,
    unitHints: ['mmol/L', 'mg/dL'],
    source: SOURCE_PENDING,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_PENDING,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: null,
    nationalStandardStatus: 'unverified',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    licenseStatus: 'not-applicable',
  },
  {
    id: 'lab-tp',
    displayName: '总蛋白',
    aliases: ['TP'],
    specimen: '血清',
    property: '质量浓度',
    method: null,
    unitHints: ['g/L'],
    source: SOURCE_PENDING,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_PENDING,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: null,
    nationalStandardStatus: 'unverified',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    licenseStatus: 'not-applicable',
  },
  {
    id: 'lab-alb',
    displayName: '白蛋白',
    aliases: ['ALB', 'Alb'],
    specimen: '血清',
    property: '质量浓度',
    method: null,
    unitHints: ['g/L'],
    source: SOURCE_VERIFIED,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_CURRENT,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: ns('白蛋白浓度', 'g/L'),
    nationalStandardStatus: 'current',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '1751-7',
        url: 'https://loinc.org/1751-7',
        officialName: 'Albumin [Mass/volume] in Serum or Plasma',
        conditions: '候选；血清样本与质量浓度需确认；单位以实际报告为准。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-alt',
    displayName: '丙氨酸氨基转移酶',
    aliases: ['ALT', '谷丙转氨酶', 'GPT'],
    specimen: '血清',
    property: '催化活性',
    method: null,
    unitHints: ['U/L'],
    source: SOURCE_VERIFIED,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_CURRENT,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: ns('丙氨酸氨基转移酶检测值', 'U/L'),
    nationalStandardStatus: 'current',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '1742-6',
        url: 'https://loinc.org/1742-6',
        officialName: 'Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma',
        conditions: '候选；酶活性/体积类，具体测定方法需确认后才能采用。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-ast',
    displayName: '天门冬氨酸氨基转移酶',
    aliases: ['AST', '谷草转氨酶', 'GOT'],
    specimen: '血清',
    property: '催化活性',
    method: null,
    unitHints: ['U/L'],
    source: SOURCE_VERIFIED,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_CURRENT,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: ns('天冬氨酸氨基转移酶检测值', 'U/L'),
    nationalStandardStatus: 'current',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '1920-8',
        url: 'https://loinc.org/1920-8',
        officialName: 'Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma',
        conditions: '候选；酶活性/体积类，具体测定方法需确认后才能采用。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-ggt',
    displayName: 'γ-谷氨酰转移酶',
    aliases: ['GGT', 'γ-GT', '谷氨酰转肽酶'],
    specimen: '血清',
    property: '催化活性',
    method: null,
    unitHints: ['U/L'],
    source: SOURCE_PENDING,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_PENDING,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: null,
    nationalStandardStatus: 'unverified',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '2324-2',
        url: 'https://loinc.org/2324-2',
        officialName: 'Gamma glutamyl transferase [Enzymatic activity/volume] in Serum or Plasma',
        conditions: '候选；国家标准数据元原文未取得，须复核后采用。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-alp',
    displayName: '碱性磷酸酶',
    aliases: ['ALP', 'AKP'],
    specimen: '血清',
    property: '催化活性',
    method: null,
    unitHints: ['U/L'],
    source: SOURCE_PENDING,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_PENDING,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: null,
    nationalStandardStatus: 'unverified',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '6768-6',
        url: 'https://loinc.org/6768-6',
        officialName: 'Alkaline phosphatase [Enzymatic activity/volume] in Serum or Plasma',
        conditions: '候选；国家标准数据元原文未取得，须复核后采用。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-tbil',
    displayName: '总胆红素',
    aliases: ['TBIL', 'TB'],
    specimen: '血清',
    property: '质量浓度',
    method: null,
    unitHints: ['μmol/L'],
    source: SOURCE_VERIFIED,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_CURRENT,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: ns('总胆红素值', 'μmol/L'),
    nationalStandardStatus: 'current',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '1975-2',
        url: 'https://loinc.org/1975-2',
        officialName: 'Bilirubin.total [Mass/volume] in Serum or Plasma',
        conditions: '候选；国家数据元单位为 μmol/L，与 LOINC 示例单位不同，单位以实际报告为准。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-dbil',
    displayName: '直接胆红素',
    aliases: ['DBIL', 'DB'],
    specimen: '血清',
    property: '质量浓度',
    method: null,
    unitHints: ['μmol/L'],
    source: SOURCE_VERIFIED,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_CURRENT,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'withheld',
    nationalStandard: ns('结合胆红素值', 'μmol/L'),
    nationalStandardStatus: 'current',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '1968-7',
        url: 'https://loinc.org/1968-7',
        officialName: 'Bilirubin.direct [Mass/volume] in Serum or Plasma',
        conditions:
          '国家数据元名为「结合胆红素值」，与实验室常用「直接胆红素（direct bilirubin）」的语义边界需业务确认；确认前**暂缓（withheld）**，不参与任何推荐。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-urea',
    displayName: '血尿素氮',
    aliases: ['BUN', '血尿素氮'],
    specimen: '血清',
    property: '质量浓度',
    method: null,
    unitHints: ['mmol/L', 'mg/dL'],
    source: SOURCE_VERIFIED,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_CURRENT,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: ns('血尿素氮检测值', 'mmol/L'),
    nationalStandardStatus: 'current',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '3094-0',
        url: 'https://loinc.org/3094-0',
        officialName: 'Urea nitrogen [Mass/volume] in Serum or Plasma',
        conditions:
          '官方页面核验（Ser/Plas/MCnc/Pt/Qn，method NULL，示例 mg/dL）。仅代表**血尿素氮**；单纯「尿素/UREA」不得与 3094-0 互换；国家数据元单位为 mmol/L，单位以实际报告为准。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-crea',
    displayName: '肌酐',
    aliases: ['CREA', 'Cr', '血肌酐', '肌酸酐'],
    specimen: '血清',
    property: '质量浓度',
    method: null,
    unitHints: ['μmol/L', 'mg/dL'],
    source: SOURCE_VERIFIED,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_CURRENT,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: ns('血肌酐值', 'μmol/L'),
    nationalStandardStatus: 'current',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '2160-0',
        url: 'https://loinc.org/2160-0',
        officialName: 'Creatinine [Mass/volume] in Serum or Plasma',
        conditions:
          '官方页面核验（Ser/Plas/MCnc/Pt/Qn，method NULL，示例 mg/dL）。国家数据元单位为 μmol/L，与 LOINC 示例单位不同，单位以实际报告为准，不由中文名推断。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-ua',
    displayName: '尿酸',
    aliases: ['UA'],
    specimen: '血清',
    property: '质量浓度',
    method: null,
    unitHints: ['μmol/L', 'mg/dL'],
    source: SOURCE_PENDING,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_PENDING,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: null,
    nationalStandardStatus: 'unverified',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '3084-1',
        url: 'https://loinc.org/3084-1',
        officialName: 'Urate [Mass/volume] in Serum or Plasma',
        conditions: '候选；国家标准数据元逐项原文未取得，须复核后采用。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-tsh',
    displayName: '促甲状腺激素',
    aliases: ['TSH', '促甲状腺素'],
    specimen: '血清',
    property: '数量浓度',
    method: '免疫测定',
    unitHints: ['mIU/L', 'μIU/mL'],
    source: SOURCE_PENDING,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_PENDING,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: null,
    nationalStandardStatus: 'unverified',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    licenseStatus: 'not-applicable',
  },
  {
    id: 'lab-ft3',
    displayName: '游离三碘甲状腺原氨酸',
    aliases: ['FT3'],
    specimen: '血清',
    property: '质量浓度',
    method: '免疫测定',
    unitHints: ['pmol/L', 'pg/mL'],
    source: SOURCE_PENDING,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_PENDING,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: null,
    nationalStandardStatus: 'unverified',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    licenseStatus: 'not-applicable',
  },
  {
    id: 'lab-ft4',
    displayName: '游离甲状腺素',
    aliases: ['FT4'],
    specimen: '血清',
    property: '质量浓度',
    method: '免疫测定',
    unitHints: ['pmol/L', 'ng/dL'],
    source: SOURCE_PENDING,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_PENDING,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: null,
    nationalStandardStatus: 'unverified',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    licenseStatus: 'not-applicable',
  },
  {
    id: 'lab-tpoab',
    displayName: '甲状腺过氧化物酶抗体',
    aliases: ['TPOAb', 'TPO抗体'],
    specimen: '血清',
    property: '数量浓度',
    method: '免疫测定',
    unitHints: ['IU/mL', 'U/mL'],
    source: SOURCE_PENDING,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_PENDING,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: null,
    nationalStandardStatus: 'unverified',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    licenseStatus: 'not-applicable',
  },
  {
    id: 'lab-urine-protein',
    displayName: '尿蛋白定性（试纸）',
    aliases: ['尿蛋白', '尿蛋白定性', '尿蛋白试纸'],
    specimen: '尿液',
    property: '存在性/阈值（定性）',
    method: '试纸',
    unitHints: ['定性（阴性/阳性；半定量 - ~ +++）'],
    source: SOURCE_VERIFIED,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_CURRENT,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: ns('尿蛋白定性检测结果代码'),
    nationalStandardStatus: 'current',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '20454-5',
        url: 'https://loinc.org/20454-5',
        officialName: 'Protein [Presence] in Urine by Test strip',
        conditions:
          '官方页面核验（Urine/PrThr/Pt/Ord，method=Test strip）。**仅适用于尿蛋白试纸定性**；定量尿蛋白（如 mg/24h）不得混用本候选。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
  {
    id: 'lab-urine-occult-blood',
    displayName: '尿潜血（试纸）',
    aliases: ['尿潜血', '尿隐血'],
    specimen: '尿液',
    property: '存在性/阈值（定性）',
    method: '试纸',
    unitHints: ['定性（阴性/阳性；半定量 - ~ +++）'],
    source: SOURCE_VERIFIED,
    sourceUrl: WS_T_363_9_2023.url,
    sourceVersion: SOURCE_VERSION_CURRENT,
    reviewState: CATALOG_REVIEW_STATE,
    evidenceStatus: 'verified_candidate',
    nationalStandard: ns('尿潜血检测结果代码'),
    nationalStandardStatus: 'current',
    checkedAt: CATALOG_CHECKED_AT,
    nationalCode: null,
    loincCodeCandidates: [
      {
        code: '5794-3',
        url: 'https://loinc.org/5794-3',
        officialName: 'Hemoglobin [Presence] in Urine by Test strip',
        conditions:
          '官方页面核验（Urine/PrThr/Pt/Ord，method=Test strip）。LOINC 语义为**尿中血红蛋白（试纸定性）**，不是泛化“blood”标签；不得与镜检红细胞计数/尿沉渣混用。',
      },
    ],
    licenseStatus: 'notice-retained',
    licenseNote: LOINC_LICENSE_NOTICE,
  },
];

const ENTRY_COUNT = CONTROLLED_LAB_CATALOG.length;

/**
 * 受控目录条目总数（当前 32 个候选；仅用于测试与提示，不构成任何“国家代码已核验”声明）。
 */
export const CONTROLLED_LAB_CATALOG_ENTRY_COUNT = ENTRY_COUNT;

/**
 * 可参与推荐的条目：排除 evidenceStatus === 'withheld'（暂缓/隐藏）的项目。
 * 目录简表与本地 ID 校验都基于此集合：AI 只能推荐非 withheld 候选。
 */
export const CATALOG_RECOMMENDABLE: ControlledLabCatalogEntry[] = CONTROLLED_LAB_CATALOG.filter(
  (e) => e.evidenceStatus !== 'withheld',
);

const byId = new Map<string, ControlledLabCatalogEntry>(
  CONTROLLED_LAB_CATALOG.map((e) => [e.id, e]),
);

/** 按 canonical id 查找目录条目（含 withheld 条目，仅用于展示/说明；不存在返回 null）。 */
export function findCatalogEntryById(id: string): ControlledLabCatalogEntry | null {
  return id !== '' ? (byId.get(id) ?? null) : null;
}

/** 用于发送到服务端提示词的目录简表：仅 id + 候选名称（不含任何健康数值；不含 withheld 条目）。 */
export interface CatalogBriefItem {
  id: string;
  names: string[];
}

/**
 * 构建发送给服务端的目录简表（只含 id 与候选名称的 displayName + aliases；
 * needsReviewAliases 与 withheld 条目一律不出现在简表中）。
 */
export function buildCatalogBrief(
  items: readonly ControlledLabCatalogEntry[] = CATALOG_RECOMMENDABLE,
): CatalogBriefItem[] {
  return items.map((e) => ({
    id: e.id,
    names: [e.displayName, ...e.aliases],
  }));
}
