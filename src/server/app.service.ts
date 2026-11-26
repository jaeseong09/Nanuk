import { SchemaService } from "./schema.service.js";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "./database.service.js";

@Injectable()
export class AppService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly schemaService: SchemaService,
  ) {}

  getHello() {
    return "Nanuk 서버 실행 중";
  }

  getPosts() {
    return this.databaseService.getPosts();
  }

  getRows(tableName: string) {
    const table = this.schemaService.findTable(tableName);
    if (!table) {
      throw new NotFoundException(
        `스키마에 등록되지 않은 테이블입니다: ${tableName}`,
      );
    }
    return this.databaseService.getRows(table.tableName);
  }

  createRow(tableName: string, data: Record<string, unknown>) {
    // 목록 조회와 동일하게 스키마에 등록된 테이블인지 먼저 확인한다.
    const table = this.schemaService.findTable(tableName);
    if (!table) {
      throw new NotFoundException(
        `스키마에 등록되지 않은 테이블입니다: ${tableName}`,
      );
    }

    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new BadRequestException(
        `요청 본문은 JSON 객체여야 합니다. 예: {"name":"홍길동"}`,
      );
    }

    const inputColumnNames = Object.keys(data);

    for (const columnName of inputColumnNames) {
      const schemaColumn = table.columns.find(
        (column) => columnName === column.name,
      );
      if (!schemaColumn) {
        throw new BadRequestException(
          `스키마에 등록되지 않은 컬럼입니다: ${columnName}`,
        );
      }
      if (schemaColumn.type === "auto") {
        throw new BadRequestException(
          `자동 생성 컬럼에는 값을 입력할 수 없습니다: ${columnName}`,
        );
      }

      const value = data[columnName];

      if (value === null) {
        continue;
      }

      if (schemaColumn.type === "int") {
        if (!(typeof value === "number" && Number.isInteger(value))) {
          throw new BadRequestException(
            `정수를 입력해야 하는 컬럼입니다: ${columnName}`,
          );
        }
      }

      if (
        schemaColumn.type === "text" ||
        schemaColumn.type.startsWith("varchar(")
      ) {
        if (typeof value !== "string") {
          throw new BadRequestException(
            `문자열을 입력해야 하는 컬럼입니다: ${columnName}`,
          );
        }

        if (schemaColumn.type.startsWith("varchar(")) {
          const maxLength = Number(schemaColumn.type.slice(8, -1));

          if ([...value].length > maxLength) {
            throw new BadRequestException(
              `${columnName} 컬럼은 최대 ${maxLength}자까지 입력할 수 있습니다.`,
            );
          }
        }
      }
    }

    for (const schemaColumn of table.columns) {
      if (schemaColumn.notNull && schemaColumn.type !== "auto") {
        if (
          typeof data[schemaColumn.name] === "undefined" ||
          data[schemaColumn.name] === null
        ) {
          throw new BadRequestException(
            `필수 컬럼 값이 없습니다: ${schemaColumn.name}`,
          );
        }
      }
    }
    return this.databaseService.createRow(table.tableName, data);
  }
}
