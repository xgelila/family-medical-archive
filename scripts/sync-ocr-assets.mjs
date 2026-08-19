/**
 * sync-ocr-assets.mjs
 *
 * 将 tesseract.js 的浏览器端资源「本地化」到 public/ocr/：
 *   - tesseract.js 的 worker 脚本（dist/worker.min.js）
 *   - tesseract.js-core 的 LSTM 内核（relaxedsimd / simd / 普通 三种变体，随浏览器能力自动选择）
 *   - 中文识别语言模型（@tesseract.js-data/chi_sim 的 4.0.0_best_int 量化模型，体积小、适合浏览器）
 *
 * 这些文件随 Vite 构建原样进入 dist/ocr/，与应用程序同源加载：
 * 运行 OCR 时不向任何第三方/CDN 发起请求，不上传任何图片或报告。
 *
 * 用法：npm run sync:ocr
 * 说明：本脚本只是「重新生成」已检入 public/ocr/ 的文件；源文件缺失时仅告警（不影响 npm install）。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = join(root, 'public', 'ocr');
const coreOut = join(outRoot, 'core');
const langOut = join(outRoot, 'lang');
mkdirSync(coreOut, { recursive: true });
mkdirSync(langOut, { recursive: true });

const warn = (msg) => console.warn(`[sync-ocr] 跳过（源文件缺失）：${msg}`);

// 1) Worker 脚本
const workerSrc = join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js');
if (existsSync(workerSrc)) {
  cpSync(workerSrc, join(outRoot, 'worker.min.js'));
  console.log('[sync-ocr] worker.min.js 已复制');
} else {
  warn('node_modules/tesseract.js/dist/worker.min.js');
}

// 2) LSTM 内核（应用固定使用 OEM.LSTM_ONLY，因此只需 LSTM 变体）
const coreFiles = [
  'tesseract-core-relaxedsimd-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js',
];
for (const f of coreFiles) {
  const src = join(root, 'node_modules', 'tesseract.js-core', f);
  if (existsSync(src)) {
    cpSync(src, join(coreOut, f));
    console.log(`[sync-ocr] core/${f} 已复制`);
  } else {
    warn(`node_modules/tesseract.js-core/${f}`);
  }
}

// 3) 中文语言模型（best_int 量化版：体积小、适合浏览器；LSTM-only 数据）
const langs = [{ pkg: 'chi_sim', file: 'chi_sim.traineddata.gz' }];
for (const { pkg, file } of langs) {
  const src = join(root, 'node_modules', '@tesseract.js-data', pkg, '4.0.0_best_int', file);
  if (existsSync(src)) {
    cpSync(src, join(langOut, file));
    console.log(`[sync-ocr] lang/${file} 已复制（${pkg} best_int）`);
  } else {
    warn(`@tesseract.js-data/${pkg}/4.0.0_best_int/${file}`);
  }
}

// 4) 生成资源清单，供 Service Worker 预缓存（小文件，仅文件列表）
const assets = [
  'worker.min.js',
  ...coreFiles.map((f) => `core/${f}`),
  ...langs.map((l) => `lang/${l.file}`),
];
const entries = assets
  .map((file) => ({ file, size: statSync(join(outRoot, file)).size }))
  .filter((e) => e.size > 0);
writeFileSync(
  join(outRoot, 'ocr-assets.json'),
  JSON.stringify({ assets: entries.map((e) => `./ocr/${e.file}`) }, null, 2) + '\n',
);
console.log(
  `[sync-ocr] ocr-assets.json 已生成（${entries.length} 个文件，共 ${(entries.reduce((s, e) => s + e.size, 0) / 1024 / 1024).toFixed(1)} MB）`,
);
