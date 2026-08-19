import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

/**
 * Service Worker 注册策略：
 * - 开发模式（import.meta.env.DEV）**绝不注册 SW**，并在加载后主动注销当前
 *   origin 上所有 service worker、删除仅本应用使用的 fma-static-* Cache Storage。
 *   这是对“用户仍看到旧 UI”根因的精确修复：历史上 SW 在 Vite dev 下也被注册，
 *   且 sw.js 曾对 index/JS 长期 cache-first，导致 localhost 开发时旧页面被缓存残留。
 * - 仅生产模式（import.meta.env.PROD）注册 SW（本地 PWA 离线可用；
 *   只缓存应用静态资源与本地 OCR 资源，绝不接触健康数据）。
 */
async function unregisterDevServiceWorkers() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
  } catch {
    // 环境不支持或注册表不可访问时静默即可
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('fma-static-')).map((k) => caches.delete(k)),
      );
    }
  } catch {
    // 缓存不可用时静默即可
  }
}

if (import.meta.env.DEV) {
  window.addEventListener('load', () => {
    void unregisterDevServiceWorkers();
  });
} else if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // 环境不支持或注册失败时静默失败即可
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
