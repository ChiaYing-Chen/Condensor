# 遠端伺服器部署指南 (Condensor)

此指南說明如何將 Condensor 專案部署至 Windows Server (IIS) 並連線至遠端 PostgreSQL。

## 系統架構簡介
- **Node.js 後端 (Express)**: 運行於本機 `http://localhost:3004`，負責處理 API 與密碼防護邏輯。
- **Frontend (Vite + React)**: 專案經過預先打包 (`npm run build`)，靜態檔放置於 `dist/` 資料夾，交由 Node.js 後端統一 Serve。
- **資料庫 (PostgreSQL)**: 連接至遠端伺服器 IP `10.122.51.61` 上的 `Condensor` 資料庫。
- **網站代理 (IIS)**: 作為對外窗口，攔截 Port 80/443 的要求並轉發 (Reverse Proxy) 至 3004。

---

## 部署前準備

### 1. 確認伺服器連線
確保部署電腦能 ping 通資料庫主機 `10.122.51.61`，且遠端 PostgreSQL 有開放 `5432` 埠給部署電腦的 IP 訪問。

### 2. Node.js 安裝
於部署電腦安裝 Node.js (v18+)

### 3. IIS 模組檢查
打開 IIS Manager 確保有以下模組：
- URL Rewrite 2.1
- Application Request Routing (ARR) (並且在 Server Proxy Settings 打開 "Enable proxy")

---

## 步驟一：專案檔案準備與傳輸

1. 在開發環境（您的本機）中，執行打包指令建置前端資源：
```powershell
npm run build
```
（確保產生了 `dist` 目錄）

2. 將以下資料夾與檔案複製至伺服器的實體網頁目錄 (例如 `C:\inetpub\wwwroot\Condensor`)：
   - `dist/`
   - `.env`
   - `package.json`
   - `server.js`
   - `web.config`

3. 在伺服器上開啟 PowerShell 切換至該目錄，並安裝後端依賴：
```powershell
cd C:\inetpub\wwwroot\Condensor
npm install --production
```

---

## 步驟二：註冊 Node.js 為常駐服務

使用 PM2 將後端設定為電腦開機自動啟動。

```powershell
# 如果伺服器還沒有裝 PM2
npm install -g pm2
npm install -g pm2-windows-service

# 啟動 Condensor
cd C:\inetpub\wwwroot\Condensor
pm2 start server.js --name "Condensor-Backend"

# 儲存目前 PM2 列表與安裝服務
pm2 save
pm2-service-install
```

---

## 步驟三：設定 IIS 網站

1. 打開 **IIS Manager**。
2. 點擊 `Sites` -> `Add Website`。
3. 命名為 `Condensor`。
4. Physical path 指定到剛剛的資料夾 (e.g. `C:\inetpub\wwwroot\Condensor`)。
5. 綁定您要的 Port (如 80)。
6. 點選建立好的網站，進入 **Application Pools**（應用程式集區）。
   - 將該站台的集區 .NET CLR version 改為 `No Managed Code`。

因為目錄下已有準備好的 `web.config`，IIS 啟動後就會自動把所有請求轉發給 `localhost:3004` 的 Node.js 服務了。

---

## 常見問題

- **上傳被拒絕且沒有密碼視窗**：請檢查 `.env` 中的 `OVERWRITE_PASSWORD` 是否與系統預設 (`W521`) 一致。
- **圖形顯示異常或年份未匯入**：前端有針對 `111` 這類民國年進行 `+1911` 處理，請確保原始 Excel/CSV 表頭有 `年份` 字眼。
- **502 Bad Gateway**：代表 Node.js 後端 (3004) 沒有啟動，請打開命令列輸入 `pm2 status` 確認 `Condensor-Backend` 的運行狀態。
