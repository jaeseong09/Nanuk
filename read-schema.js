import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";

// ============================================================
// 1. 스키마 해석·검사 — 문자열을 받아 { tableName, columns } 반환
// ============================================================
export function parseSchema(schemaText) {
  // --- 줄 정리와 테이블 선언 검사 ---
  // 앞뒤 공백과 빈 줄을 제거한다. 배열 인덱스는 원본 줄 번호와 다를 수 있다.
  const rawLines = schemaText.split("\n");

  const sourceLines = rawLines
    .map((line, idx) => {
      return {
        text: line.trim(),
        lineNumber: idx + 1,
      };
    })
    .filter((line) => line.text !== "");

  const lines = sourceLines.map((line) => line.text);

  // 파일이 비어 있지 않은지, 첫 줄이 table 이름 { 형식인지 검사한다.
  // exitCode = 1은 실패를 표시하고, return은 parseSchema를 종료한다.
  // main은 반환값이 없으면 SQL을 만들지 않고 종료한다.
  const firstLine = lines[0];

  if (!firstLine) {
    console.error("파일이 비어있습니다.");
    process.exitCode = 1;
    return;
  }

  const headerLineNumber = sourceLines[0].lineNumber;

  // 연속된 공백과 탭을 구분자로 사용해 첫 줄을 세 부분으로 나눈다.
  const headerParts = firstLine.split(/\s+/);

  if (headerParts.length !== 3) {
    console.error(
      `${headerLineNumber}번째 줄: 테이블 이름을 포함해 table 이름 { 형식으로 작성해 주세요.`,
    );
    process.exitCode = 1;
    return;
  }

  if (headerParts[0] !== "table" || headerParts[2] !== "{") {
    console.error(
      `${headerLineNumber}번째 줄: table 테이블이름 { 형식이어야 합니다.\n예: table posts {`,
    );
    process.exitCode = 1;
    return;
  }

  // 마지막 줄은 닫는 괄호만 있어야 한다. 그래야 컬럼 줄을 실수로 버리지 않는다.
  const lastLine = lines[lines.length - 1];

  if (lastLine !== "}") {
    console.error(
      `${sourceLines[sourceLines.length - 1].lineNumber}번째 줄: 마지막 내용 줄에는 }만 작성해 주세요.`,
    );
    process.exitCode = 1;
    return;
  }

  // --- 테이블 이름 검사 ---
  // SQL용 백틱을 붙이기 전의 원래 이름을 검사한다.
  const tableName = headerParts[1];

  if (tableName.length === 0 || tableName.length > 64) {
    console.error(
      `${headerLineNumber}번째 줄: 테이블 이름은 1~64자여야 합니다.`,
    );
    process.exitCode = 1;
    return;
  }

  if (tableName.includes("\0")) {
    console.error(
      `${headerLineNumber}번째 줄: 테이블 이름에는 NUL 문자를 사용할 수 없습니다.`,
    );
    process.exitCode = 1;
    return;
  }

  // for...of는 문자를 하나씩 꺼낸다.
  // codePointAt(0)으로 문자 번호를 확인해 BMP 밖의 문자를 거부한다.
  for (const char of tableName) {
    if (char.codePointAt(0) > 0xffff) {
      console.error(
        `${headerLineNumber}번째 줄: 테이블 이름에 MySQL이 지원하지 않는 유니코드 문자가 있습니다.`,
      );
      process.exitCode = 1;
      return;
    }
  }

  // --- 컬럼 검사 준비 ---
  // 첫 줄과 마지막 줄을 제외한 나머지를 컬럼 정의로 읽는다.
  const columnLines = sourceLines.slice(1, -1);

  if (columnLines.length === 0) {
    console.error("컬럼을 하나 이상 작성해 주세요. 예: id auto");
    process.exitCode = 1;
    return;
  }

  // 검사를 통과한 컬럼 객체를 모아 나중에 SQL 문자열로 변환한다.
  const columns = [];

  // 현재 지원하는 고정 자료형 목록이다. varchar(n)은 별도 정규식으로 검사한다.
  const simpleTypes = ["auto", "int", "text"];

  // 반복문 밖에 두어 이전 컬럼의 이름과 auto 사용 여부를 계속 기억한다.
  const columnNames = new Set();
  let hasAuto = false;

  // --- 컬럼별 문법·이름·자료형 검사 ---
  // for...of 안에서 return하면 parseSchema 전체가 종료된다.
  for (const line of columnLines) {
    const { text, lineNumber } = line;
    // 옵션과 필수 항목
    const parts = text.split(/\s+/);
    // 이름·자료형 뒤의 단어만 모으고 공백과 대소문자를 통일한다.
    const options = parts.slice(2).join(" ").toUpperCase();

    // 옵션 없음 또는 NOT NULL만 허용한다. 오타나 알 수 없는 옵션은 무시하지 않는다.
    if (options !== "" && options !== "NOT NULL") {
      console.error(
        `${lineNumber}번째 줄: 지원하지 않는 컬럼 옵션입니다. NOT NULL만 사용할 수 있습니다.`,
      );
      process.exitCode = 1;
      return;
    }

    // 앞의 두 단어가 컬럼 이름과 자료형이다. 둘 중 하나가 빠지면 중단한다.
    const [name, type] = parts;
    if (!name || !type) {
      console.error(
        `${lineNumber}번째 줄: 컬럼 이름과 자료형을 함께 작성해 주세요. 예: title varchar(100)`,
      );
      process.exitCode = 1;
      return;
    }

    // --- 컬럼 이름과 중복 검사 ---
    // 길이·금지 문자·이미 나온 이름인지 확인한다.
    if (name.length > 64) {
      console.error(`${lineNumber}번째 줄: 컬럼 이름은 64자 이하여야 합니다.`);
      process.exitCode = 1;
      return;
    }

    if (name.includes("\0")) {
      console.error(
        `${lineNumber}번째 줄: 컬럼 이름에는 NUL 문자를 사용할 수 없습니다`,
      );
      process.exitCode = 1;
      return;
    }

    // 비교용 이름만 소문자로 바꾼다. SQL에 사용할 원래 name은 유지한다.
    const nameKey = name.toLowerCase();

    if (columnNames.has(nameKey)) {
      console.error(`${lineNumber}번째 줄: 중복된 컬럼 이름입니다: ${name}`);
      process.exitCode = 1;
      return;
    }

    columnNames.add(nameKey);

    for (const char of name) {
      if (char.codePointAt(0) > 0xffff) {
        console.error(
          `${lineNumber}번째 줄: 컬럼 이름에 MySQL이 지원하지 않는 유니코드 문자가 있습니다.`,
        );
        process.exitCode = 1;
        return;
      }
    }

    // --- 자료형과 길이 검사 ---
    const isSimpleType = simpleTypes.includes(type);
    // 문자열 전체가 varchar(숫자)인지 검사한다.
    // 일치하면 [1]에 괄호 안 숫자가 문자열로 들어가고, 아니면 null이다.
    const varcharMatch = type.match(/^varchar\(([0-9]+)\)$/);
    // 고정 자료형도 아니고 varchar 형식도 아닐 때만 거부한다.
    if (!isSimpleType && !varcharMatch) {
      console.error(
        `${lineNumber}번째 줄: 지원하지 않는 자료형입니다. auto, int, text, varchar(n)을 사용해 주세요.`,
      );
      process.exitCode = 1;
      return;
    }

    // varchar일 때만 길이를 꺼낸다. 기본 범위 검사이며,
    // 실제 생성 가능한 최대 길이는 문자셋과 테이블 전체 행 크기에 따라 더 작아진다.
    if (varcharMatch) {
      const varcharLength = Number(varcharMatch[1]);
      if (varcharLength < 0 || varcharLength > 65535) {
        console.error(
          `${lineNumber}번째 줄: varchar 길이는 0~65535 범위여야 합니다.`,
        );
        process.exitCode = 1;
        return;
      }
    }

    // --- auto 중복 검사와 결과 저장 ---
    // auto는 자동 증가 기본키로 변환되므로 테이블당 하나만 허용한다.
    if (type === "auto" && hasAuto === true) {
      console.error(
        `${lineNumber}번째 줄: auto 컬럼은 테이블당 하나만 사용할 수 있습니다.`,
      );
      process.exitCode = 1;
      return;
    }

    // 첫 auto를 만났다는 사실을 저장해 다음 컬럼 검사에 사용한다.
    if (type === "auto" && hasAuto === false) {
      hasAuto = true;
    }

    // 이미 검증한 옵션을 불리언으로 저장한다.
    const notNull = options === "NOT NULL";
    columns.push({ name, type, notNull });
  }

  // 모든 검사를 통과한 경우에만 SQL 생성에 필요한 정보를 반환한다.
  return { tableName, columns };
}

// ============================================================
// 2. SQL 생성 — 검증된 정보로 문자열만 생성 (파일·DB 접근 없음)
// ============================================================
export function buildCreateTableSql(tableName, columns) {
  // escapeId는 이름을 SQL 식별자로 감싼다. 이름의 유효성 검사 자체는 아니다.
  // 두 번째 인수 true는 점도 구분자가 아닌 이름의 일부로 처리한다.
  const escapedTableName = mysql.escapeId(tableName, true);

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

  // 컬럼 사이에만 쉼표와 줄바꿈을 넣어 CREATE TABLE 문장을 완성한다.
  const sql = `CREATE TABLE ${escapedTableName} (
${columnSqls.join(",\n")}
);`;

  // 완성한 SQL 문자열을 호출한 곳으로 반환한다. 출력은 main에서 담당한다.
  return sql;
}

// ============================================================
// 3. 실행 흐름 — 파일 읽기 → 해석·검사 → SQL 생성 → 출력
// ============================================================
export default async function main() {
  // 명령을 실행한 현재 폴더의 스키마 파일을 문자열로 읽는다.
  try {
    const schemaText = await readFile(process.cwd() + "/schema.nanuk", "utf8");

    const schema = parseSchema(schemaText);
    // 해석에 실패하면 parseSchema가 undefined를 반환하므로 여기서 멈춘다.
    if (!schema) {
      return;
    }

    // 검증 결과로 SQL을 만든 뒤 미리보기만 출력한다. DB에서 실행하지 않는다.
    const sql = buildCreateTableSql(schema.tableName, schema.columns);
    console.log(sql);
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
