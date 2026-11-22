import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function run(mode) {
  const cwd = mkdtempSync(join(tmpdir(), 'nanuk-cancel-'));
  try {
    writeFileSync(join(cwd, 'schema.nanuk'), 'table sample {\n id auto\n}\n');
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/create-table-cancel.mjs', import.meta.url)), mode], {
      cwd, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_USER: 'test', DB_NAME: 'test', DB_PASSWORD: '' },
    });
    assert.ifError(result.error);
    const calls = JSON.parse(result.stdout.match(/TEST_CALLS:(.*)/)[1]);
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
  assert.match(r.output, /테이블을 생성하지 않았습니다/);
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
    assert.match(r.output, /테이블을 생성했습니다:/);
    assert.doesNotMatch(r.output, /생성 여부를 확인할 수 없습니다|테이블을 생성하지 않았습니다/);
  });
}

test('취소 없는 DB 오류는 실패로 안내한다', () => {
  const r = run('error');
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.output, /테이블을 생성했습니다:|테이블 생성을 취소했습니다/);
});
