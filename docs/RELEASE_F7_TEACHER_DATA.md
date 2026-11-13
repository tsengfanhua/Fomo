# F7 — 原始教師資料整合

## 完成內容

1. 將 `advisors_extracted_all_609.json` 原始資料納入 `data/seed/`，並保留 630 筆原始紀錄。
2. 將 1,209 種 ESCO URI 對應到標籤檔；將來源 URI、標籤、映射方法與競賽成果證據保留在教師 profile。
3. 只採用精確 ESCO URI 或完整技能標籤／括號限定名稱映射到 FomoThon Skill ID；不採用模糊子字串匹配。
4. 將 630 位來源教師併入共用 `people.json` 與 SQLite `users`，並保留原本 10 位去識別化展示教師作為 course seed 關聯 fixture。
5. 正式搜尋預設排除展示教師（`FOMO_INCLUDE_SYNTHETIC_TEACHERS=0`），只搜尋原始教師資料。
6. Teacher Agent 可呈現未知意願教師的專長探索候選，但 `valid=false`、`canInvite=false`、`quota=null`；安全閘門不允許送出邀請。
7. SQLite `user_version` 升至 3；既有資料庫啟動時自動匯入 630 筆，採 `INSERT OR IGNORE` 並包在交易內，不需重置資料庫。
8. 新增匯入、資料品質、正式教師搜尋與舊資料庫遷移測試。

## 實際資料盤點

| 指標 | 數量 |
|---|---:|
| 原始教師紀錄 | 630 |
| 唯一教師 ID | 630 |
| 原始專長 URI 引用 | 2,896 |
| ESCO URI 精確對應 | 48 |
| 完整標籤／括號限定名稱對應 | 42 |
| 尚未映射 URI | 2,806 |
| 至少有一項內部技能對應的教師 | 73 |
| 含競賽／成果證據的教師 | 59 |
| 系所缺漏 | 630 |
| 指導意願未知 | 630 |
| 指導名額未知 | 630 |

「競賽／成果證據」不等於「指導競賽隊伍」；資料仍以原始證據呈現，未推算隊數或可指導名額。

## 驗收

- `npm run dq`：99.1/100，資料品質閘門通過。
- `node --test test/agents.test.js test/dq.test.js test/review2.test.js test/mcp.test.js`：60 tests passed，0 failed。
- `npm run verify` 已完整通過：109 項測試（106 通過、3 略過）、離線 Agent 評測 27/27、資料品質 99.1/100、匿名檢查 0 命中。另以正式教師模式啟動 HTTP 服務並檢查 `/healthz`，SQLite 建庫含 640 筆教師（630 原始＋10 展示 fixture），`user_version=3`。瀏覽器 E2E、真實 LLM 與 Azure staging migration 仍待雲端環境驗收。

## 部署與資料治理注意事項

- 來源含可識別教師姓名，部署前應確認資料提供單位授權、告知與用途範圍。
- 不可將 `availability=unknown` 當作願意指導；須由教師本人確認意願與名額後才開放邀請。
- 若已部署 F6 且 SQLite 有持久化資料，部署 F7 後會自動跑 v3 migration；請先備份持久化資料卷。
- `FOMO_INCLUDE_SYNTHETIC_TEACHERS=1` 僅用於本機 demo／測試；正式部署維持 `0`。
