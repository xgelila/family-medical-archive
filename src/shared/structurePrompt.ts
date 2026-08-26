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
  IMAGING_FIELD_KEYS,
  ITEM_FIELD_KEYS,
  type StructureReport,
  type StructureItem,
} from './structureSchema';

/** 固定 report 字段的空值 JSON 片段（用于向模型示例完整 key 集合）。 */
function reportKeysJson(): string {
  const keys = REPORT_FIELD_KEYS.map((k) => k === 'reportTypes' ? `"${k}":[]` : `"${k}":""`).join(',');
  return `{${keys}}`;
}

/** 固定 item 字段的空值 JSON 片段。 */
function imagingExamJson(): string {
  return '{"examPart":"","examMethod":"","findings":"","impression":"","measurements":""}';
}

function imagingKeysJson(): string {
  const keys = IMAGING_FIELD_KEYS.map((k) => k === 'exams' ? `"${k}":[${imagingExamJson()}]` : `"${k}":""`).join(',');
  return `{${keys}}`;
}

function itemKeysJson(): string {
  const keys = ITEM_FIELD_KEYS.map((k) => `"${k}":""`).join(',');
  return `{${keys}}`;
}

/** 固定的顶层 schema 模板（所有模式强制同构）。 */
const FIXED_SCHEMA_JSON = `{
  "report": ${reportKeysJson()},
  "imaging": ${imagingKeysJson()},
  "items": [${itemKeysJson()}],
  "extraFields": [{"section":"header|footer|other","key":"","value":"","sourceText":""}],
  "notes": [{"text":"","sourceText":""}],
  "unresolvedText": ""
}`;

/**
 * 项目识别（默认）系统提示词：把报告文字整理为固定结构，重点是检查项目列表。
 */
export const STRUCTURE_SYSTEM_PROMPT = `Extract all test items and field values from the report text and return structured data.

Perform structure extraction only. Do not make medical judgments, convert units, diagnose, explain abnormalities, or provide treatment advice.
Only output one JSON object. Do not output Markdown or any extra text. Do not add or remove keys.

Fixed schema:
${FIXED_SCHEMA_JSON}

Field instructions:
- report.reportKind must be lab、imaging、other. For imaging reports use the imaging object and never put findings or impressions into items. testPurpose is a shared field; reportTypes is an array used for category matching; reportType is a legacy compatibility field. Infer the report kind, report types, and test items from the full text, not from fixed headings. If uncertain, use an empty string and do not invent information.
- An imaging report may contain multiple examinations. Put each examination in imaging.exams with examPart, examMethod, findings, impression, and measurements. Keep missing fields empty. Use items only for lab reports.
- Keep sourceText and report details in the original language and wording. Preserve numbers, symbols, decimal places, units, and reference ranges from the input.
- Missing report and item fields must be empty strings.
- items are test items: name is the item name exactly as written; result is the original result text; referenceRange is the original reference range; unit is the original unit; method is the original test method; sourceText is the exact source fragment. If a value cannot be read reliably, leave it empty and put the unreadable original text in unresolvedText.
- Put other information that cannot be reliably assigned to report or items in extraFields or notes.
- Put unclassified original lines in unresolvedText, separated by newlines. Never guess or discard source text.`;

/**
 * 整张报告识别（report 模式）系统提示词：与默认模式同构，额外强调报告头部信息。
 */
export const REPORT_STRUCTURE_SYSTEM_PROMPT = `Extract the complete report information, all test items, and all field values from the report text and return structured data.

Perform structure extraction only. Do not make medical judgments, convert units, diagnose, explain abnormalities, or provide treatment advice.
Only output one JSON object. Do not output Markdown or any extra text. Do not add or remove keys.

Fixed schema:
${FIXED_SCHEMA_JSON}

Field instructions:
- report.reportKind must be lab、imaging、other. For imaging reports use the imaging object and never put findings or impressions into items. testPurpose is a shared field; reportTypes is an array used for category matching; reportType is a legacy compatibility field. Infer these from the full report text, not fixed headings. If uncertain, leave the value empty.
- An imaging report may contain multiple examinations. Put each examination in imaging.exams with all five fields: examPart, examMethod, findings, impression, and measurements. Keep missing fields empty. Use items only for lab reports.
- report contains report header candidates such as hospital, branch, reportNo, personName, gender, age, patientId, clinicalDiagnosis, testPurpose (检验目的), reportDate (YYYY-MM-DD), reportType, title, sampleDate, receiveDate, printDate, senderDoctor, inspector, and reviewer. testPurpose is required in the schema; extract the examination/test purpose from the original text when present, otherwise leave it empty. Never invent it.
- Keep sourceText and report details in the original language and wording. Preserve numbers, symbols, decimal places, units, and reference ranges from the input.
- items are test items: name, result, referenceRange, unit, method, and sourceText must be extracted from the original text. If an item or value cannot be read reliably, leave it empty and put the original uncertain text in unresolvedText.
- Put other information in extraFields or notes, and put unclassified original lines in unresolvedText. Never guess or discard source text.`;

/** 依模式返回对应的极简系统提示词（items 默认）。 */
export function systemPromptForMode(mode: RecognizeMode): string {
  return mode === 'report' ? REPORT_STRUCTURE_SYSTEM_PROMPT : STRUCTURE_SYSTEM_PROMPT;
}

/** 类型引用（避免未使用告警；提示词为字符串，类型仅作文档化）。 */
export type _SchemaDoc = {
  report: StructureReport;
  item: StructureItem;
};
