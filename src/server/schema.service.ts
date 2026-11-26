import { Injectable } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { parseSchema } from "../schema/parse-schema.js";

@Injectable()
export class SchemaService {
  private tables: NonNullable<ReturnType<typeof parseSchema>> = [];
  async onModuleInit() {
    let schemaText: string;

    try {
      // preview와 동일하게 명령을 실행한 폴더에서 스키마 파일을 읽는다.
      schemaText = await readFile(process.cwd() + "/schema.nanuk", "utf8");
    } catch (err) {
      // TypeScript에서는 오류의 형태를 확인한 뒤 code에 접근한다.
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        console.error(
          "현재 폴더에 schema.nanuk 파일이 없습니다. 파일을 만든 뒤 다시 실행해 주세요.",
        );
      } else {
        console.error(
          "스키마 파일을 읽지 못했습니다.",
          err instanceof Error ? err.message : "알 수 없는 오류",
        );
      }
      // 초기화 실패를 main.ts로 전달해 앱을 정리하고 실패로 종료하게 한다.
      throw err;
    }

    // preview와 같은 파서를 사용해 테이블·컬럼·외래키 규칙을 검사한다.
    const tables = parseSchema(schemaText);
    if (!tables) {
      // CLI의 return과 달리, Nest에서는 실패를 전달해야 서버 시작이 중단된다.
      throw new Error("스키마 검사에 실패했습니다. 위 오류를 확인해 주세요.");
    }
    // 다음 단계에서 검증된 tables를 보관하고 요청한 테이블을 찾는 데 사용한다.
    this.tables = tables;
  }

  findTable(tableName: string) {
    const table = this.tables.find((table) => {
      return table.tableName === tableName;
    });
    return table;
  }
}
