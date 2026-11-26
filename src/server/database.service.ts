import { Injectable } from "@nestjs/common";
import { createPool, escapeId } from "mysql2/promise";
import type { Pool } from "mysql2/promise";

@Injectable()
export class DatabaseService {
  private readonly pool: Pool;

  constructor() {
    const requiredKeys = ["DB_HOST", "DB_PORT", "DB_USER", "DB_NAME"];

    // 값이 없거나 공백만 있으면 누락으로 판단한다. 비밀번호는 필수 값이 아니다.
    const missingKeys = requiredKeys.filter((key) => {
      return !process.env[key] || !process.env[key].trim();
    });

    // 풀을 만들기 전에 중단한다. 생성자에서는 return 대신 오류를 던진다.
    if (missingKeys.length > 0) {
      const missingNames = missingKeys.join(", ");
      throw new Error(
        `DB 접속 설정이 누락되었습니다: ${missingNames}. .env 파일이나 환경변수를 확인해 주세요.`,
      );
    }

    // 누락 검사를 통과한 값을 숫자로 바꾸고 MySQL 접속 포트 범위를 확인한다.
    const port = Number(process.env.DB_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("DB_PORT는 1~65535 사이의 정수여야 합니다. 예: 3306");
    }

    this.pool = createPool({
      host: process.env.DB_HOST,
      port,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });
  }

  async onModuleInit() {
    try {
      await this.pool.query("SELECT 1");
      console.log("DB 연결 성공");
    } catch (err) {
      console.error(
        "DB 연결에 실패했습니다. MySQL 실행 상태와 접속 설정을 확인해 주세요.",
      );
      throw err;
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
    console.log("\nDB 연결 풀 종료 완료");
  }

  // 호출하는 Service에서 스키마에 등록된 테이블인지 먼저 확인한다.
  async getRows(tableName: string) {
    // 점이 포함돼도 DB명.테이블명으로 나누지 않고 하나의 이름으로 처리한다.
    const escapedTableName = escapeId(tableName, true);
    const [rows] = await this.pool.query(`SELECT * FROM ${escapedTableName}`);
    return rows;
  }

  async getPosts() {
    const posts = await this.pool.query(`SELECT * FROM posts`);
    const [result] = posts;
    return result;
  }

  async createRow(tableName: string, data: Record<string, unknown>) {
    const columnNames = Object.keys(data);

    // 스키마 SQL 생성 때처럼 테이블·컬럼 이름을 각각 하나의 식별자로 감싼다.
    const escapedTableName = escapeId(tableName, true);
    const escapedColumnNames = columnNames.map((columnName) => {
      return escapeId(columnName, true);
    });

    const values = columnNames.map((columnName) => {
      return data[columnName];
    });

    const placeholders = columnNames
      .map(() => {
        return "?";
      })
      .join(",");

    const sql = `INSERT INTO ${escapedTableName} (${escapedColumnNames.join(", ")}) VALUES (${placeholders})`;

    const [result] = await this.pool.query(sql, values);

    return result;
  }
}
