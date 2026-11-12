# Course Agent

Course Agent 將已確認的修課資料對應課綱，透過 LLM 與 ESCO 技能目錄產生可追溯的技能及課程證據。正式對外介面是 MCP stdio Tool **`analyze_student_courses`**。

流程：成績單／修課資料 → 人工確認 → 課程匹配 → LLM 選擇 ESCO 技能 → Skill Profile、課程證據與 Trace。MCP 接收已確認的修課 JSON，不直接解析上傳成績單。結果不是技能分數或熟練度，也不管理學生身分或媒合。

在 repository 根目錄完成環境與資料庫初始化後，從 `course-agent` 啟動：

```powershell
..\.venv\Scripts\python.exe -m app.mcp_server --course-db data/processed/course_index.sqlite --esco-db ../data/shared/esco_skills.sqlite --model <模型名稱>
```

隔離 Mock 示範（不呼叫付費 API）：

```powershell
..\.venv\Scripts\python.exe -m scripts.mcp_client_demo
```

五位學生的 JSON、XLSX、PDF 示範資料位於 [data/demo/synthetic_transcripts](data/demo/synthetic_transcripts/)；課程識別資料為真實資料，成績及學分為合成資料。

- [整合指南](docs/integration_guide.md)：環境、資料庫、MCP 契約與呼叫。
- [展示簡報](docs/demo_brief.md)：Demo、驗收結果與限制。
- [Legacy 相容說明](docs/legacy.md)：舊 HTTP API 非正式整合介面，暫時保留供既有呼叫端使用。
