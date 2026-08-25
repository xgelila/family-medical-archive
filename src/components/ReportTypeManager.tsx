import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { CustomReportType, ReportKind } from '../types';
import { IMAGING_REPORT_TYPES, LAB_REPORT_TYPES, REPORT_TYPES } from '../types';
import {
  addCustomReportType,
  deleteCustomReportType,
  loadCustomReportTypes,
  mergeReportTypes,
  validateCustomReportTypeName,
} from '../utils/customReportTypes';
import { ConfirmButton } from './Kit';

/**
 * 可复用的「报告类型」管理 UI + 持久化逻辑。
 *
 * 唯一的数据源是 utils/customReportTypes.ts（增/删/读同一套实现）；
 * 本组件只在类型管理场景（核对页弹层 / 数据管理页卡片）复用同一逻辑，绝不复制第二份
 * 增删改存储代码。
 *
 * 设计：
 * - ReportTypeManagerPanel：纯管理面板（无弹层外壳），可按 reportKind 隔离
 *   （lab / imaging / other）；新增/删除自定义类型、展示内置类型（不可删除）；
 * - ReportTypeManagerModal：移动端优先的底部弹层外壳，复用 Panel；
 *   不超出视口、底部安全区、关闭按钮 ≥44px、焦点/aria、遮罩点击关闭。
 */

function builtinTypesFor(reportKind?: ReportKind): readonly string[] {
  if (reportKind === 'imaging') return IMAGING_REPORT_TYPES;
  if (reportKind === 'lab') return LAB_REPORT_TYPES;
  return REPORT_TYPES;
}

/** 自定义类型按 reportKind 隔离（与 ReportReview 的 kindTypes 过滤语义一致）。 */
function typeMatchesKind(t: CustomReportType, reportKind?: ReportKind): boolean {
  if (!reportKind) return true; // 数据管理页：展示全部
  if (reportKind === 'lab') return !t.reportKind || t.reportKind === 'lab';
  if (reportKind === 'other') return true; // 旧数据兼容，与 ReportReview 一致不加过滤
  return t.reportKind === reportKind; // imaging
}

/** 共享管理面板（无弹层外壳）。onChanged 在新增/删除后触发，供宿主刷新其当前选项。 */
export function ReportTypeManagerPanel({
  reportKind,
  onChanged,
  kindLabel,
}: {
  /** 传入 reportKind 时按大类隔离；缺省展示全部（数据管理页）。 */
  reportKind?: ReportKind;
  /** 新增/删除后回调（宿主刷新报告类型选项，如核对页下拉）。 */
  onChanged?: () => void;
  kindLabel?: string;
}) {
  const [customTypes, setCustomTypes] = useState<CustomReportType[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [newTypeInput, setNewTypeInput] = useState('');
  const [newTypeError, setNewTypeError] = useState('');

  const loadTypes = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const cts = await loadCustomReportTypes();
      setCustomTypes(cts);
      setLoaded(true);
    } catch (e) {
      setLoadError(`加载失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTypes();
  }, []);

  const visibleCustom = customTypes.filter((t) => typeMatchesKind(t, reportKind));

  const handleAdd = async () => {
    setNewTypeError('');
    // 名称全局唯一（内置 + 全部自定义），跨大类也不允许重复。
    const mergedAll = mergeReportTypes(customTypes);
    const v = validateCustomReportTypeName(newTypeInput, mergedAll);
    if (!v.ok) {
      setNewTypeError(v.error);
      return;
    }
    let rec: CustomReportType | null = null;
    try {
      rec = await addCustomReportType(v.normalized, [], reportKind);
    } catch (e) {
      setNewTypeError(`保存失败：${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (rec) {
      setCustomTypes((prev) => [...prev, rec]);
      setNewTypeInput('');
      onChanged?.();
    } else {
      setNewTypeError('保存失败：名称为空、过长或已存在');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCustomReportType(id);
      setCustomTypes((prev) => prev.filter((c) => c.id !== id));
      onChanged?.();
    } catch (e) {
      setNewTypeError(`删除失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="report-type-manager-panel" data-report-type-manager>
      {loading && (
        <p className="dim" role="status">
          正在加载自定义报告类型…
        </p>
      )}
      {loadError && (
        <div className="edit-load-error" role="alert">
          <span className="error-text">{loadError}</span>
          <button type="button" className="btn btn-sm" onClick={() => void loadTypes()}>
            重试
          </button>
        </div>
      )}
      {!loading && !loadError && (
        <>
          {kindLabel && <p className="dim report-type-manager-kind">当前管理范围：{kindLabel}</p>}
          <div className="att-head">
            <strong>内置类型（不可删除）</strong>
          </div>
          <div className="att-row">
            {builtinTypesFor(reportKind).map((t) => (
              <span key={t} className="att-chip" title="内置报告类型">
                {t}
              </span>
            ))}
          </div>
          <div className="att-head">
            <strong>我的报告类型（自定义）</strong>
            <small>可删除；可手动新增</small>
          </div>
          <div className="custom-types-add" style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              value={newTypeInput}
              onChange={(e) => {
                setNewTypeInput(e.target.value);
                setNewTypeError('');
              }}
              placeholder="新增自定义报告类型名称"
              aria-label="新增自定义报告类型名称"
              style={{ flex: 1 }}
            />
            <button type="button" className="btn btn-sm" onClick={() => void handleAdd()}>
              添加
            </button>
          </div>
          {newTypeError && <p className="error-text">{newTypeError}</p>}
          {loaded && visibleCustom.length === 0 ? (
            <p className="dim">
              暂无自定义报告类型；可在上方手动新增，或在核对保存时按一次性建议保存。
            </p>
          ) : (
            <div className="att-row">
              {visibleCustom.map((c) => (
                <span key={c.id} className="att-chip-row">
                  <span
                    className="att-chip"
                    title={c.aliases.length > 0 ? `已确认别名：${c.aliases.join('、')}` : c.name}
                  >
                    {c.name}
                  </span>
                  <ConfirmButton
                    label="删除"
                    confirmText={`删除自定义报告类型「${c.name}」？`}
                    danger
                    small
                    onConfirm={() => void handleDelete(c.id)}
                  />
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 移动端优先的「管理报告类型」弹层（底部抽屉），复用 ReportTypeManagerPanel。 */
export function ReportTypeManagerModal({
  onClose,
  reportKind,
  onChanged,
  title,
}: {
  onClose: () => void;
  reportKind?: ReportKind;
  onChanged?: () => void;
  title?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    // 打开时焦点移入弹层，读屏可聚焦。
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const defaultTitle = '管理报告类型';
  const kindLabel =
    reportKind === 'imaging'
      ? '检查（影像）'
      : reportKind === 'lab'
        ? '检验'
        : reportKind === 'other'
          ? '其他'
          : '全部';

  return (
    <div
      className="modal-overlay report-type-modal-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="report-type-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title ?? defaultTitle}
        tabIndex={-1}
      >
        <header className="report-type-modal-head">
          <strong>{title ?? defaultTitle}</strong>
          <button
            type="button"
            className="report-type-modal-close"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </header>
        <div className="report-type-modal-body">
          <ReportTypeManagerPanel
            reportKind={reportKind}
            kindLabel={kindLabel}
            onChanged={onChanged}
          />
        </div>
        <footer className="report-type-modal-foot">
          <button
            type="button"
            className="btn btn-primary report-type-modal-done"
            onClick={onClose}
          >
            完成
          </button>
        </footer>
      </div>
    </div>
  );
}
