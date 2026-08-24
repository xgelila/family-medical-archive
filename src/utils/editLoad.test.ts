import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { db, uid } from '../db';
import type { AttachmentRecord, ReportItem } from '../types';
import {
  canSaveEditReport,
  isCurrentEditLoadRequest,
  loadEditReportData,
} from './editLoad';

/**
 * 阶段 1（P0 安全性）：编辑已有报告时，项目/附件必须异步加载完成后才能保存，
 * 防止「加载未完成/失败时用空数组覆盖既有项目/附件」的竞态。
 *
 * 覆盖：
 * - 加载中（loading）不能保存；
 * - 加载成功（ready 且 reportId 一致）可以保存；
 * - 加载失败（error）不能保存，且可重试（重新触发 loadEditReportData 成功后恢复 ready）；
 * - 加载错位（loadedReportId 与当前编辑对象不一致）不能保存（防错位覆盖）；
 * - 新建模式（非编辑）不因加载而阻塞，恒可保存（不增加不必要等待）；
 * - loadEditReportData 按 reportId 查询并保持顺序（真实 DB 行为，fake-indexeddb）。
 */

afterEach(async () => {
  await Promise.all([db.items.clear(), db.attachments.clear(), db.reports.clear()]);
});

const item = (over: Partial<ReportItem> = {}): ReportItem => ({
  id: uid(),
  reportId: 'r1',
  memberId: 'm1',
  index: 0,
  name: '血红蛋白',
  resultKind: 'numeric',
  value: '145',
  unit: 'g/L',
  refRange: '130-175',
  testMethod: '化学发光法',
  notes: '',
  confirmed: true,
  standardLabel: '',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const att = (over: Partial<AttachmentRecord> = {}): AttachmentRecord => ({
  id: uid(),
  reportId: 'r1',
  name: 'a.png',
  mimeType: 'image/png',
  size: 10,
  kind: 'image',
  blob: new Blob(['x']),
  createdAt: 1,
  ...over,
});

describe('isCurrentEditLoadRequest（异步结果竞态保护）', () => {
  it('旧请求晚返回时不能写入当前状态', () => {
    expect(
      isCurrentEditLoadRequest({
        requestId: 1,
        currentRequestId: 2,
        reportId: 'r1',
        currentReportId: 'r1',
      }),
    ).toBe(false);
  });

  it('reportId 不一致时不能写入当前状态', () => {
    expect(
      isCurrentEditLoadRequest({
        requestId: 2,
        currentRequestId: 2,
        reportId: 'r1',
        currentReportId: 'r2',
      }),
    ).toBe(false);
  });

  it('最新请求且 reportId 一致时允许写入', () => {
    expect(
      isCurrentEditLoadRequest({
        requestId: 2,
        currentRequestId: 2,
        reportId: 'r2',
        currentReportId: 'r2',
      }),
    ).toBe(true);
  });
});

describe('canSaveEditReport（保存门槛：防覆盖竞态）', () => {
  const base = { editing: true, status: 'loading' as const, loadedReportId: 'r1', editingReportId: 'r1' };

  it('加载中（loading）不能保存', () => {
    expect(canSaveEditReport(base)).toBe(false);
  });

  it('加载成功（ready）且 reportId 一致时可以保存', () => {
    expect(canSaveEditReport({ ...base, status: 'ready' })).toBe(true);
  });

  it('加载失败（error）不能保存', () => {
    expect(canSaveEditReport({ ...base, status: 'error' })).toBe(false);
    expect(canSaveEditReport({ ...base, status: 'error', loadedReportId: null })).toBe(false);
  });

  it('未开始加载（idle）不能保存', () => {
    expect(canSaveEditReport({ ...base, status: 'idle', loadedReportId: null })).toBe(false);
  });

  it('加载错位（loadedReportId 与当前编辑对象不一致）不能保存', () => {
    expect(
      canSaveEditReport({ editing: true, status: 'ready', loadedReportId: 'old', editingReportId: 'new' }),
    ).toBe(false);
  });

  it('新建模式（非编辑）不因加载而阻塞，恒可保存', () => {
    expect(
      canSaveEditReport({ editing: false, status: 'idle', loadedReportId: null, editingReportId: null }),
    ).toBe(true);
  });
});

describe('loadEditReportData（真实 DB 加载，fake-indexeddb）', () => {
  it('按 reportId 加载既有项目与附件，并保持 index 顺序', async () => {
    await db.items.bulkAdd([
      item({ id: 'i1', reportId: 'r1', index: 1, name: 'B' }),
      item({ id: 'i0', reportId: 'r1', index: 0, name: 'A' }),
    ]);
    await db.attachments.put(att({ id: 'a1', reportId: 'r1' }));
    // 其他报告的条目不应混入
    await db.items.put(item({ id: 'i2', reportId: 'r2', index: 0, name: '其他报告' }));

    const { items, attachments } = await loadEditReportData('r1');
    expect(items.map((i) => i.name)).toEqual(['A', 'B']);
    expect(items[0].testMethod).toBe('化学发光法');
    expect(items[0].confirmed).toBe(true);
    expect(attachments.map((a) => a.id)).toEqual(['a1']);
  });

  it('空报告返回空数组（不崩溃），调用方仅在该状态为 ready 时保存', async () => {
    const { items, attachments } = await loadEditReportData('r-empty');
    expect(items).toEqual([]);
    expect(attachments).toEqual([]);
  });
});
