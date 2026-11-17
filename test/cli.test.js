import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// test()는 테스트 이름과 실제 확인할 코드를 묶는다.
test("--help를 입력하면 도움말을 출력하고 성공으로 종료한다", () => {
  // 1. 실행: 터미널에서 `node cli.js --help`를 입력하는 것과 같다.
  // process.execPath는 현재 Node 실행 파일 경로다.
  const result = spawnSync(process.execPath, ["cli.js", "--help"], {
    // 명령을 어디서 실행하든, 테스트 파일의 상위 폴더(Nanuk)에서 CLI를 실행한다.
    cwd: new URL("../", import.meta.url),
    encoding: "utf8", // stdout과 stderr를 문자열로 받는다.
    timeout: 5000, // 문제가 생겨도 테스트가 끝없이 기다리지 않게 한다.
  });

  // 2. 확인: 프로세스 실행 자체에서 문제가 발생하지 않았는지 검사한다.
  assert.ifError(result.error);

  // 3. 확인: status는 종료 코드다. 정상 종료라면 0이어야 한다.
  assert.equal(result.status, 0);

  // 4. 확인: stdout은 프로그램이 출력한 일반 메시지다.
  // includes()는 해당 글자가 들어 있으면 true를 반환한다.
  assert.equal(result.stdout.includes("사용법:"), true);
  assert.equal(result.stdout.includes("nanuk doctor"), true);
});

test("지원하지 않는 명령어면 실패로 종료한다", () => {
  const result = spawnSync(process.execPath, ["cli.js", "hello"], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8", // stdout과 stderr를 문자열로 받는다.
    timeout: 5000, // 문제가 생겨도 테스트가 끝없이 기다리지 않게 한다.
  });

  assert.ifError(result.error);

  assert.equal(result.status, 1);

  assert.equal(
    result.stderr.includes("지원하지 않는 명령어입니다: hello"),
    true,
  );
});
