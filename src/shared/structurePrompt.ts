/**
 * 结构化服务端系统提示词（仅 Vite 开发代理 / Node 侧使用，见 vite.config.ts）。
 *
 * - 该模块只被 vite.config.ts（Node 侧）与单元测试引用，**绝不会进入前端 bundle**；
 * - 提示词采用**极简**版本：强制输出固定 JSON schema（report/items/extraFields/notes/unresolvedText），
 *   明确只能输出这些 key、不新增不删除；items 名称字段用 name（不再 originalName）；
 *   不含受控目录 / 用户别名 / 推荐标签等上下文，不含任何标签指令。
 */

import type { RecognizeMode } from './recognizeProtocol';
import {
  REPORT_FIELD_KEYS,
  ITEM_FIELD_KEYS,
  type StructureReport,
  type StructureItem,
} from './structureSchema';

/** 固定 report 字段的空值 JSON 片段（用于向模型示例完整 key 集合）。 */
function reportKeysJson(): string {
  const keys = REPORT_FIELD_KEYS.map((k) => `"${k}":""`).join(',');
  return `{${keys}}`;
}

/** 固定 item 字段的空值 JSON 片段。 */
function itemKeysJson(): string {
  const keys = ITEM_FIELD_KEYS.map((k) => `"${k}":""`).join(',');
  return `{${keys}}`;
}

/** 固定的顶层 schema 模板（所有模式强制同构）。 */
const FIXED_SCHEMA_JSON = `{
  "report": ${reportKeysJson()},
  "items": [${itemKeysJson()}],
  "extraFields": [{"section":"header|footer|other","key":"","value":"","sourceText":""}],
  "notes": [{"text":"","sourceText":""}],
  "unresolvedText": ""
}`;

/**
 * 项目识别（默认）系统提示词：把报告文字整理为固定结构，重点是检查项目列表。
 */
export const STRUCTURE_SYSTEM_PROMPT = `从文字中识别出检查单的所有检查项目和各个字段值，生成结构化数据。

只做结构整理，不做任何医学判断、不做单位换算、不做诊断或异常解释、不给治疗建议。
只输出一个 JSON 对象，不要输出 Markdown 代码块，不要输出任何多余说明；不要新增或删除任何 key。

固定 schema：
${FIXED_SCHEMA_JSON}

字段说明：
- report 与 items 的字段值保持原文用字（如 A1 不得改成 AI），缺失一律填空字符串 ""；
- items 是检查项目列表：name=项目名（数字 1 与字母 l 混淆时按医学惯例取 1，如 Al→A1、Alc→A1c）、result=结果值原文（数值或定性，如 "5.6"、"阴性"；含 < > ≤ ≥ 前缀时保留）、
  referenceRange=参考区间、unit=单位、method=检验方法（缺失填空）、sourceText=该项目来源的原文片段（须与输入逐字一致）；
- report 为报告头部信息候选（医院/编号/姓名/日期/送检医生等），无法判断的字段填空 ""；
- 无法归入 report/items 的其它信息（如页眉页脚、机构地址、非项目备注）放到 extraFields 或 notes；
- unresolvedText 放无法可靠对应到任何结构项的原文行（多行用换行分隔），不要猜测、不要丢弃。`;

/**
 * 整张报告识别（report 模式）系统提示词：与默认模式同构，额外强调报告头部信息。
 */
export const REPORT_STRUCTURE_SYSTEM_PROMPT = `从文字中识别出整张报告的信息与检查单的所有检查项目和各个字段值，生成结构化数据。

只做结构整理，不做任何医学判断、不做单位换算、不做诊断或异常解释、不给治疗建议。
只输出一个 JSON 对象，不要输出 Markdown 代码块，不要输出任何多余说明；不要新增或删除任何 key。

固定 schema：
${FIXED_SCHEMA_JSON}

字段说明：
- report 为整张报告头部信息候选（全部由用户最终决定）：hospital=医院/体检机构、branch=分院、
  reportNo=报告编号、personName=姓名、gender=性别、age=年龄、patientId=病历号、clinicalDiagnosis=临床诊断、
  testPurpose=检验目的、reportDate=报告日期(YYYY-MM-DD)、reportType=报告类型、title=标题、sampleDate=采样日期、receiveDate=接收日期、
  printDate=打印日期、senderDoctor=送检医生、inspector=检验者、reviewer=审核者；无法可靠判断的字段填空 ""（禁止猜测性补全）；
- items 是检查项目列表：name=项目名（数字 1 与字母 l 混淆时按医学惯例取 1，如 Al→A1、Alc→A1c；其余保持原文用字，A1 不得改成 AI）、result=结果值原文（数值或定性，含 < > ≤ ≥ 前缀时保留）、
  referenceRange=参考区间、unit=单位、method=检验方法（缺失填空）、sourceText=该项目来源的原文片段（须与输入逐字一致）；
- 无法归入 report/items 的其它信息放到 extraFields 或 notes；
- unresolvedText 放无法可靠对应到任何结构项的原文行（多行用换行分隔），不要猜测、不要丢弃。`;

/** 依模式返回对应的极简系统提示词（items 默认）。 */
export function systemPromptForMode(mode: RecognizeMode): string {
  return mode === 'report' ? REPORT_STRUCTURE_SYSTEM_PROMPT : STRUCTURE_SYSTEM_PROMPT;
}

/** 类型引用（避免未使用告警；提示词为字符串，类型仅作文档化）。 */
export type _SchemaDoc = {
  report: StructureReport;
  item: StructureItem;
};
