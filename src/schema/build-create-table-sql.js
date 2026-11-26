import mysql from "mysql2/promise";

// ============================================================
// 5. SQL 생성 — 컬럼 정의와 외래키 정의를 CREATE TABLE로 조합
// 문자열만 만들며 DB에는 접속하지 않는다. 외래키 삭제 규칙은 RESTRICT로 고정한다.
// ============================================================
export function buildCreateTableSql(tableName, columns) {
  // escapeId는 이름을 SQL 식별자로 감싼다. 이름의 유효성 검사 자체는 아니다.
  // 두 번째 인수 true는 점도 구분자가 아닌 이름의 일부로 처리한다.
  const escapedTableName = mysql.escapeId(tableName, true);

  // --- 컬럼 정의 만들기 ---
  // 검증한 컬럼 객체를 SQL 조각으로 변환한다. 이름만 escapeId로 감싼다.
  // auto 기본키는 SQL에서 NULL을 허용하지 않는다.
  const columnSqls = columns.map((col) => {
    const escapedName = mysql.escapeId(col.name, true);
    if (col.type === "auto") {
      return `${escapedName} INT AUTO_INCREMENT PRIMARY KEY`;
    }
    if (col.notNull) {
      return `${escapedName} ${col.type} NOT NULL`;
    }

    return `${escapedName} ${col.type}`;
  });

  // --- 외래키 정의 만들기 ---
  // 참조 정보가 있는 컬럼만 골라 FOREIGN KEY 문장으로 변환한다.
  const foreignKeyColumns = columns.filter((col) => col.reference);

  const foreignKeySqls = foreignKeyColumns.map((col) => {
    const escapedColumnName = mysql.escapeId(col.name, true);
    const escapedRefTableName = mysql.escapeId(
      col.reference.refTableName,
      true,
    );
    const escapedRefColumnName = mysql.escapeId(
      col.reference.refColumnName,
      true,
    );

    // 자식 행이 남아 있으면 부모 행 삭제를 막는다. CASCADE 옵션은 아직 없다.
    return `FOREIGN KEY (${escapedColumnName}) REFERENCES ${escapedRefTableName} (${escapedRefColumnName}) ON DELETE RESTRICT`;
  });

  // --- 컬럼과 외래키를 한 배열로 합치기 ---
  // 외래키가 없어도 빈 배열이 펼쳐지므로 불필요한 쉼표가 붙지 않는다.
  const tableDefinitions = [...columnSqls, ...foreignKeySqls];

  // 각 컬럼·외래키 정의 사이에 쉼표와 줄바꿈을 넣어 문장을 완성한다.
  const sql = `CREATE TABLE ${escapedTableName} (
${tableDefinitions.join(",\n")}
);`;

  // 완성한 SQL 문자열을 호출한 곳으로 반환한다. 출력은 main에서 담당한다.
  return sql;
}
