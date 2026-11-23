import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { readFile } from "node:fs/promises";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { parseSchema, buildCreateTableSql } from "./read-schema.js";

export default async function main() {
  dotenv.config({ quiet: true });

  // 접속 정보가 부족하면 SQL 미리보기와 확인 질문 전에 종료한다.
  // 기존 DB 안에 테이블을 만들므로 DB_NAME도 필수다. 빈 비밀번호는 허용한다.
  const requiredKeys = ["DB_HOST", "DB_PORT", "DB_USER", "DB_NAME"];
  const missingKeys = requiredKeys.filter((key) => {
    return !process.env[key] || !process.env[key].trim();
  });

  if (missingKeys.length > 0) {
    console.error(
      `필수 설정이 빠져 있습니다: ${missingKeys.join(", ")}\n.env 또는 터미널 환경변수에 값을 설정해 주세요.`,
    );
    process.exitCode = 1;
    return;
  }

  // 검증한 숫자를 실제 연결에도 그대로 사용한다.
  const port = Number(process.env.DB_PORT);
  if (!Number.isInteger(port)) {
    console.error(
      "DB_PORT는 정수여야 합니다. 문자나 소수 없이 입력해 주세요. 예: 3306",
    );
    process.exitCode = 1;
    return;
  }

  if (port < 1 || port > 65535) {
    console.error(
      "DB_PORT는 1~65535 사이여야 합니다. MySQL 접속 포트를 확인해 주세요.",
    );
    process.exitCode = 1;
    return;
  }

  const rl = readline.createInterface({ input, output });

  const controller = new AbortController();
  let cancelled = false;

  rl.on("SIGINT", () => {
    cancelled = true;
    process.exitCode = 130;
    controller.abort();
  });

  let connection;
  let queryStarted = false;
  let createdCount = 0;

  try {
    const schemaText = await readFile(process.cwd() + "/schema.nanuk", "utf8");

    const tables = parseSchema(schemaText);
    // 해석에 실패하면 parseSchema가 undefined를 반환하므로 여기서 멈춘다.
    if (!tables) {
      return;
    }

    // 생성할 SQL을 먼저 보여주고, y로 동의한 경우에만 DB에서 실행한다.
    const sqls = tables.map((table) => {
      return buildCreateTableSql(table.tableName, table.columns);
    });
    console.log(sqls.join("\n\n"));

    const answer = await rl.question("이 테이블을 생성할까요? (y/N):", {
      signal: controller.signal,
    });
    const choice = answer.trim().toLowerCase();

    if (choice !== "y") {
      console.log("테이블 생성을 취소했습니다.");
      return;
    } else {
      console.log("생성 동의를 확인했습니다.");
    }

    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });

    for (const sql of sqls) {
      // 연결을 기다리는 동안 취소했다면 SQL을 보내지 않는다.
      controller.signal.throwIfAborted();
      // SQL을 보낸 뒤에는 취소 요청만으로 생성 여부를 단정할 수 없다.
      queryStarted = true;

      await connection.query(sql);

      queryStarted = false;

      createdCount++;
    }
    console.log("테이블을 모두 생성했습니다.");
  } catch (err) {
    if (createdCount > 0) {
      console.error(
        `오류 또는 취소 전에 테이블 ${createdCount}개가 생성됐습니다.`,
      );
    }

    if (cancelled) {
      if (queryStarted) {
        console.error(
          "SQL 실행 후 취소 요청이 있었지만 생성 여부를 확인할 수 없습니다. 다시 실행하기 전에 DB에서 테이블을 확인해 주세요.",
        );
      } else {
        console.log("다음 SQL 실행 전에 취소했습니다.");
      }
      process.exitCode = 130;
      return;
    }
    process.exitCode = 1;
    if (err.code === "ENOENT") {
      console.error(
        "현재 폴더에 schema.nanuk 파일이 없습니다. 파일을 만든 뒤 다시 실행해 주세요.",
      );
    } else if (err.code === "ER_TABLE_EXISTS_ERROR") {
      console.error(
        "같은 이름의 테이블이 이미 존재합니다. 기존 테이블을 사용하거나 스키마의 테이블 이름을 변경해 주세요.",
      );
    } else if (err.code === "ER_BAD_DB_ERROR") {
      console.error(
        "지정한 데이터베이스가 없습니다. DB_NAME을 확인해 주세요. 새 DB가 필요하면 nanuk create-db로 먼저 생성해 주세요.",
      );
    } else if (err.code === "ER_ACCESS_DENIED_ERROR") {
      console.error(
        "MySQL 인증에 실패했습니다. DB_USER·DB_PASSWORD와 계정의 접속 허용 설정을 확인해 주세요.",
      );
    } else if (err.code === "ER_TABLEACCESS_DENIED_ERROR") {
      console.error(
        "테이블을 생성할 권한이 없습니다. DB_USER 계정에 대상 DB 또는 테이블의 CREATE 권한이 있는지 확인해 주세요.",
      );
    } else if (err.code === "ECONNREFUSED") {
      console.error(
        "MySQL 연결이 거부되었습니다. 서버가 실행 중인지, DB_HOST와 DB_PORT가 맞는지 확인해 주세요.",
      );
    } else if (err.code === "ETIMEDOUT") {
      console.error(
        "MySQL 연결 응답을 기다리다 시간이 초과됐습니다. DB_HOST·DB_PORT와 네트워크·방화벽 설정을 확인해 주세요.",
      );
    } else {
      console.error("스키마 처리 중 오류가 발생했습니다.", err.message);
    }
  } finally {
    rl.close();
    if (connection) {
      await connection.end();
    }
  }
}
