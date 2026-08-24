import { db } from '../db';
import type { AttachmentRecord } from '../types';
import type { ItemDraft } from './labels';

/**
 * 编辑既有报告（ReportReview 编辑模式）的异步加载逻辑（纯逻辑 + 可单测）。
 *
 * 背景（P0 安全性）：编辑已有报告时，项目/附件必须先从数据库异步加载完成才能允许保存，
 * 否则可能出现「加载未完成/失败时用空数组覆盖既有项目/附件」的竞态。
 * 这里把「加载数据」与「保存门槛」抽成可单测的纯逻辑：
 * - loadEditReportData：按 reportId 查询既有项目/附件，转成可编辑草稿；
 * - canSaveEditReport：编辑模式仅在「已加载成功」且「加载出的 reportId 与当前编辑对象一致」
 *   时允许保存；新建模式（非编辑）恒为 true，不增加不必要等待。
 */

export type EditLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface EditLoadState {
  status: EditLoadStatus;
  error: string;
  /** 成功加载出的报告 id（用于与当前编辑对象做一致性校验，防错位覆盖）。 */
  loadedReportId: string | null;
}

export const IDLE_EDIT_LOAD: EditLoadState = {
  status: 'idle',
  error: '',
  loadedReportId: null,
};

/**
 * 只有最新请求且仍对应当前编辑报告时，异步结果才能写入界面状态。
 * requestId 防止旧请求晚返回，reportId 防止结果错写到另一份报告。
 */
export function isCurrentEditLoadRequest(params: {
  requestId: number;
  currentRequestId: number;
  reportId: string;
  currentReportId: string | null;
}): boolean {
  return (
    params.requestId === params.currentRequestId && params.reportId === params.currentReportId
  );
}

/** 把查询到的既有条目转成可编辑草稿（保持 index 顺序，method 读入 testMethod 字段）。 */
function itemsToDrafts(
  its: Array<{
    id: string;
    index: number;
    name: string;
    resultKind: 'numeric' | 'qualitative';
    value: string;
    unit: string;
    refRange: string;
    notes: string;
    testMethod?: string;
    confirmed: boolean;
    standardLabel?: string;
  }>,
): ItemDraft[] {
  return [...its]
    .sort((a, b) => a.index - b.index)
    .map((it) => ({
      id: it.id,
      name: it.name,
      resultKind: it.resultKind,
      value: it.value,
      unit: it.unit,
      refRange: it.refRange,
      notes: it.notes,
      testMethod: (it.testMethod ?? '').trim(),
      confirmed: it.confirmed,
      standardLabel: (it.standardLabel ?? '').trim(),
    }));
}

/** 编辑模式加载既有项目与附件。 */
export async function loadEditReportData(reportId: string): Promise<{
  items: ItemDraft[];
  attachments: AttachmentRecord[];
}> {
  const [its, atts] = await Promise.all([
    db.items.where('reportId').equals(reportId).toArray(),
    db.attachments.where('reportId').equals(reportId).toArray(),
  ]);
  return { items: itemsToDrafts(its), attachments: atts };
}

/**
 * 编辑模式是否允许保存（保存门槛，防覆盖竞态）。
 * - 新建模式（editing=false）恒为 true：不因加载而阻塞保存；
 * - 编辑模式仅当「已加载成功（ready）」且「加载出的 loadedReportId 与当前 editingReportId 一致」
 *   时允许保存：加载中 / 加载失败 / 加载错位（reportId 不一致）一律禁止保存。
 */
export function canSaveEditReport(params: {
  editing: boolean;
  status: EditLoadStatus;
  loadedReportId: string | null;
  editingReportId?: string | null;
}): boolean {
  if (!params.editing) return true;
  return params.status === 'ready' && params.loadedReportId === params.editingReportId;
}
