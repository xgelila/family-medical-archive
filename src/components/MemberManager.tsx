import { useEffect, useState } from 'react';
import { db, deleteMemberCascade, now, uid } from '../db';
import { EMPTY_MEMBER, type Member } from '../types';
import { ageByBirthDate, formatTimestamp } from '../utils/dates';
import { Chip, ConfirmButton, EmptyState, Field, Section } from './Kit';

const RELATIONS = ['本人', '配偶', '父亲', '母亲', '儿子', '女儿', '其他'];
const GENDERS = ['男', '女', '未填写'] as const;

export function MemberManager({ refreshKey, bump }: { refreshKey: number; bump: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [counts, setCounts] = useState<Map<string, { reports: number; items: number }>>(new Map());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const reload = async () => {
    const list = await db.members.orderBy('createdAt').toArray();
    setMembers(list);
    const c = new Map<string, { reports: number; items: number }>();
    for (const m of list) {
      const [reports, items] = await Promise.all([
        db.reports.where('memberId').equals(m.id).count(),
        db.items.where('memberId').equals(m.id).count(),
      ]);
      c.set(m.id, { reports, items });
    }
    setCounts(c);
  };

  useEffect(() => {
    void reload();
  }, [refreshKey]);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (m: Member) => {
    setEditing(m);
    setFormOpen(true);
  };

  const save = async (form: Member) => {
    const t = now();
    const rec: Member = {
      ...form,
      id: form.id || uid(),
      updatedAt: t,
      createdAt: form.createdAt || t,
    };
    await db.members.put(rec);
    setFormOpen(false);
    bump();
  };

  const remove = async (m: Member) => {
    setDeleteError('');
    try {
      await deleteMemberCascade(m.id);
      bump();
    } catch (e) {
      setDeleteError(`删除失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <Section
      title={`家庭成员（${members.length}）`}
      right={
        <button type="button" className="btn btn-primary" onClick={openNew}>
          + 添加成员
        </button>
      }
    >
      {deleteError && <div className="notice notice-err" role="alert">{deleteError}</div>}
      {formOpen && (
        <MemberForm
          initial={editing ?? EMPTY_MEMBER}
          onCancel={() => setFormOpen(false)}
          onSave={save}
        />
      )}
      {members.length === 0 && !formOpen ? (
        <EmptyState
          icon="👨‍👩‍👧‍👦"
          title="还没有家庭成员"
          desc="先添加家庭成员（如本人、配偶、父母、子女），再为其创建体检报告。"
          action={
            <button type="button" className="btn btn-primary" onClick={openNew}>
              + 添加第一位成员
            </button>
          }
        />
      ) : (
        <div className="card-grid">
          {members.map((m) => {
            const age = ageByBirthDate(m.birthDate);
            const c = counts.get(m.id);
            return (
              <div key={m.id} className="card member-card">
                <div className="member-avatar">{m.name.slice(0, 1)}</div>
                <div className="member-body">
                  <div className="member-name">
                    {m.name}
                    <Chip tone="info">{m.relation || '关系未填'}</Chip>
                    <Chip>{m.gender}</Chip>
                    {age !== null && <Chip tone="neutral">{age} 岁</Chip>}
                  </div>
                  <div className="member-meta">
                    出生日期：{m.birthDate || '未填写'} · 建档：{formatTimestamp(m.createdAt)}
                  </div>
                  <div className="member-meta">
                    报告 {c?.reports ?? 0} 份 · 条目 {c?.items ?? 0} 项
                  </div>
                </div>
                <div className="card-actions">
                  <button type="button" className="btn btn-sm" onClick={() => openEdit(m)}>
                    编辑
                  </button>
                  <ConfirmButton
                    label="删除"
                    confirmText={`删除成员「${m.name}」将同时删除其所有报告、检查项目和附件，且不可恢复`}
                    danger
                    small
                    onConfirm={() => void remove(m)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function MemberForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Member;
  onSave: (m: Member) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Member>({ ...initial });

  const set = (patch: Partial<Member>) => setForm((f) => ({ ...f, ...patch }));
  const canSave = form.name.trim() !== '';

  return (
    <div className="card form-card">
      <h4>{initial.id ? '编辑成员' : '添加成员'}</h4>
      <div className="form-grid">
        <Field label="姓名 *">
          <input
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="如：李建国"
            autoFocus
          />
        </Field>
        <Field label="性别">
          <select
            value={form.gender}
            onChange={(e) => set({ gender: e.target.value as Member['gender'] })}
          >
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </Field>
        <Field label="出生日期" hint="可空">
          <input
            type="date"
            value={form.birthDate}
            onChange={(e) => set({ birthDate: e.target.value })}
          />
        </Field>
        <Field label="关系">
          <select value={form.relation} onChange={(e) => set({ relation: e.target.value })}>
            <option value="">未填写</option>
            {RELATIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canSave}
          onClick={() => onSave(form)}
        >
          保存
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}
