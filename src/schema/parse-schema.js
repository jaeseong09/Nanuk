// 1. 전체 스키마 — 테이블 블록을 나누고 tables 배열 반환
// ============================================================
export function parseSchema(schemaText) {
  // --- 원본 줄 번호를 유지하며 빈 줄 정리 ---
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

  if (sourceLines.length === 0) {
    console.error("파일이 비어있습니다.");
    process.exitCode = 1;
    return;
  }

  // --- 닫는 괄호를 기준으로 테이블 블록 나누기 ---
  const tableBlocks = [];

  let currentBlock = [];

  for (const line of sourceLines) {
    currentBlock.push(line);
    if (line.text === "}") {
      tableBlocks.push(currentBlock);
      currentBlock = [];
    }
  }

  if (currentBlock.length > 0) {
    console.error(
      `${currentBlock[0].lineNumber}번째 줄에서 시작한 테이블에 닫는 괄호 }가 없습니다.`,
    );
    process.exitCode = 1;
    return;
  }

  // --- 각 테이블 검사와 테이블 이름 중복 확인 ---
  const tables = [];
  const tableNames = new Set();

  for (const block of tableBlocks) {
    const table = parseTableBlock(block);
    if (!table) return;
    if (tableNames.has(table.tableName)) {
      console.error(
        `${block[0].lineNumber}번째 줄: 중복된 테이블 이름입니다: ${table.tableName}`,
      );
      process.exitCode = 1;
      return;
    }
    tableNames.add(table.tableName);
    tables.push(table);
  }

  // --- 외래키 관계 검사: 모든 테이블을 해석한 뒤 대상과 순서 확인 ---
  // DB를 조회하지 않고 이 스키마에 선언된 테이블·컬럼만 찾는다.
  for (const table of tables) {
    for (const column of table.columns) {
      if (!column.reference) {
        continue;
      }
      // --- 참조 대상 테이블·컬럼 존재 여부 ---
      // 이름은 스키마에 적힌 대소문자 그대로 비교한다.
      const referencedTable = tables.find(
        (candidate) => candidate.tableName === column.reference.refTableName,
      );

      if (!referencedTable) {
        console.error(
          `${table.tableName}.${column.name}: 참조할 테이블 '${column.reference.refTableName}'이 스키마에 없습니다.`,
        );
        process.exitCode = 1;
        return;
      }

      const referencedColumn = referencedTable.columns.find((candidate) => {
        return candidate.name === column.reference.refColumnName;
      });

      if (!referencedColumn) {
        console.error(
          `${table.tableName}.${column.name}: 참조할 컬럼 '${column.reference.refTableName}.${column.reference.refColumnName}'이 스키마에 없습니다.`,
        );
        process.exitCode = 1;
        return;
      }

      // --- 지원 범위: int 컬럼 → auto 기본키 ---
      // MySQL 전체 기능이 아니라 Nanuk의 현재 지원 범위다.
      if (referencedColumn.type !== "auto") {
        console.error(
          `${table.tableName}.${column.name}: 현재는 auto 기본키만 참조할 수 있습니다. 참조 대상: ${column.reference.refTableName}.${column.reference.refColumnName}`,
        );
        process.exitCode = 1;
        return;
      }

      if (column.type !== "int") {
        console.error(
          `${table.tableName}.${column.name}: 현재 외래키 컬럼은 int 자료형만 사용할 수 있습니다.`,
        );
        process.exitCode = 1;
        return;
      }

      // --- 생성 순서: 부모가 먼저, 자식이 나중 ---
      // 순서를 자동으로 바꾸지 않으며 자기 참조도 여기서 거부한다.
      const tableIndex = tables.indexOf(table);
      const referencedTableIndex = tables.indexOf(referencedTable);

      if (tableIndex <= referencedTableIndex) {
        console.error(
          `${table.tableName}.${column.name}: 현재는 앞에 선언된 테이블만 참조할 수 있습니다. '${referencedTable.tableName}'을 '${table.tableName}'보다 먼저 선언해 주세요.`,
        );
        process.exitCode = 1;
        return;
      }
    }
  }

  return tables;
}

// ============================================================
// 2. 컬럼 옵션 — NOT NULL과 ref를 해석해 { notNull, reference } 반환
// ============================================================
function parseColumnOptions(optionParts, lineNumber) {
  // --- ref 위치 찾기와 기본값 준비 ---
  // 키워드만 소문자로 비교하고, 참조할 테이블·컬럼 이름의 대소문자는 보존한다.
  const refIndex = optionParts.findIndex(
    (part) => part.toLowerCase() === "ref",
  );

  let reference = null;

  // --- 참조 문법 검사: ref 테이블명.컬럼명 ---
  // 여기서는 형식만 확인한다. 대상의 존재·타입·선언 순서는 parseSchema가 검사한다.
  if (refIndex !== -1) {
    const referenceTarget = optionParts[refIndex + 1];
    if (!referenceTarget) {
      console.error(
        `${lineNumber}번째 줄: ref 뒤에 참조할 테이블과 컬럼을 적어 주세요. 예: ref users.id`,
      );
      process.exitCode = 1;
      return;
    }
    const ref = referenceTarget.split(".");
    if (ref.length !== 2) {
      console.error(
        `${lineNumber}번째 줄: 참조 형식이 올바르지 않습니다. ref 테이블명.컬럼명 형태로 적어 주세요. 예: ref users.id`,
      );
      process.exitCode = 1;
      return;
    }
    const [refTableName, refColumnName] = ref;

    if (!refTableName || !refColumnName) {
      console.error(
        `${lineNumber}번째 줄: 참조 형식이 올바르지 않습니다. ref 테이블명.컬럼명 형태로 적어 주세요. 예: ref users.id`,
      );
      process.exitCode = 1;
      return;
    }

    if (refIndex + 2 !== optionParts.length) {
      console.error(
        `${lineNumber}번째 줄: ref 테이블명.컬럼명은 컬럼 정의의 마지막에 한 번만 적어 주세요.`,
      );
      process.exitCode = 1;
      return;
    }
    reference = { refTableName, refColumnName };
  }
  // --- ref 앞의 일반 옵션 검사 ---
  // ref가 있으면 앞부분만, 없으면 옵션 전체를 NOT NULL 검사에 사용한다.
  const options =
    refIndex !== -1
      ? optionParts.slice(0, refIndex).join(" ").toUpperCase()
      : optionParts.join(" ").toUpperCase();

  // 옵션 없음 또는 NOT NULL만 허용한다. 오타나 알 수 없는 옵션은 무시하지 않는다.
  if (options !== "" && options !== "NOT NULL") {
    console.error(
      `${lineNumber}번째 줄: 지원하지 않는 컬럼 옵션입니다. NOT NULL만 사용할 수 있습니다.`,
    );
    process.exitCode = 1;
    return;
  }
  // 이미 검증한 옵션을 불리언으로 저장한다.
  const notNull = options === "NOT NULL";
  return { notNull, reference };
}

// ============================================================
// 3. 컬럼 한 줄 — 이름·자료형·옵션 검사 후 컬럼 객체 반환
// ============================================================
function parseColumn(line) {
  // --- 단어 분리와 옵션 해석 ---
  const { text, lineNumber } = line;
  const parts = text.split(/\s+/);
  // 이름·자료형 뒤의 단어를 옵션 함수에 전달한다. 여기서는 대소문자를 바꾸지 않는다.
  const optionParts = parts.slice(2);

  const parsedOptions = parseColumnOptions(optionParts, lineNumber);
  if (!parsedOptions) {
    return;
  }
  const { notNull, reference } = parsedOptions;

  // 앞의 두 단어가 컬럼 이름과 자료형이다. 둘 중 하나가 빠지면 중단한다.
  const [name, type] = parts;
  if (!name || !type) {
    console.error(
      `${lineNumber}번째 줄: 컬럼 이름과 자료형을 함께 작성해 주세요. 예: title varchar(100)`,
    );
    process.exitCode = 1;
    return;
  }

  // --- 컬럼 이름의 길이·금지 문자 검사 ---
  // 다른 컬럼과의 중복 여부는 parseTableBlock에서 검사한다.
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
  // 현재 지원하는 고정 자료형 목록이다. varchar(n)은 별도 정규식으로 검사한다.
  const simpleTypes = ["auto", "int", "text"];

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
  // --- 검사한 컬럼 정보 반환 ---
  return { name, type, notNull, reference };
}

// ============================================================
// 4. 테이블 한 블록 — 선언·이름·컬럼 간 중복 검사 후 테이블 객체 반환
// ============================================================
function parseTableBlock(sourceLines) {
  // --- 테이블 선언과 닫는 괄호 검사 ---
  const lines = sourceLines.map((line) => line.text);

  // 빈 파일은 parseSchema에서 걸러졌다. 여기서는 table 이름 { 형식을 확인한다.
  const firstLine = lines[0];

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

  // 반복문 밖에 두어 이전 컬럼의 이름과 auto 사용 여부를 계속 기억한다.
  const columnNames = new Set();
  let hasAuto = false;

  // --- 컬럼 함수 호출과 컬럼 이름 중복 검사 ---
  // 컬럼 검사에 실패하면 이 테이블의 처리도 중단한다.
  for (const line of columnLines) {
    const parsedColumn = parseColumn(line);
    if (!parsedColumn) {
      return;
    }
    const { name, type, notNull, reference } = parsedColumn;
    const { lineNumber } = line;
    // 비교용 이름만 소문자로 바꾼다. SQL에 사용할 원래 name은 유지한다.
    const nameKey = name.toLowerCase();

    if (columnNames.has(nameKey)) {
      console.error(`${lineNumber}번째 줄: 중복된 컬럼 이름입니다: ${name}`);
      process.exitCode = 1;
      return;
    }

    columnNames.add(nameKey);

    // --- 테이블 안의 auto 중복 검사 ---
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

    // --- 검사를 통과한 컬럼 저장 ---
    columns.push({ name, type, notNull, reference });
  }

  // 모든 검사를 통과한 경우에만 SQL 생성에 필요한 정보를 반환한다.
  return { tableName, columns };
}
