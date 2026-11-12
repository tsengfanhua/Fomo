"""以唯讀方式查詢共用 ESCO 技能目錄。"""

import sqlite3
from contextlib import closing
from pathlib import Path


class EscoRepository:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)

    def _connect(self):
        conn = sqlite3.connect(f"{self.db_path.resolve().as_uri()}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        return conn

    def get(self, concept_uri: str) -> dict | None:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT concept_uri, preferred_label, description FROM esco_skills WHERE concept_uri = ?", (concept_uri,)).fetchone()
            return dict(row) if row else None

    def search(self, query: str, limit: int = 20) -> list[dict]:
        if not query.strip() or not isinstance(limit, int) or limit < 1:
            raise ValueError("搜尋文字不可為空，limit 必須為正整數")
        # 跳脫萬用字元，將輸入視為一般文字。
        pattern = "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        with closing(self._connect()) as conn:
            rows = conn.execute("""SELECT concept_uri, preferred_label, description FROM esco_skills
                WHERE preferred_label LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
                ORDER BY preferred_label, concept_uri LIMIT ?""", (pattern, pattern, limit)).fetchall()
            return [dict(row) for row in rows]
