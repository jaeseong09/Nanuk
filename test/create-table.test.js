import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function run(mode, schemaText = 'table sample {\n id auto\n}\n') {
  const cwd = mkdtempSync(join(tmpdir(), 'nanuk-cancel-'));
  try {
    writeFileSync(join(cwd, 'schema.nanuk'), schemaText);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/create-table-cancel.mjs', import.meta.url)), mode], {
      cwd, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_USER: 'test', DB_NAME: 'test', DB_PASSWORD: '' },
    });
    assert.ifError(result.error);
    const report = result.stdout.match(/TEST_CALLS:(.*)/);
    assert.ok(report, result.stderr || result.stdout);
    const calls = JSON.parse(report[1]);
    assert.ok(calls.close > 0);
    if (calls.connect) assert.equal(calls.end, 1);
    return { ...result, calls, output: result.stdout + result.stderr };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('SQL 시작 뒤 취소와 오류가 겹치면 미생성을 단정하지 않는다', () => {
  const r = run('query-error');
  assert.equal(r.status, 130);
  assert.equal(r.calls.query, 1);
  assert.doesNotMatch(r.output, /테이블을 생성하지 않았습니다/);
  assert.match(r.output, /생성 여부를 확인할 수 없습니다/);
});

test('연결 대기 중 취소하면 연결이 완료되어도 SQL을 실행하지 않는다', () => {
  const r = run('connect');
  assert.equal(r.status, 130);
  assert.equal(r.calls.query, 0);
  assert.match(r.output, /다음 SQL 실행 전에 취소했습니다/);
});

for (const [mode, status] of [['question', 130], ['no', 0]]) {
  test(`${mode}: 질문에서 취소하면 DB에 접속하지 않는다`, () => {
    const r = run(mode);
    assert.equal(r.status, status);
    assert.equal(r.calls.connect, 0);
    assert.match(r.output, /취소/);
  });
}

for (const [mode, status] of [['success', 0], ['query-success', 130]]) {
  test(`${mode}: 쿼리 성공 응답을 받으면 실제 성공을 안내한다`, () => {
    const r = run(mode);
    assert.equal(r.status, status);
    assert.equal(r.calls.query, 1);
    assert.match(r.output, /테이블을 모두 생성했습니다/);
    assert.doesNotMatch(r.output, /생성 여부를 확인할 수 없습니다|테이블을 생성하지 않았습니다/);
  });
}

test('취소 없는 DB 오류는 실패로 안내한다', () => {
  const r = run('error');
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.output, /테이블을 모두 생성했습니다|테이블 생성을 취소했습니다/);
});


// 테이블마다 auto가 있어도 각 테이블 안에서 독립적으로 검사해야 한다.
const usersSchema = 'table users {\n id auto\n}\n';
const postsSchema = 'table posts {\n id auto\n}\n';
const tagsSchema = 'table tags {\n id auto\n}\n';
const threeTables = usersSchema + postsSchema + tagsSchema;
const usersSql = 'CREATE TABLE `users` (\n`id` INT AUTO_INCREMENT PRIMARY KEY\n);';
const postsSql = 'CREATE TABLE `posts` (\n`id` INT AUTO_INCREMENT PRIMARY KEY\n);';
const tagsSql = 'CREATE TABLE `tags` (\n`id` INT AUTO_INCREMENT PRIMARY KEY\n);';

test('여러 테이블의 SQL을 순서대로 한 번씩 실행하고 모두 성공했다고 안내한다', () => {
  const r = run('success', threeTables);
  assert.equal(r.status, 0);
  assert.equal(r.calls.question, 1);
  assert.deepEqual(r.calls.sqls, [usersSql, postsSql, tagsSql]);
  assert.match(r.output, /테이블을 모두 생성했습니다/);
  assert.equal(r.stderr, '');
});

test('두 번째 생성이 실패하면 성공 개수와 원인을 알리고 세 번째는 실행하지 않는다', () => {
  const r = run('second-error', threeTables);
  assert.equal(r.status, 1);
  assert.deepEqual(r.calls.sqls, [usersSql, postsSql]);
  assert.match(r.stderr, /테이블 1개가 생성됐습니다/);
  assert.match(r.stderr, /이미 존재합니다/);
  assert.doesNotMatch(r.output, /테이블을 모두 생성했습니다/);
});

test('첫 번째 생성이 실패하면 성공 개수를 출력하거나 다음 테이블을 실행하지 않는다', () => {
  const r = run('error', threeTables);
  assert.equal(r.status, 1);
  assert.deepEqual(r.calls.sqls, [usersSql]);
  assert.doesNotMatch(r.output, /개가 생성됐습니다|테이블을 모두 생성했습니다/);
});

test('첫 SQL 성공 후 취소하면 성공 개수를 알리고 다음 SQL 전에 멈춘다', () => {
  const r = run('query-success', threeTables);
  assert.equal(r.status, 130);
  assert.deepEqual(r.calls.sqls, [usersSql]);
  assert.match(r.stderr, /테이블 1개가 생성됐습니다/);
  assert.match(r.stdout, /다음 SQL 실행 전에 취소했습니다/);
  assert.doesNotMatch(r.output, /생성 여부를 확인할 수 없습니다|테이블을 모두 생성했습니다/);
});

test('두 번째 SQL 실행 중 취소와 오류가 겹치면 확인된 성공과 불확실한 결과를 안내한다', () => {
  const r = run('second-query-error', threeTables);
  assert.equal(r.status, 130);
  assert.deepEqual(r.calls.sqls, [usersSql, postsSql]);
  assert.match(r.stderr, /테이블 1개가 생성됐습니다/);
  assert.match(r.stderr, /생성 여부를 확인할 수 없습니다/);
  assert.doesNotMatch(r.output, /테이블을 모두 생성했습니다|테이블을 생성하지 않았습니다/);
});

test('중복 테이블이 있으면 질문이나 DB 접속 전에 실패한다', () => {
  const r = run('success', usersSchema + usersSchema);
  assert.equal(r.status, 1);
  assert.equal(r.calls.question, 0);
  assert.equal(r.calls.connect, 0);
  assert.deepEqual(r.calls.sqls, []);
  assert.match(r.stderr, /4번째 줄: 중복된 테이블 이름입니다: users/);
  assert.doesNotMatch(r.stdout, /CREATE TABLE|테이블을 모두 생성했습니다/);
});
