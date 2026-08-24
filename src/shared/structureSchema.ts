/**
 * 固定的 AI 结构化输出 schema（report / items / extraFields / notes / unresolvedText）。
 *
 * - 这是识别服务端提示词要求模型「只能输出」的固定 JSON 结构；核心字段固定，
 *   弹性信息走 extraFields / notes，避免模型随意新增 key；
 * - 本文件只含纯数据/纯函数（类型、字段清单、空值构造），可单测，不含任何密钥或服务配置；
 * - 被 Node 侧提示词（structurePrompt.ts）与浏览器侧清洗（aiStructure.ts）共同引用。
 */

export interface StructureImagingExam {
  examPart: string;
  examMethod: string;
  findings: string;
  impression: string;
  measurements: string;
}

export interface StructureImaging {
  examPart: string;
  examMethod: string;
  findings: string;
  impression: string;
  measurements: string;
  exams?: StructureImagingExam[];
}

export interface StructureReport {
  reportKind: string;
  hospital: string;
  branch: string;
  reportNo: string;
  personName: string;
  gender: string;
  age: string;
  patientId: string;
  clinicalDiagnosis: string;
  testPurpose: string;
  reportDate: string;
  reportTypes: string[];
  /** 兼容旧模型输出；新输出优先 reportTypes。 */
  reportType: string;
  title: string;
  sampleDate: string;
  receiveDate: string;
  printDate: string;
  senderDoctor: string;
  inspector: string;
  reviewer: string;
}

export interface StructureItem {
  name: string;
  result: string;
  referenceRange: string;
  unit: string;
  method: string;
  sourceText: string;
}

export interface StructureExtraField {
  /** 归属区段：header | footer | other（其余统一归一为 other） */
  section: string;
  key: string;
  value: string;
  sourceText: string;
}

export interface StructureNote {
  text: string;
  sourceText: string;
}

export interface StructuredReport {
  report: StructureReport;
  imaging: StructureImaging;
  items: StructureItem[];
  extraFields: StructureExtraField[];
  notes: StructureNote[];
  unresolvedText: string;
}

/** 固定 report 字段（顺序即展示顺序）。 */
export const REPORT_FIELD_KEYS: readonly (keyof StructureReport)[] = [
  'reportKind',
  'hospital',
  'branch',
  'reportNo',
  'personName',
  'gender',
  'age',
  'patientId',
  'clinicalDiagnosis',
  'testPurpose',
  'reportDate',
  'reportTypes',
  'reportType',
  'title',
  'sampleDate',
  'receiveDate',
  'printDate',
  'senderDoctor',
  'inspector',
  'reviewer',
];

/** 固定影像字段；exams 是并列子检查数组，旧 scalar 字段继续兼容。 */
export const IMAGING_FIELD_KEYS: readonly (keyof StructureImaging)[] = [
  'examPart',
  'examMethod',
  'findings',
  'impression',
  'measurements',
  'exams',
];

export const ITEM_FIELD_KEYS: readonly (keyof StructureItem)[] = [
  'name',
  'result',
  'referenceRange',
  'unit',
  'method',
  'sourceText',
];

/** extraFields.section 允许的取值（其余归一为 other）。 */
export const EXTRA_FIELD_SECTIONS: readonly string[] = ['header', 'footer', 'other'];

export function emptyStructureReport(): StructureReport {
  return {
    reportKind: 'lab',
    hospital: '',
    branch: '',
    reportNo: '',
    personName: '',
    gender: '',
    age: '',
    patientId: '',
    clinicalDiagnosis: '',
    testPurpose: '',
    reportDate: '',
    reportTypes: [],
    reportType: '',
    title: '',
    sampleDate: '',
    receiveDate: '',
    printDate: '',
    senderDoctor: '',
    inspector: '',
    reviewer: '',
  };
}

export function emptyStructureItem(): StructureItem {
  return {
    name: '',
    result: '',
    referenceRange: '',
    unit: '',
    method: '',
    sourceText: '',
  };
}

export function emptyStructureImaging(): StructureImaging {
  return { examPart: '', examMethod: '', findings: '', impression: '', measurements: '', exams: [] };
}

export function emptyStructuredReport(): StructuredReport {
  return {
    report: emptyStructureReport(),
    imaging: emptyStructureImaging(),
    items: [],
    extraFields: [],
    notes: [],
    unresolvedText: '',
  };
}
