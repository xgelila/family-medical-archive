/**
 * 「识别数据」开发环境 mock（仅本机开发，默认关闭）。
 *
 * 用途：测试识别流程时**不调用任何上游 / DeepSeek / OpenCode Go，也不使用任何 API Key**，
 * 而是直接读取 `docs/sample.json`，把它适配成与真实识别接口相同的结构
 * （`{ report, items, extraFields, notes, unresolvedText }`），
 * 使前端（ReportReview、报告类型映射、schema 清洗）走**真实路径**而不依赖外部服务。
 *
 * 开关（仅在 Vite dev 的 Node 侧读取，绝不注入客户端）：
 * - `MOCK_RECOGNITION=true` 启用；未设置或为其它值时保持真实行为（不 mock）。
 * - `MOCK_RECOGNITION_DELAY_MS`（可选）：短暂模拟延迟（毫秒）；默认 150ms，设为 0 可关闭。
 *   仅作「短暂模拟」，不引入不必要等待。
 *
 * 边界（严格）：
 * - sample 只从 `docs/sample.json` 读取（不复制真实健康数据到源码其它位置、不改样品内容）；
 * - `docs/sample.json` 是数据库导出格式（reports/items/…），与识别 schema 结构不同，
 *   故本模块为**适配层**：把 sample 映射到 AI schema，不修改样品本身；
 * - 适配是纯函数（可单测）；读取文件只在 Node 侧发生。
 */

import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RecognizeMode } from './recognizeProtocol';
import {
  emptyStructureReport,
  emptyStructureImaging,
  type StructureExtraField,
  type StructureItem,
  type StructureNote,
  type StructureReport,
} from './structureSchema';

export const MOCK_RECOGNITION_ENV = 'MOCK_RECOGNITION';
export const MOCK_RECOGNITION_DELAY_ENV = 'MOCK_RECOGNITION_DELAY_MS';
/** 仅开发环境生效：Vite dev mode 为 'development'。 */
export const MOCK_DEV_MODE = 'development';

/**
 * mock 开关：仅当 env.MOCK_RECOGNITION === 'true' 时启用；
 * 未设置 / 其它值时返回 false，保持真实行为（不回归）。
 */
export function isMockRecognitionEnabled(env: Record<string, string>): boolean {
  return env[MOCK_RECOGNITION_ENV] === 'true';
}

/**
 * mock 模拟延迟（毫秒）。默认 150ms（短暂模拟，便于观察「整理中」阶段）；
 * 读取 `MOCK_RECOGNITION_DELAY_MS`，0 表示不等待；非法/缺失回退默认值。
 */
export function mockDelayMs(env: Record<string, string>, fallback = 150): number {
  const v = env[MOCK_RECOGNITION_DELAY_ENV];
  if (v === undefined) return fallback;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return n;
  return fallback;
}

/**
 * mock 启用时的启动提示（黑盒文案：不含服务商/引擎名称）。
 * 本模块仅被 Vite dev 的 Node 侧引入（不进前端 bundle），因此这里的日志不会进入浏览器产物。
 */
export function announceMockEnabled(): void {
  console.log(
    '[mock-recognition] MOCK_RECOGNITION=true：识别接口已启用 mock，直接返回 docs/sample.json 示例，未调用任何外部识别服务或密钥。仅开发环境生效。',
  );
}

/* ------------------------------------------------------------------ *
 * sample.json（数据库导出格式）类型（只读取必要字段）。
 * ------------------------------------------------------------------ */

export interface MockReportRecord {
  hospital?: string;
  reportDate?: string;
  reportType?: string;
  title?: string;
  notes?: string;
  details?: Array<{ label?: string; value?: string }>;
}

export interface MockItemRecord {
  name?: string;
  value?: string;
  unit?: string;
  refRange?: string;
  notes?: string;
  resultKind?: string;
}

export interface MockSampleFile {
  reports?: MockReportRecord[];
  items?: MockItemRecord[];
}

/* ------------------------------------------------------------------ *
 * 适配层：sample（数据库导出格式）→ 识别 schema。
 * ------------------------------------------------------------------ */

/** 适配后的统一识别结构（与真实识别接口的 content 结构一致）。 */
export interface MockStructuredPayload {
  report: StructureReport;
  items: StructureItem[];
  extraFields: StructureExtraField[];
  notes: StructureNote[];
  unresolvedText: string;
  imaging: ReturnType<typeof emptyStructureImaging>;
}

/** details.label → report 固定字段（命中则写入 report，未命中则作为 extraFields）。 */
const DETAIL_REPORT_KEY: Record<string, keyof StructureReport> = {
  姓名: 'personName',
  性别: 'gender',
  年龄: 'age',
  病历号: 'patientId',
  病历编号: 'patientId',
  临床诊断: 'clinicalDiagnosis',
  检验目的: 'testPurpose',
  检查目的: 'testPurpose',
  送检目的: 'testPurpose',
  分院: 'branch',
  院区: 'branch',
  报告编号: 'reportNo',
  采样日期: 'sampleDate',
  接收日期: 'receiveDate',
  打印日期: 'printDate',
  送检医生: 'senderDoctor',
  送检医师: 'senderDoctor',
  开单医生: 'senderDoctor',
  检验者: 'inspector',
  审核者: 'reviewer',
  审核人: 'reviewer',
  审核医师: 'reviewer',
  报告日期: 'reportDate',
  报告类型: 'reportType',
  标题: 'title',
};

/** details.label → extraFields.section 归一（页脚→footer、页眉→header、其余→other）。 */
function sectionForLabel(label: string): StructureExtraField['section'] {
  const l = label;
  if (l.includes('页脚') || l.includes('footer')) return 'footer';
  if (l.includes('页眉') || l.includes('header')) return 'header';
  return 'other';
}

function stripMethodPrefix(method: string): string {
  return method.replace(/^方法[:：]\s*/, '').trim();
}

/**
 * 把 sample（数据库导出格式）适配为识别 schema（纯函数，可单测）。
 * - report 模式：返回完整结构（report + items + extraFields + notes + unresolvedText）；
 * - items 模式：仅返回 items（report/详情为空），与「仅识别检查项目」语义一致。
 * - 不改写 sample 内容，只读取并映射。
 */
export function adaptSampleToPayload(
  sample: MockSampleFile,
  mode: RecognizeMode,
): MockStructuredPayload {
  const reportRec = sample.reports?.[0];
  const report = emptyStructureReport();

  const unresolved: string[] = [];
  const extraFields: StructureExtraField[] = [];
  const imaging = emptyStructureImaging();

  if (reportRec) {
    report.hospital = reportRec.hospital ?? '';
    report.reportDate = reportRec.reportDate ?? '';
    report.reportType = reportRec.reportType ?? '';
    report.reportTypes = report.reportType ? [report.reportType] : [];
    report.title = reportRec.title ?? '';

    for (const d of reportRec.details ?? []) {
      const label = (d.label ?? '').trim();
      const value = (d.value ?? '').trim();
      if (label === '' || value === '') continue;
      if (label === '未识别原文') {
        unresolved.push(value);
        continue;
      }
      const key = DETAIL_REPORT_KEY[label];
      if (key) {
        if (key === 'reportTypes') report.reportTypes = value ? [value] : [];
        else report[key] = value as never;
      } else {
        extraFields.push({ section: sectionForLabel(label), key: label, value, sourceText: label });
      }
    }
  }

  const notes: StructureNote[] = [];
  if (reportRec && (reportRec.notes ?? '').trim() !== '') {
    notes.push({ text: reportRec.notes!.trim(), sourceText: reportRec.notes!.trim() });
  }

  const items: StructureItem[] = (sample.items ?? []).map((it) => ({
    name: it.name ?? '',
    result: it.value ?? '',
    referenceRange: it.refRange ?? '',
    unit: it.unit ?? '',
    method: stripMethodPrefix(it.notes ?? ''),
    // sourceText 用项目名：真实路径的清洗会校验 sourceText 能在输入文字中逐字命中，
    // 因此用 mock 做端到端测试时，OCR 输入应包含项目名。
    sourceText: it.name ?? '',
  }));

  if (mode === 'items') {
    return {
      report: emptyStructureReport(),
      items,
      extraFields: [],
      notes: [],
      unresolvedText: '',
      imaging,
    };
  }

  return { report, items, extraFields, notes, unresolvedText: unresolved.join('\n'), imaging };
}

/* ------------------------------------------------------------------ *
 * 文件读取（Node 侧）。
 * ------------------------------------------------------------------ */

/** 解析 docs/sample.json 的绝对路径（优先基于项目根 cwd，回退到模块相对路径）。 */
export function resolveSamplePath(): string {
  const fromCwd = resolve(process.cwd(), 'docs', 'sample.json');
  try {
    if (statSync(fromCwd).isFile()) return fromCwd;
  } catch {
    /* 忽略，走回退 */
  }
  return fileURLToPath(new URL('../../docs/sample.json', import.meta.url));
}

/**
 * 从一段（可能整体不合法 / 含尾段损坏的）JSON 文本中，按顶层 key 提取其「平衡括号」值。
 * docs/sample.json 作为导出样例，`attachments`/`labelMappings` 等尾段可能不完整；
 * 本适配层只提取识别所需的 `reports` / `items` 数组，**不改写样品内容**。
 * 无法定位到合法数组时返回 null。
 */
export function extractTopLevelArray(raw: string, key: string): string | null {
  const idx = raw.indexOf(`"${key}"`);
  if (idx < 0) return null;
  const start = raw.indexOf('[', idx);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

/** 读取并解析 docs/sample.json（Node 侧；只读样品，不复制/修改；容忍尾段损坏）。 */
export function readMockSample(): MockSampleFile {
  const raw = readFileSync(resolveSamplePath(), 'utf8');
  const reportsRaw = extractTopLevelArray(raw, 'reports');
  const itemsRaw = extractTopLevelArray(raw, 'items');
  const sample: MockSampleFile = {};
  if (reportsRaw !== null) sample.reports = JSON.parse(reportsRaw) as MockReportRecord[];
  if (itemsRaw !== null) sample.items = JSON.parse(itemsRaw) as MockItemRecord[];
  return sample;
}

/**
 * 构造 mock 识别响应的 content（与真实识别接口的 content 结构一致）。
 * 只读取 docs/sample.json，**绝不调用任何上游 / 网络 / API Key**。
 */
export function buildMockRecognizeContent(mode: RecognizeMode): string {
  const sample = readMockSample();
  return JSON.stringify(adaptSampleToPayload(sample, mode));
}
