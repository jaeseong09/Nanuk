import {
  existsSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
} from "node:fs";

import { parse } from "dotenv";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import password from "@inquirer/password";

// 비밀번호를 변형하지 않고, dotenv가 원래 값으로 읽을 수 있는 표기를 찾는다.
function encodePassword(password) {
  // 이 입력 기능은 한 줄짜리 비밀번호를 대상으로 한다.
  if (/[\r\n]/.test(password)) return undefined;

  // 작은따옴표, 백틱, 큰따옴표 순으로 시도한다.
  // 값 안에 포함된 따옴표는 감싸는 기호로 사용하지 않는다.
  for (const quote of ["'", "`", '"']) {
    if (password.includes(quote)) continue;

    const candidate = quote + password + quote;
    // 큰따옴표 안의 역슬래시 등도 해석될 수 있으므로 실제 파싱 결과로 검증한다.
    if (parse("DB_PASSWORD=" + candidate).DB_PASSWORD === password) {
      return candidate;
    }
  }

  // 정확히 보존할 방법을 찾지 못했으면 호출한 쪽에서 파일 생성을 중단한다.
  return undefined;
}

export default async function init() {
  const gitignoreContent = `.env\n`;

  console.log("초기 설정을 시작합니다.");

  // 1. 비밀번호가 들어갈 .env를 Git 제외 목록에 등록한다.
  if (!existsSync(process.cwd() + "/.gitignore")) {
    try {
      writeFileSync(process.cwd() + "/.gitignore", gitignoreContent, {
        encoding: "utf8",
        flag: "wx",
      });
      console.log(".gitignore를 생성하고 .env 제외 규칙을 추가했습니다.");
    } catch (err) {
      process.exitCode = 1;
      console.error(".gitignore 파일을 생성하지 못했습니다", err.code);
      return;
    }
  } else {
    try {
      const gitignorePath = process.cwd() + "/.gitignore";
      const content = readFileSync(gitignorePath, "utf8");

      // 줄 단위로 비교해야 .env.example이나 주석을 .env 규칙으로 착각하지 않는다.
      // /\r?\n/은 Windows와 macOS의 줄바꿈을 모두 나눈다.
      const lines = content.split(/\r?\n/);
      const hasEnvRule = lines.some((line) => line.trim() === ".env");

      if (!hasEnvRule) {
        // 기존 파일의 줄바꿈 방식을 따르고, 마지막 줄에 규칙이 붙지 않게 한다.
        const newline = content.includes("\r\n") ? "\r\n" : "\n";
        const separator =
          content.length > 0 && !content.endsWith("\n") ? newline : "";
        appendFileSync(gitignorePath, separator + ".env" + newline, "utf8");
        console.log("기존 .gitignore에 .env 제외 규칙을 추가했습니다.");
      }
    } catch (err) {
      process.exitCode = 1;
      console.error(".gitignore 파일을 읽거나 수정하지 못했습니다", err.code);
      return;
    }
  }

  // 2. 기존 설정은 덮어쓰지 않고 질문 전에 종료한다.
  if (existsSync(process.cwd() + "/.env")) {
    console.log(
      ".env가 이미 있어 기존 설정을 유지합니다.\n설정을 확인하려면 nanuk doctor를 실행해 주세요.",
    );
    return;
  }

  // 3. 일반 접속 정보를 입력받는다. 비밀번호는 별도 도구로 질문한다.
  const rl = readline.createInterface({ input, output });
  const controller = new AbortController();
  let cancelled = false;

  // 질문이 끝난 뒤 .env를 만들 때도 사용할 값이다.
  let dbHost;
  let dbPort;
  let dbUser;
  let dbName;

  // Ctrl+C → 대기 중인 question 취소 → 아래 catch에서 안내한다.
  rl.on("SIGINT", () => {
    cancelled = true;
    process.exitCode = 130;
    controller.abort();
  });

  try {
    const hostAnswer = await rl.question(
      "MySQL 주소를 입력해 주세요 (기본값: 127.0.0.1):",
      { signal: controller.signal },
    );

    dbHost = hostAnswer.trim() || "127.0.0.1";

    const portAnswer = await rl.question(
      "PORT 번호를 입력해주세요 (기본값: 3306):",
      { signal: controller.signal },
    );

    dbPort = Number(portAnswer.trim() || 3306);

    // Number("abc")는 NaN이 된다. isInteger는 NaN과 소수를 모두 거른다.
    if (!Number.isInteger(dbPort)) {
      console.error(
        "PORT는 정수여야 합니다. 문자나 소수 없이 입력해 주세요. 예: 3306",
      );
      process.exitCode = 1;
      return;
    }

    if (dbPort < 1 || dbPort > 65535) {
      console.error("포트는 1~65535 사이의 정수로 입력해 주세요. 예: 3306");
      process.exitCode = 1;
      return;
    }

    const userAnswer = await rl.question("MySQL 사용자 이름을 입력해 주세요:", {
      signal: controller.signal,
    });

    dbUser = userAnswer.trim();

    if (!dbUser) {
      console.error(
        "MySQL 사용자 이름이 비어 있습니다.\n접속할 계정 이름을 입력해 주세요. 예: root",
      );
      process.exitCode = 1;
      return;
    }

    const nameAnswer = await rl.question(
      "사용할 데이터베이스 이름을 입력해 주세요. 예: board_db:",
      { signal: controller.signal },
    );

    dbName = nameAnswer.trim();

    if (!dbName) {
      console.error(
        "MySQL 데이터베이스 이름이 비어 있습니다.\n접속할 데이터베이스 이름을 입력해 주세요. 예: board_db",
      );
      process.exitCode = 1;
      return;
    }

  } catch (err) {
    if (cancelled) {
      console.log("초기 설정을 취소했습니다. .env 파일은 생성하지 않았습니다.");
      return;
    }
    console.error("DB 접속 정보 입력 중 오류가 발생했습니다.");
    process.exitCode = 1;
    return;
  } finally {
    // 정상 입력·검증 실패·취소 모두 여기서 닫는다. try/catch에서 return해도 실행된다.
    // 다음 비밀번호 질문과 readline이 동시에 입력을 받지 않도록 한다.
    rl.close();
  }

  // 4. 비밀번호는 화면에 숨겨 입력받고, 공백도 원본 그대로 보존한다.
  let dbPassword;

  try {
    dbPassword = await password({
      message: "MySQL 비밀번호를 입력해 주세요 (없으면 엔터):",
      mask: false,
    });
  } catch (err) {
    process.exitCode = 1;
    if (err.name === "ExitPromptError") {
      console.log("초기 설정을 취소했습니다. .env 파일은 생성하지 않았습니다.");
      process.exitCode = 130;
      return;
    }
    console.error("비밀번호 입력 중 오류가 발생했습니다");
    return;
  }

  // 5. 특수문자를 포함한 비밀번호가 .env에서 동일하게 읽히는지 검사한다.
  const passwordForEnv = encodePassword(dbPassword);
  if (passwordForEnv === undefined) {
    console.error(
      "이 비밀번호의 문자 조합은 현재 .env 저장 방식으로 정확히 보존할 수 없습니다. 파일을 생성하지 않았습니다.",
    );
    process.exitCode = 1;
    return;
  }

  const envContent = `DB_HOST=${dbHost}
DB_PORT=${dbPort}
DB_USER=${dbUser}
DB_PASSWORD=${passwordForEnv}
DB_NAME=${dbName}
`;

  // 파일에 쓰기 직전에도 전체 설정을 다시 읽어 비밀번호가 그대로인지 확인한다.
  if (parse(envContent).DB_PASSWORD !== dbPassword) {
    console.error(
      "비밀번호 저장 검증에 실패했습니다. .env 파일을 생성하지 않았습니다.",
    );
    process.exitCode = 1;
    return;
  }

  // 6. 모든 입력이 유효할 때만 저장한다. wx는 기존 파일 덮어쓰기를 막는다.
  try {
    writeFileSync(process.cwd() + "/.env", envContent, {
      encoding: "utf8",
      flag: "wx",
    });
    console.log(
      ".env 파일을 생성했습니다.\nDB_USER, DB_PASSWORD, DB_NAME을 확인하고 nanuk doctor를 실행해 주세요.",
    );
  } catch (err) {
    process.exitCode = 1;
    console.error(".env 파일을 생성하지 못했습니다", err.code);
  }
}
