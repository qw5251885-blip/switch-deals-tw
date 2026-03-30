# SWITCH 特賣報 — 部署說明

## 🗂 專案結構

```
switch-deals-tw/
├── public/
│   └── index.html      ← 前端網站
├── api/
│   └── sales.js        ← Vercel Proxy（幫你繞過 CORS）
├── vercel.json         ← Vercel 設定
├── package.json
└── README.md
```

## 🚀 部署步驟（完全免費）

### 第一步：把檔案上傳到 GitHub

1. 登入 [github.com](https://github.com)
2. 點右上角 **「+」→「New repository」**
3. Repository name 輸入：`switch-deals-tw`
4. 選 **Public**，其他不用動，按 **「Create repository」**
5. 畫面會出現一些指令，先不管，往下看

### 第二步：安裝 GitHub Desktop（最簡單的方式）

1. 去 [desktop.github.com](https://desktop.github.com) 下載 **GitHub Desktop**
2. 安裝後用你的 GitHub 帳號登入
3. 點 **「Clone a repository」→「URL」**
4. 輸入你剛建立的 repo 網址（例如：`https://github.com/你的帳號/switch-deals-tw`）
5. 選一個儲存位置，按 **「Clone」**

### 第三步：複製專案檔案

把這個 `switch-deals-tw` 資料夾裡的所有檔案，複製到剛才 Clone 的資料夾裡。

### 第四步：上傳到 GitHub

1. 打開 GitHub Desktop
2. 左邊會看到所有檔案變更
3. 左下角 Summary 輸入：`初次上傳`
4. 按 **「Commit to main」**
5. 再按右上角 **「Push origin」**

### 第五步：部署到 Vercel

1. 去 [vercel.com](https://vercel.com) 
2. 點 **「Sign up」→「Continue with GitHub」**（直接用 GitHub 帳號登入）
3. 登入後點 **「Add New Project」**
4. 找到 `switch-deals-tw`，點 **「Import」**
5. 設定頁面什麼都不用改，直接按 **「Deploy」**
6. 等大約 30 秒，看到 🎉 就完成了！

### 第六步：你的網站上線了！

Vercel 會給你一個網址，像是：
```
https://switch-deals-tw.vercel.app
```

這個網址就是你的網站，全世界都可以看到。

---

## 🔄 之後怎麼更新網站？

1. 修改 `public/index.html` 或其他檔案
2. 打開 GitHub Desktop
3. 輸入說明 → Commit → Push
4. Vercel 會自動重新部署（約 30 秒）

## ❓ 常見問題

**Q: 為什麼需要 Proxy？**
A: Nintendo eShop API 不允許網頁直接存取（CORS 限制），所以需要透過 Vercel 的伺服器來轉發。

**Q: 資料多久更新一次？**
A: 每次有人開啟網站就會即時抓取。Vercel 有快取設定（1小時），所以同一時段不會重複呼叫 API。

**Q: 會被 Nintendo 封鎖嗎？**
A: 這個 API 端點是公開的，許多第三方網站都在使用，目前沒有封鎖問題。
