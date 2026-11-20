// 偵測網站有新部署，讓還開著舊版的分頁（尤其是加到主畫面、從背景叫回來的時候）提示重新整理。
// 載入時記下首頁的 ETag（沒有就用 Last-Modified），之後每次回到前景再問一次，不一樣就代表網站已更新。
// 不需要手動改版本號。本機開發伺服器回的是檔案修改時間，改了 index.html 才會觸發。

async function fingerprint() {
  // no-store 略過 HTTP 快取；HEAD 只拿表頭
  const res = await fetch(location.pathname, { method: 'HEAD', cache: 'no-store' });
  if (!res.ok) return null;
  return res.headers.get('ETag') || res.headers.get('Last-Modified') || null;
}

/** 網站有新部署時呼叫 onUpdate()；之後每次回到前景都會再呼叫一次（不再重問伺服器）。 */
export async function watchForUpdate(onUpdate) {
  let loaded = null;
  try { loaded = await fingerprint(); } catch { /* 離線 */ }
  if (!loaded) return; // 伺服器沒給任何版本資訊：不提示
  let found = false;
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (!found) {
      try {
        const now = await fingerprint();
        found = !!now && now !== loaded;
      } catch {
        return; // 離線
      }
    }
    if (found) onUpdate();
  });
}
