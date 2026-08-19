/**
 * OCR 项目名的「低风险展示清理」（displayName）。
 *
 * 边界（严格）：
 * - 只做**展示层**清理：去首尾空白、折叠重复空白/换行、移除不可见控制字符；
 *   并移除 OCR 常见的「分词噪音」：中文内部被插入的单个空格，以及中文与紧邻英文字母/数字
 *   之间的分隔空格（如「糖化 血红 蛋白」→「糖化血红蛋白」、「蛋白 Al」→「蛋白Al」）；
 * - **绝不静默纠正医学字符**：Al/A1/AI、L/I/1、O/0 等相似字符一律不替换、不做大小写归一；
 * - 只删除空白，**绝不把其他未知词静默合并/纠错**（不做词典/模糊匹配）；
 * - raw 恒为传入原文（绝不覆盖）——展示名称与原文分开展示，UI 同时显示
 *   「识别名称（raw）」与「识别名称（清理后展示）」，原始值可随时查看；
 * - 规范化（大小写/折叠等）仅用于“匹配定位”，与本函数无关（见 labelDirectory.ts）。
 */

/** 不可见控制字符（C0 控制符、零宽字符、BOM、词连接符等；\n \t \r 也属于空白，统一折叠） */
const INVISIBLE_CONTROL =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD\u200B-\u200D\u2060\uFEFF\uFFFC]/g;

/** 展示清理的结果：raw 恒为传入原文（绝不修改），display 为清理后的展示名。 */
export interface DisplayNameResult {
  /** 原始值（与传入完全一致，未做任何修改/纠正） */
  raw: string;
  /** 清理后用于展示的名称（可能为空串） */
  display: string;
  /** 是否发生过修改（用于 UI 提示「已清理展示」） */
  changed: boolean;
}

/** 折叠空白（含换行、Tab、全角空格等）为单个普通空格，并去首尾。 */
export function collapseWhitespace(s: string): string {
  // \s 在 JS 中已覆盖 \n \t \r \u3000 等；g/u 标志下按 Unicode 字符折叠
  return s.replace(/\s+/gu, ' ').trim();
}

/**
 * 移除 OCR「分词噪音」：
 * 1) 中文字符之间被插入的单个空白（含折叠后的空格），如「糖化 血红 蛋白」→「糖化血红蛋白」；
 * 2) 中文与紧邻英文字母/数字之间的分隔空白，如「蛋白 Al」→「蛋白Al」。
 *
 * 仅删除空白，绝不合并/纠正任何未知词，不依赖词典或模糊匹配。
 */
function removeCjkWhitespaceNoise(s: string): string {
  // 中文内部空格：把被空白分隔的连续中文串合并为一段（移除其中全部空白）。
  // 用整段 CJK run 而非逐对字符，可正确处理「糖化 血 红 蛋白」这类被多个空格
  // 交替分隔的连续中文（逐对递增匹配会因重叠而漏删）。
  let out = s.replace(/[\u4e00-\u9fff]+(?:\s+[\u4e00-\u9fff]+)+/g, (m) => m.replace(/\s+/g, ''));
  // 中文与紧邻英文字母/数字之间的分隔空格：各方向各删一次即可（不重叠）。
  out = out
    .replace(/([\u4e00-\u9fff])\s+([A-Za-z0-9])/g, '$1$2')
    .replace(/([A-Za-z0-9])\s+([\u4e00-\u9fff])/g, '$1$2');
  return out;
}

/**
 * 低风险展示清理：
 * 1) 移除不可见控制字符（保留可见字符，不做任何形近字纠正）；
 * 2) 折叠重复空白/换行为单个空格；
 * 3) 移除中文内部/中文与紧邻英数之间的 OCR 分词空格；
 * 4) 去首尾空白。
 */
export function cleanDisplayName(raw: string): DisplayNameResult {
  const before = raw;
  const withoutControls = before.replace(INVISIBLE_CONTROL, '');
  const display = removeCjkWhitespaceNoise(collapseWhitespace(withoutControls));
  return {
    raw: before,
    display,
    changed: display !== before,
  };
}

/**
 * 清理输入框/文本值前的备注、医院等自由文本：仅折叠空白 + 去首尾（不含医学纠正）。
 */
export function cleanFreeText(raw: string): string {
  return collapseWhitespace(raw.replace(INVISIBLE_CONTROL, ''));
}
