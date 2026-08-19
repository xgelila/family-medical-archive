/*
 * Service Worker：PWA 离线缓存
 *
 * 策略：
 *  1. 预先缓存应用静态外壳（HTML / JS / CSS / 图标 / manifest）；
 *  2. 尽力预先缓存本地 OCR 资源（worker / WebAssembly 内核 / 中文模型）——
 *     列表来自 ./ocr/ocr-assets.json（由 scripts/sync-ocr-assets.mjs 生成）。
 *     缓存失败仅降级为首次使用时由运行时缓存兜底，不影响安装；
 *  3. 导航请求（页面入口 / index）采用 **network-first**：网络成功即回写缓存，
 *     仅当网络失败时才回退缓存——避免旧版 index/JS 被 cache-first 长期挂住
 *     （此前 dev 环境误注册的旧 SW 曾导致用户持续看到旧 UI）；
 *  4. 运行时缓存**仅限明确的静态资源路径**（/assets/、/ocr/、/icons/、manifest
 *     及 .js/.css/.json 等可预期后缀），**绝不泛缓存所有同源 GET**——
 *     健康数据/用户附件（blob / object URL）不经由此缓存。
 *
 * 隐私边界：
 *  - 健康数据保存在浏览器 IndexedDB 中，不经过任何网络请求；
 *  - 用户上传的附件/图片为 blob/object URL，不经由此 SW 缓存；
 *  - 本文件绝不读写健康数据，也不向任何服务器发送请求（所有资源均与应用同源）。
 */
const CACHE = 'fma-static-v3';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
const OCR_ASSETS_MANIFEST = './ocr/ocr-assets.json';

/** 是否属于“可运行时缓存”的明确静态资源/OCR 路径（不泛缓存所有同源 GET） */
function isCacheableStatic(url) {
  const path = url.pathname;
  if (/^\/(assets|ocr|icons)\//.test(path)) return true;
  return /\.(js|mjs|css|json|png|svg|webmanifest|woff2?|gif|jpg|jpeg|webp)$/.test(path);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      // 尽力预缓存本地 OCR 资源：单项失败不阻塞安装（首次使用时运行时缓存兜底）
      .then(() =>
        fetch(OCR_ASSETS_MANIFEST)
          .then((res) => (res.ok ? res.json() : { assets: [] }))
          .then((manifest) =>
            caches.open(CACHE).then((cache) =>
              Promise.allSettled(
                (manifest.assets ?? []).map((url) => cache.add(url).catch(() => {})),
              ),
            ),
          )
          .catch(() => {}),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      // 只清理本应用（fma-static-*）的旧版本缓存，绝不误删同源其他应用/项目的缓存
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE && key.startsWith('fma-static-'))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 导航请求：network-first（网络成功回写缓存；网络失败才用缓存兜底），避免旧 index 长期缓存
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches
              .open(CACHE)
              .then((cache) => cache.put(req, copy))
              .catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches
            .match(req)
            .then((hit) => hit || caches.match('./index.html') || caches.match('./')),
        ),
    );
    return;
  }

  // 仅对明确静态资源/OCR 路径做 cache-first + 后台写缓存
  if (!isCacheableStatic(url)) return;
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches
              .open(CACHE)
              .then((cache) => cache.put(req, copy))
              .catch(() => {});
          }
          return res;
        }),
    ),
  );
});