import { readFile } from "node:fs/promises";
import { parseSchema } from "../schema/parse-schema.js";
import { buildCreateTableSql } from "../schema/build-create-table-sql.js";

// ============================================================
// 읽는 순서: main → parseSchema → parseTableBlock → parseColumn → parseColumnOptions
// 검사 실패: exitCode = 1 설정 후 값을 생략한 return으로 종료(undefined). 호출한 쪽도 중단한다.
//

// ============================================================
// 6. preview 실행 — 파일 읽기 → 해석·검사 → SQL 생성 → 출력
// ============================================================
export default async function main() {
  // 명령을 실행한 현재 폴더의 스키마 파일을 문자열로 읽는다.
  try {
    const schemaText = await readFile(process.cwd() + "/schema.nanuk", "utf8");

    const tables = parseSchema(schemaText);
    // 해석에 실패하면 parseSchema가 undefined를 반환하므로 여기서 멈춘다.
    if (!tables) {
      return;
    }

    for (const table of tables) {
      // 검증 결과로 SQL을 만든 뒤 미리보기만 출력한다. DB에서 실행하지 않는다.
      const sql = buildCreateTableSql(table.tableName, table.columns);
      console.log(sql);
    }
  } catch (err) {
    process.exitCode = 1;
    if (err.code === "ENOENT") {
      console.error(
        "현재 폴더에 schema.nanuk 파일이 없습니다. 파일을 만든 뒤 다시 실행해 주세요.",
      );
    } else {
      console.error("스키마 처리 중 오류가 발생했습니다.", err.message);
    }
  }
}
