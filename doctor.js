// .env를 먼저 읽어 아래 코드에서 process.env로 접속 정보를 꺼낼 수 있게 한다.
import dotenv from "dotenv";
// Promise 버전을 사용하면 연결과 쿼리 완료를 await로 기다릴 수 있다.
import mysql from "mysql2/promise";
import { existsSync } from "node:fs";

export default async function checkDatabase() {
  dotenv.config({ quiet: true });
  // finally에서도 접근할 수 있도록 try 밖에서 선언한다. 접속 전에는 undefined다.
  let connection;

  const requiredKeys = ["DB_HOST", "DB_PORT", "DB_USER", "DB_NAME"];

  // 값이 없으면 앞 조건에서 멈추므로 undefined에 trim()을 호출하지 않는다.
  // 값이 있으면 trim()으로 공백만 있는 문자열도 누락으로 판단한다.
  const missingKeys = requiredKeys.filter((key) => {
    if (!process.env[key] || !process.env[key].trim()) {
      return true;
    }
  });

  if (!existsSync(process.cwd() + "/.env")) {
    console.log(
      "현재 폴더에 .env 파일이 없습니다.\n터미널에 설정된 환경변수로 검사를 계속합니다.",
    );
  }

  // 필수 설정이 없으면 DB에 접속하기 전에 안내하고 함수를 끝낸다.
  // exitCode = 1은 실패로 종료하도록 표시하고, return은 이 함수 실행을 끝낸다.
  if (missingKeys.length > 0) {
    const missingNames = missingKeys.join(", ");
    console.error(
      `필수 설정이 빠져 있습니다: ${missingNames}\n.env 또는 터미널 환경변수에 값을 설정해 주세요.`,
    );
    process.exitCode = 1;
    return;
  }

  // 누락 검사를 통과한 포트 문자열을 숫자로 변환한다.
  const port = Number(process.env.DB_PORT);

  // Number("abc")는 NaN이 된다. isInteger는 NaN과 소수를 모두 거른다.
  if (!Number.isInteger(port)) {
    console.error(
      "DB_PORT는 정수여야 합니다. 문자나 소수 없이 입력해 주세요. 예: 3306",
    );
    process.exitCode = 1;
    return;
  }

  // 접속 대상 포트는 1~65535 범위여야 한다. ||는 두 조건 중 하나라도 참이라는 뜻이다.
  if (port < 1 || port > 65535) {
    console.error(
      "DB_PORT는 1~65535 사이여야 합니다. MySQL 접속 포트를 확인해 주세요.",
    );
    process.exitCode = 1;
    return;
  }

  // 비밀번호가 없는 계정도 있으므로 DB_PASSWORD의 빈 문자열은 누락 오류로 막지 않는다.
  try {
    // doctor는 한 번 검사하고 끝나므로 pool 대신 연결 하나를 만든다.
    // await 중 실패하면 아래 성공 로그로 진행하지 않고 catch로 이동한다.
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });

    // 특정 테이블 없이 쿼리 실행이 가능한지 확인한다. 성공한 뒤에만 성공 로그를 찍는다.
    await connection.query("SELECT 1");
    console.log("DB 연결 성공");
  } catch (err) {
    // 바로 강제 종료하지 않고, finally에서 연결을 정리한 뒤 실패 코드로 종료하게 한다.
    process.exitCode = 1;

    // 오류 코드로 안내를 고른다. 같은 오류에도 원인이 여러 개일 수 있어 단정하지 않는다.

    if (err.code === "ER_ACCESS_DENIED_ERROR") {
      if (err.message.includes("using password: NO")) {
        console.error(
          "비밀번호 없이 접속을 시도했지만 인증에 실패했습니다. DB_PASSWORD 설정을 확인해 주세요.",
        );
      } else {
        console.error(
          "MySQL 인증에 실패했습니다. DB_USER·DB_PASSWORD와 계정의 접속 허용 설정을 확인해 주세요.",
        );
      }
    } else if (err.code === "ER_BAD_DB_ERROR") {
      console.error(
        "지정한 데이터베이스를 찾을 수 없습니다. DB_NAME이 맞는지, 해당 DB를 생성했는지 확인해 주세요.",
      );
    } else if (err.code === "ECONNREFUSED") {
      console.error(
        "MySQL 연결이 거부되었습니다.\nMySQL 서버가 실행 중인지, DB_HOST와 DB_PORT가 맞는지 확인해 주세요.\nDocker를 사용한다면 컨테이너 상태와 포트 연결도 확인해 주세요.",
      );
      if (process.env.DB_HOST === "localhost") {
        console.error("DB_HOST를 127.0.0.1로 바꿔 다시 시도해 주세요.");
      }
    } else if (err.code === "ETIMEDOUT") {
      console.error(
        "MySQL 연결 응답을 기다리다 시간이 초과됐습니다.\nDB_HOST·DB_PORT와 네트워크·방화벽 설정을 확인해 주세요.",
      );
    } else if (err.code === "PROTOCOL_CONNECTION_LOST") {
      console.error(
        "MySQL 연결이 도중에 끊겼습니다. 서버 상태를 확인해 주세요. 방금 MySQL을 재시작했다면 잠시 후 다시 시도해 주세요.",
      );
    } else {
      // 아직 개별 안내를 만들지 않은 오류도 진단할 수 있도록 코드를 남긴다.
      console.error("DB 연결 실패", err.code);
    }
  } finally {
    // try의 성공·실패와 관계없이 실행된다. 접속 자체가 실패하면 connection은 없으므로 건너뛴다.
    if (connection) {
      // 열린 연결을 남기지 않도록 종료가 끝날 때까지 기다린다.
      await connection.end();
    }
  }
}
