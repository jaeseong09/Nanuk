import dotenv from "dotenv";
import mysql from "mysql2/promise";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export default async function main() {
  dotenv.config({ quiet: true });

  let connection;

  // 접속 정보가 부족하면 SQL 미리보기와 확인 질문 전에 종료한다.
  // DB_NAME은 아래에서 별도로 검사하고, 빈 비밀번호는 허용한다.
  const requiredKeys = ["DB_HOST", "DB_PORT", "DB_USER"];
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

  const dbName = process.env.DB_NAME;

  if (!dbName || !dbName.trim()) {
    console.error("DB_NAME이 비어 있습니다. 생성할 DB 이름을 입력해 주세요.");
    process.exitCode = 1;
    return;
  }

  // [^...]는 허용 목록 밖의 문자를 찾는다. 공백과 줄바꿈도 거부한다.
  if (/[^a-zA-Z0-9_]/.test(dbName)) {
    console.error(
      "DB_NAME에는 영문, 숫자, 밑줄(_)만 사용할 수 있습니다. 예: board_db",
    );
    process.exitCode = 1;
    return;
  }

  if (dbName.length > 64) {
    console.error("DB_NAME은 64자 이하여야 합니다.");
    process.exitCode = 1;
    return;
  }

  console.log("생성할 DB: " + dbName);

  const sql = `CREATE DATABASE ${mysql.escapeId(dbName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;

  console.log(sql);

  const rl = readline.createInterface({ input, output });
  const controller = new AbortController();
  let cancelled = false;

  rl.on("SIGINT", () => {
    cancelled = true;
    process.exitCode = 130;
    controller.abort();
  });

  try {
    const answer = await rl.question("이 DB를 생성할까요? (y/N):", {
      signal: controller.signal,
    });
    const choice = answer.trim().toLowerCase();

    if (choice !== "y") {
      console.log("DB 생성을 취소했습니다");
      return;
    }
  } catch (err) {
    if (cancelled) {
      console.log("DB 생성을 취소했습니다. DB를 생성하지 않았습니다.");
      return;
    }
    console.error("DB 생성 확인 입력 중 오류가 발생했습니다.");
    process.exitCode = 1;
    return;
  } finally {
    rl.close();
  }

  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });

    await connection.query(sql);
    console.log("DB를 생성했습니다: " + dbName);
  } catch (err) {
    process.exitCode = 1;
    if (err.code === "ER_DB_CREATE_EXISTS") {
      console.error("이미 존재하는 데이터베이스입니다: " + dbName);
      return;
    } else if (err.code === "ER_DBACCESS_DENIED_ERROR") {
      console.error(
        "이 데이터베이스를 생성할 권한이 없습니다. DB_USER 계정에 해당 DB의 CREATE 권한이 있는지 확인해 주세요.",
      );
      return;
    } else if (err.code === "ER_ACCESS_DENIED_ERROR") {
      console.error(
        "MySQL 인증에 실패했습니다. DB_USER·DB_PASSWORD와 계정의 접속 허용 설정을 확인해 주세요.",
      );
      return;
    } else if (err.code === "ECONNREFUSED") {
      console.error(
        "MySQL 연결이 거부되었습니다. 서버가 실행 중인지, DB_HOST와 DB_PORT가 맞는지 확인해 주세요.",
      );
      return;
    } else if (err.code === "ETIMEDOUT") {
      console.error(
        "MySQL 연결 응답을 기다리다 시간이 초과됐습니다.\nDB_HOST·DB_PORT와 네트워크·방화벽 설정을 확인해 주세요.",
      );
      return;
    } else {
      console.error(err.code);
      return;
    }
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}
