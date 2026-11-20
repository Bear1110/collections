# 部署

純靜態檔案（沒有 build），任何靜態主機都能放。用過兩種：

| | GitHub Pages | Cloudflare Workers ＋ Access |
| --- | --- | --- |
| 用在 | finance-watcher、headack | color-picker |
| repo | **公開**（免費方案的 Pages 要公開 repo） | 可以 **private** |
| 誰打得開網站 | 任何知道網址的人 | 只有名單上的 email（收一次性驗證碼登入） |
| 費用 | 免費 | 免費（Access 50 人以內免費） |
| 適合 | 程式碼不怕公開、工具本身可以給別人用 | 不想讓人知道有這個工具、程式碼不想公開 |

兩種都一樣：**資料不在網站上**（在使用者的瀏覽器和他自己的 Google 試算表），網站只放程式碼。
所以要保護的是**程式碼不要夾帶真實資料**（見最下面「真實資料不進 git」）。

## 共通設定（template 已經做好）

- `index.html`：`<meta name="robots" content="noindex, nofollow">`（不要被搜尋引擎收錄；公開工具就拿掉）、CSP。
- `_headers`（Cloudflare 會讀；GitHub Pages 不支援，靠 meta 標籤）：`X-Robots-Tag: noindex`、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`。
- `manifest.webmanifest`＋`icons/`：手機「加到主畫面」。manifest 的 `<link>` 有 `crossorigin="use-credentials"`（在 Access 後面時讀 manifest 也要帶登入）。
- `js/update.js`：部署新版後，開著的舊分頁回到前景時會出現「網站有新版本 → 重新整理」。
- 部署完要把正式網址加進 GCP OAuth 的「已授權的 JavaScript 來源」（見 [cloud-sync.md](cloud-sync.md)）。

## A. GitHub Pages

1. repo → Settings → Pages → Source：**Deploy from a branch**，Branch：`main`，資料夾 `/ (root)`。
2. 等一兩分鐘，網址是 `https://<帳號>.github.io/<repo>/`。
3. GCP 授權來源填 `https://<帳號>.github.io`（不含 repo 路徑、不含結尾斜線）。
4. （選用）`.github/workflows/test.yml` 每次 push 跑 `node --test`（公開 repo 的 Actions 免費）：

```yaml
name: Tests
on: { push: { branches: [main] }, pull_request: {} }
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 22 }
      - run: node --test
```

公開 repo 的注意事項：README 要不要寫、寫什麼自己決定；**不想被找到就不要放 README 和說明文字**（color-picker 的做法：說明放 `NOTES.md`，gitignore 只留本機）。

## B. Cloudflare Workers（靜態網站）＋ Access

### 1. 部署

1. [Cloudflare dashboard](https://dash.cloudflare.com/) → Workers & Pages → Create → **Import a repository** → 授權 GitHub、選 repo（private 也可以）。
2. 設定：Build command **留空**、Deploy command 用預設 `npx wrangler deploy`。沒有 `wrangler` 設定檔時 Cloudflare 會當成靜態網站部署整個資料夾。
3. 部署成功後如果看到「No URLs enabled」：該 Worker → Settings → Domains & Routes → 把 **workers.dev** 打開。網址是 `https://<名稱>.<帳號>.workers.dev`。
4. 同一頁把 **Preview URLs 關掉**（不然每個 commit 都有一個不受 Access 保護的預覽網址）。
5. 之後 push 到 main 就自動部署。

### 2. Access（只讓名單上的人打開）

1. dashboard → Zero Trust（第一次要選免費方案、填一個團隊名稱；免費方案也會要求綁付款方式，不會扣款）。
2. Access → Applications → Add an application → **Self-hosted**：
   - Application domain：你的 `<名稱>.<帳號>.workers.dev`
   - Session duration：預設 24 小時（登入一次多久要重驗）；自己用可以拉長到 1 個月
3. Policy：Action **Allow**，Include → **Emails** → 填允許的 email（一行一個）。
4. Login methods：**One-time PIN**（輸入 email → 收驗證碼）。不在名單的 email 收不到驗證碼。
5. 用無痕視窗打開網址測試：應該先出現 Cloudflare 的登入畫面。

### 3. Google 登入

GCP 授權來源加 `https://<名稱>.<帳號>.workers.dev`。Access 和 Google 登入互不影響：Access 擋「誰能打開網站」，Google 決定「資料存在誰的試算表」。

## 真實資料不進 git

- `.gitignore` 已擋：`REALDATA/`、`*-backup*.json`、`*.csv`、`*.xlsx`。真實資料一律放 `REALDATA/`。
- 測試、範例、提示詞、註解只用**假資料**（假公司名、假價格、假批號）。
- **每次 commit 前掃一次**：

```sh
git diff --cached --name-only            # 有沒有不該進去的檔案
git diff --cached | grep -nE "<真實公司名>|<真實客戶名>|<電話>|<統編>|<銀行帳號>"   # 把真實的關鍵字列在本機的清單裡
```

  color-picker 的做法：本機留一份「不能出現的字」清單（在 `REALDATA/` 裡，不進 git），commit 前用它掃 diff。
- 已經 push 的機密：改掉不夠（git 歷史還在）。private repo 可以重寫歷史；公開 repo 視同已外洩。
