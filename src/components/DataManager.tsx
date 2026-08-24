import { useEffect, useRef, useState } from 'react';
import { db } from '../db';
import { buildExport, downloadJson, importPayload, type ImportResult } from '../utils/exportImport';
import { loadSampleData } from '../sampleData';
import { todayISO } from '../utils/dates';
import { ConfirmButton } from './Kit';
import { REPORT_TYPES } from '../types';
import {
  addCustomReportType,
  deleteCustomReportType,
  loadCustomReportTypes,
  mergeReportTypes,
  validateCustomReportTypeName,
  type CustomReportType,
} from '../utils/customReportTypes';

export function DataManager({ bump }: { bump: () => void }) {
  const importRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  // 自定义报告类型管理（用户主动进入）
  const [customTypes, setCustomTypes] = useState<CustomReportType[]>([]);
  const [customLoaded, setCustomLoaded] = useState(false);
  const [customLoading, setCustomLoading] = useState(true);
  const [customLoadError, setCustomLoadError] = useState('');
  const [newTypeInput, setNewTypeInput] = useState('');
  const [newTypeError, setNewTypeError] = useState('');

  const loadTypes = async () => {
    setCustomLoading(true);
    setCustomLoadError('');
    try {
      const cts = await loadCustomReportTypes();
      setCustomTypes(cts);
      setCustomLoaded(true);
    } catch (e) {
      setCustomLoadError(`加载失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCustomLoading(false);
    }
  };

  useEffect(() => {
    void loadTypes();
  }, []);

  const handleAddCustomType = async () => {
    const existing = mergeReportTypes(customTypes);
    const v = validateCustomReportTypeName(newTypeInput, existing);
    if (!v.ok) {
      setNewTypeError(v.error);
      return;
    }
    let rec: CustomReportType | null = null;
    try {
      rec = await addCustomReportType(v.normalized);
    } catch (e) {
      setNewTypeError(`保存失败：${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (rec) {
      setCustomTypes((prev) => [...prev, rec]);
      setNewTypeInput('');
      setNewTypeError('');
    } else {
      setNewTypeError('保存失败：名称为空、过长或已存在');
    }
  };

  const handleDeleteCustomType = async (id: string) => {
    try {
      await deleteCustomReportType(id);
      setCustomTypes((prev) => prev.filter((c) => c.id !== id));
      setMessage({ tone: 'ok', text: '已删除自定义报告类型。' });
    } catch (e) {
      setMessage({ tone: 'err', text: `删除失败：${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const doExport = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const payload = await buildExport();
      downloadJson(payload, `家庭体检档案-备份-${todayISO()}.json`);
      setMessage({
        tone: 'ok',
        text: `已导出 ${payload.members.length} 位成员、${payload.reports.length} 份报告、${payload.items.length} 项条目、${payload.attachments.length} 个附件（含图片/PDF，嵌入 JSON）。`,
      });
    } catch (e) {
      setMessage({ tone: 'err', text: `导出失败：${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const onImportFile = async (file: File) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await file.text();
      const obj = JSON.parse(text) as unknown;
      if (!window.confirm('导入将【覆盖】当前本机全部数据（成员/报告/条目/附件）。确定继续吗？'))
        return;
      const result: ImportResult = await importPayload(obj);
      if (result.ok) {
        setMessage({
          tone: 'ok',
          text: `导入成功：${result.summary.members} 位成员、${result.summary.reports} 份报告、${result.summary.items} 项条目、${result.summary.attachments} 个附件。`,
        });
        bump();
      } else {
        setMessage({ tone: 'err', text: result.error });
      }
    } catch (e) {
      setMessage({
        tone: 'err',
        text: `导入失败：${e instanceof Error ? e.message : String(e)}（请确认是家庭体检档案导出的 JSON 文件）`,
      });
    } finally {
      setBusy(false);
      if (importRef.current) importRef.current.value = '';
    }
  };

  const doSample = async () => {
    if (
      !window.confirm(
        '载入示例数据（3 位成员、5 份报告，含甲状腺功能报告、标准标签与跨医院不同单位示例）？仅用于演示，可随时清空。',
      )
    )
      return;
    setBusy(true);
    setMessage(null);
    try {
      const s = await loadSampleData();
      setMessage({
        tone: 'ok',
        text: `已载入示例数据：${s.members} 位成员、${s.reports} 份报告、${s.items} 项条目。`,
      });
      bump();
    } catch (e) {
      setMessage({ tone: 'err', text: `载入示例失败：${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (!window.confirm('清空全部数据（不可恢复，请先导出备份）？')) return;
    setBusy(true);
    setMessage(null);
    try {
      await db.transaction(
        'rw',
        [
          db.members,
          db.reports,
          db.items,
          db.attachments,
          db.customReportTypes,
          db.labelMappings,
        ],
        async () => {
          await Promise.all([
            db.members.clear(),
            db.reports.clear(),
            db.items.clear(),
            db.attachments.clear(),
            db.customReportTypes.clear(),
            db.labelMappings.clear(),
          ]);
        },
      );
      setMessage({ tone: 'ok', text: '已清空全部本地数据。' });
      bump();
    } catch (e) {
      setMessage({ tone: 'err', text: `清空失败：${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="data-manager">
      <div className="card form-card">
        <h4>导出 / 导入（JSON，含附件）</h4>
        <p className="dim">
          导出文件为单个 JSON，包含全部成员、报告、检查条目以及附件（图片/PDF 以 base64
          内嵌，可在其他浏览器导入还原）。 导出文件请自行妥善保管——它包含完整健康资料。
        </p>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void doExport()}
          >
            ⬇ 导出全部数据（JSON）
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => importRef.current?.click()}
          >
            ⬆ 导入 JSON（覆盖）
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
            }}
          />
        </div>
      </div>

      <div className="card form-card">
        <h4>自定义报告类型管理</h4>
        <p className="dim">
          报告类型为严格受控选项：内置类型不可删除；自定义类型由你主动添加/删除，用于识别时匹配检验目的。
        </p>
        {customLoading && <p className="dim" role="status">正在加载自定义报告类型…</p>}
        {customLoadError && (
          <div className="edit-load-error" role="alert">
            <span className="error-text">{customLoadError}</span>
            <button type="button" className="btn btn-sm" onClick={() => void loadTypes()}>
              重试
            </button>
          </div>
        )}
        {!customLoading && !customLoadError && (
          <>
            <div className="att-head">
              <strong>内置类型（不可删除）</strong>
            </div>
            <div className="att-row">
              {REPORT_TYPES.map((t) => (
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
                style={{ flex: 1 }}
              />
              <button type="button" className="btn btn-sm" onClick={() => void handleAddCustomType()}>
                添加
              </button>
            </div>
            {newTypeError && <p className="error-text">{newTypeError}</p>}
            {customLoaded && customTypes.length === 0 ? (
              <p className="dim">暂无自定义报告类型；可在上方手动新增，或在核对保存时按一次性建议保存。</p>
            ) : (
              <div className="att-row">
                {customTypes.map((c) => (
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
                      onConfirm={() => void handleDeleteCustomType(c.id)}
                    />
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="card form-card">
        <h4>示例数据</h4>
        <p className="dim">
          载入一组不涉及真实隐私的示例数据以快速体验：包含 3 位成员、5 份报告（含两分甲状腺功能
          报告），并特意包含「同一标准标签在不同医院单位不同（mmol/L 与 mg/dL）」「单位缺失」以及
          「待确认项目不参与趋势」示例，便于查看不可比较的并排提示；标准标签仅作兼容保留，不影响趋势。仅在你主动点击时写入。
        </p>
        <div className="btn-row">
          <button type="button" className="btn" disabled={busy} onClick={() => void doSample()}>
            🧪 载入示例数据
          </button>
        </div>
      </div>

      <div className="card form-card danger-zone">
        <h4>危险操作</h4>
        <p className="dim">清空后不可恢复；建议先导出备份再做。</p>
        <ConfirmButton
          label="清空全部本地数据"
          confirmText="清空全部本地数据（成员、报告、条目、附件、自定义报告类型和标签映射；先导出备份！）"
          danger
          onConfirm={() => void clearAll()}
        />
      </div>

      {message && (
        <div
          className={`notice ${message.tone === 'ok' ? 'notice-ok' : 'notice-err'}`}
          role="status"
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
