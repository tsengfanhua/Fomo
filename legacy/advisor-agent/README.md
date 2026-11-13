# Competition-AI

## Skill Analysis Agent：MVP 初版已完成，待跨 Agent 整合

目前已完成成績單解析、SQLite 課程匹配、LLM 技能萃取、跨課程 Student Skill Profile 彙整、實驗性修課證據評分，以及 FastAPI `/api/v1/skills/parse`、`/api/v1/skills/analyze`。技能與證據仍待確認；評分不代表學生實際技能熟練度。

Skill Agent 的完整流程、API、啟動與限制見 [技術文件](docs/skill_agent.md)；其他 Agent 與 Orchestrator 的跨 Agent 整合尚待完成。

執行技能分析需設定 `OPENAI_API_KEY`、`SKILL_LLM_MODEL`，並可使用 `SKILL_DB_PATH` 指定課程資料庫。匹配成功的課程名稱、ID、學期及描述會送至外部 LLM；請先確認課程文字分享權限。Swagger 文件位於 `/docs`。

資料模型、技能分類、SQLite 初始化及待審查限制見 [Skill 資料契約草案](docs/skill_data_contract.md)。

### 環境與測試

使用 Python 虛擬環境並安裝 `requirements.txt`：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp .pytest_tmp
```

以完全虛構的五位學生及三個獨立異常案例產生成績單：

```powershell
.\.venv\Scripts\python.exe scripts/generate_synthetic_transcripts.py
```

PDF 產生器在 Windows 預設使用 `C:\Windows\Fonts\kaiu.ttf`，並將使用到的中文字嵌入 PDF。其他環境可設定 `FOMOTHON_FONT_PATH` 指向支援繁體中文的 TrueType 字型（`.ttf`）；該字型也供產生器的測試使用。

同一份合成紀錄輸出為 JSON、XLSX 及文字型 PDF，位於 `data/demo/synthetic_transcripts/`；`expected_enrollments.json` 包含五位學生及三個異常案例的預期解析結果。這些展示檔案只包含虛構學生、成績、課程代號與中文替代名稱，不含真實課號、校名、教師或課綱原文。公開前仍需進行重新識別風險及資料授權審查。

三個異常案例分別為缺少成績、未知課程與重複修課。解析器保留未知課程和重複紀錄供人工確認；分析階段會回報無匹配或重複課程狀態。XLSX 使用第一張工作表及標題列；PDF 目前只支援每列用 `|` 分欄的文字表格，不支援掃描文件、加密 PDF 或其他排版。結果需要人工確認，不能視為任意學校成績單均可辨識。

### 資料管理

唯一的真實課綱來源是 114-2 原始 Excel。供團隊審查的 `data/seed/courses.json` 包含 16 門課的原始課名及「課程描述」摘錄；負責人說明來源可公開取得，但原文仍可能被反查，分享權限及風險須在 PR 確認。課程與技能關聯均為待審狀態。原始 Excel 和 `data/private/source_map.json` 已排除於 Git；來源對照僅供本機追溯，勿放入 API、Trace 或 Log。展示成績單使用中文替代課名，與課程資料透過內部 `course_id` 關聯；它們不是真實課號或學校的正式課名。

測試資料只表示課程教授的內容，不證明學生實際能力。無法從其他學期推定課綱相同；也不得把真實成績單送到外部 LLM。

## Advisor Agent（MVP）

已新增 `GET /api/v1/advisors` 與 `POST /api/v1/advisors/match`，依教師研究專長（50%）、開授課程（25%）、競賽指導經驗（25%）進行證據導向排序；不評估學生修課關聯與教師指導量能。評分規則、API 範例與限制見 [Advisor Agent 文件](docs/advisor_agent.md)。目前使用 `data/seed/advisors_extracted_all_609.json` 的 630 筆教師資料；ESCO 技能與競賽紀錄已轉為 API 所需格式。資料缺漏以 missing 處理，不代表教師沒有相關經驗。正式使用前仍建議由系所確認資料正確性。

### MCP

安裝 `requirements.txt` 後，在 `advisor-agent` 目錄啟動 stdio MCP server：

```powershell
.\.venv\Scripts\python.exe -m app.mcp_server
```

可用工具為 `list_advisors` 與 `match_advisors`。可用 `ADVISOR_DATA_PATH` 或 `--data` 指定其他 `AdvisorProfile` JSON。
