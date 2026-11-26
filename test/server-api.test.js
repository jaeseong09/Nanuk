import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

// DB 대역은 저장 호출 여부만 기록한다. 스키마 파서·Service·Controller·HTTP는 실제 코드를 사용한다.
const projectDir = fileURLToPath(new URL('../', import.meta.url));

test('스키마 기반 GET·POST 입력 검사와 HTTP 응답', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'nanuk-server-api-'));
  const previousCwd = process.cwd();
  let app;
  t.after(async () => {
    try { if (app) await app.close(); }
    finally {
      process.chdir(previousCwd);
      await rm(temporary, { recursive: true, force: true });
    }
  });

  // 매 실행마다 현재 소스를 빌드하여 오래된 dist를 테스트하지 않는다.
  await writeFile(join(temporary, 'package.json'), '{"type":"module"}');
  await symlink(join(projectDir, 'node_modules'), join(temporary, 'node_modules'));
  const built = spawnSync(join(projectDir, 'node_modules/.bin/tsc'), [
    '--project', join(projectDir, 'tsconfig.json'), '--outDir', join(temporary, 'dist'),
  ], { cwd: projectDir, encoding: 'utf8', timeout: 30000 });
  assert.ifError(built.error);
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const load = (name) => import(pathToFileURL(join(temporary, 'dist/server', name)).href);
  const { AppController } = await load('app.controller.js');
  const { AppService } = await load('app.service.js');
  const { DatabaseService } = await load('database.service.js');
  const { SchemaService } = await load('schema.service.js');

  await writeFile(join(temporary, 'schema.nanuk'), `table users {
  id auto
  name varchar(3) NOT NULL
  age int
  bio text
}
table posts {
  id auto
  user_id int NOT NULL ref users.id
  title varchar(5) NOT NULL
  content text
}
`);
  process.chdir(temporary);
  const schema = new SchemaService();
  const calls = [];
  const database = {
    getRows: async (tableName) => { calls.push({ operation: 'read', tableName }); return [{ source: tableName }]; },
    createRow: async (tableName, data) => {
      calls.push({ operation: 'write', tableName, data });
      return { insertId: 42, affectedRows: 1 };
    },
  };
  class TestModule {}
  Module({ controllers: [AppController], providers: [AppService,
    { provide: SchemaService, useValue: schema },
    { provide: DatabaseService, useValue: database },
  ] })(TestModule);
  app = await NestFactory.create(TestModule, { logger: false, abortOnError: false });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  async function request(path, body, raw = false) {
    const response = await fetch(base + path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: raw ? body : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  for (const tableName of ['users', 'posts']) {
    await t.test(`GET /${tableName}: 스키마의 테이블을 조회한다`, async () => {
      const response = await request('/' + tableName);
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, [{ source: tableName }]);
      assert.equal(calls.at(-1).tableName, tableName);
    });
  }
  await t.test('GET 미등록 테이블은 DB 조회 전에 404', async () => {
    const count = calls.length;
    const response = await request('/missing');
    assert.equal(response.status, 404);
    assert.match(response.body.message, /스키마에 등록되지 않은 테이블/);
    assert.equal(calls.length, count);
  });

  const invalid = [
    ['미등록 테이블', '/missing', { name: '재성' }, 404, '스키마에 등록되지 않은 테이블'],
    ['미등록 컬럼', '/users', { name: '재성', nickname: '곰' }, 400, '스키마에 등록되지 않은 컬럼'],
    ['auto 값 직접 입력', '/users', { id: 1, name: '재성' }, 400, '자동 생성 컬럼'],
    ['auto에 null 입력', '/users', { id: null, name: '재성' }, 400, '자동 생성 컬럼'],
    ['필수 값 누락', '/users', {}, 400, '필수 컬럼 값이 없습니다'],
    ['필수 값 null', '/users', { name: null }, 400, '필수 컬럼 값이 없습니다'],
    ['배열 본문', '/users', [], 400, 'JSON 객체'],
    ['정수 컬럼에 문자열', '/users', { name: '재성', age: '1' }, 400, '정수를 입력'],
    ['정수 컬럼에 소수', '/users', { name: '재성', age: 1.5 }, 400, '정수를 입력'],
    ['정수 컬럼에 boolean', '/users', { name: '재성', age: false }, 400, '정수를 입력'],
    ['varchar에 숫자', '/users', { name: 123 }, 400, '문자열을 입력'],
    ['text에 객체', '/users', { name: '재성', bio: {} }, 400, '문자열을 입력'],
    ['text에 배열', '/users', { name: '재성', bio: [] }, 400, '문자열을 입력'],
    ['문자열 길이 초과', '/users', { name: 'abcd' }, 400, '최대 3자'],
    ['이모지 길이 초과', '/users', { name: '😀😀😀😀' }, 400, '최대 3자'],
    ['__proto__ 컬럼', '/users', JSON.parse('{"name":"재성","__proto__":{}}'), 400, '스키마에 등록되지 않은 컬럼'],
  ];
  for (const [name, path, body, status, message] of invalid) {
    await t.test(`POST ${name}: 저장 호출 없이 거부`, async () => {
      const count = calls.length;
      const response = await request(path, body);
      assert.equal(response.status, status);
      assert.ok(response.body.message.includes(message));
      assert.equal(calls.length, count, '거부된 요청이 DB에 전달되면 안 된다');
    });
  }
  for (const [name, body] of [['null', 'null'], ['문자열', '"hello"'], ['숫자', '1'], ['잘못된 JSON', '{']]) {
    await t.test(`POST ${name} 본문: 400, 저장 안 함`, async () => {
      const count = calls.length;
      const response = await request('/users', body, true);
      assert.equal(response.status, 400);
      assert.equal(calls.length, count);
    });
  }
  await t.test('POST 본문 없음: 400, 저장 안 함', async () => {
    const count = calls.length;
    const response = await fetch(base + '/users', { method: 'POST' });
    assert.equal(response.status, 400);
    assert.equal(calls.length, count);
  });
  const valid = [
    ['선택 컬럼 생략', '/users', { name: '재성' }],
    ['선택 컬럼 null', '/users', { name: '재성', age: null, bio: null }],
    ['숫자 0', '/users', { name: '재성', age: 0 }],
    ['정수 음수', '/users', { name: '재성', age: -1 }],
    ['문자열 길이 경계', '/users', { name: 'abc' }],
    ['이모지 길이 경계', '/users', { name: '😀😀😀' }],
    ['NOT NULL의 빈 문자열', '/users', { name: '' }],
    ['다른 테이블에 작성', '/posts', { user_id: 1, title: '첫 글', content: 'hello' }],
  ];
  for (const [name, path, data] of valid) {
    await t.test(`POST ${name}: 201, 검사 후 한 번만 저장`, async () => {
      const count = calls.length;
      const response = await request(path, data);
      assert.equal(response.status, 201);
      assert.equal(response.body.insertId, 42);
      assert.equal(calls.length, count + 1);
      assert.deepEqual(calls.at(-1), { operation: 'write', tableName: path.slice(1), data });
    });
  }
});
