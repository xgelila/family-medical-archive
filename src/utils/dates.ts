/** 日期工具：一律使用 YYYY-MM-DD 字符串 */

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toDisplayDate(iso: string): string {
  return iso || '—';
}

export function formatTimestamp(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 计算年龄（按出生日期，未填写返回 null） */
export function ageByBirthDate(birthDate: string, atISO = todayISO()): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate + 'T00:00:00');
  const a = new Date(atISO + 'T00:00:00');
  if (isNaN(b.getTime()) || b > a) return null;
  let age = a.getFullYear() - b.getFullYear();
  const m = a.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && a.getDate() < b.getDate())) age -= 1;
  return age;
}
