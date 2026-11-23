import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 실제 CLI를 임시 스키마로 실행하여 오류의 종료 코드와 출력까지 확인한다.
function preview(schemaText) {
  const cwd = mkdtempSync(join(tmpdir(), "nanuk-preview-"));
  try {
    writeFileSync(join(cwd, "schema.nanuk"), schemaText);
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("../cli.js", import.meta.url)), "preview",
    ], { cwd, encoding: "utf8", timeout: 5000 });
    assert.ifError(result.error);
    return result;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

const users = "table users {\n id auto\n name varchar(20) NOT NULL\n}\n";
const posts = "table posts {\n id auto\n content text\n}\n";
const usersSql = "CREATE TABLE `users` (\n`id` INT AUTO_INCREMENT PRIMARY KEY,\n`name` varchar(20) NOT NULL\n);";
const postsSql = "CREATE TABLE `posts` (\n`id` INT AUTO_INCREMENT PRIMARY KEY,\n`content` text\n);";

test("단일 테이블 미리보기가 기존 SQL을 출력한다", () => {
  const result = preview(users);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, usersSql + "\n");
  assert.equal(result.stderr, "");
});

test("여러 테이블을 파일 순서대로 출력하고 컬럼 중복 검사는 테이블마다 적용한다", () => {
  const result = preview(users + "\n" + posts);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, usersSql + "\n" + postsSql + "\n");
  assert.equal(result.stderr, "");
});

const invalidSchemas = [
  { name: "빈 파일", text: "", message: /파일이 비어있습니다/ },
  { name: "공백만 있는 파일", text: " \n\t\n", message: /파일이 비어있습니다/ },
  {
    name: "중복 테이블의 원본 줄 번호",
    text: users + "\n" + users,
    message: /6번째 줄: 중복된 테이블 이름입니다: users/,
  },
  {
    name: "두 번째 테이블의 닫는 괄호 누락",
    text: users + "\ntable posts {\n id auto\n",
    message: /6번째 줄에서 시작한 테이블에 닫는 괄호/,
  },
  {
    name: "두 번째 테이블의 잘못된 타입",
    text: users + "\n" + posts.replace("content text", "content wrong"),
    message: /8번째 줄: 지원하지 않는 자료형/,
  },
  {
    name: "컬럼이 없는 테이블",
    text: "table users {\n}\n",
    message: /컬럼을 하나 이상/,
  },
  {
    name: "테이블 내부에 다른 테이블 선언",
    text: "table users {\n id auto\ntable posts {\n id auto\n}\n",
    message: /3번째 줄:/,
  },
];

for (const { name, text, message } of invalidSchemas) {
  test(`${name}이면 오류를 안내하고 SQL을 출력하지 않는다`, () => {
    const result = preview(text);
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
    assert.equal(result.stdout, "");
  });
}
