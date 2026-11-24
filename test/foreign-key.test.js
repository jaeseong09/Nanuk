import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 실제 CLI를 별도 임시 폴더에서 실행한다. 오류 사례에서는 DB 접속 전에 멈춰야 한다.
function run(schema, command = 'preview') {
  const cwd = mkdtempSync(join(tmpdir(), 'nanuk-fk-'));
  try {
    writeFileSync(join(cwd, 'schema.nanuk'), schema);
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('../cli.js', import.meta.url)), command,
    ], {
      cwd, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, DB_HOST: '127.0.0.1', DB_PORT: '1',
        DB_USER: 'nanuk_test', DB_PASSWORD: '', DB_NAME: 'nanuk_test' },
    });
    assert.ifError(result.error);
    return result;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

const users = 'table users {\nid auto\nname varchar(20)\n}\n';
const posts = (definition) => `table posts {\nid auto\n${definition}\n}\n`;
const userSql = 'CREATE TABLE `users` (\n`id` INT AUTO_INCREMENT PRIMARY KEY,\n`name` varchar(20)\n);\n';

test('외래키가 있는 SQL의 전체 문장과 RESTRICT를 확인한다', () => {
  const result = run(users + posts('user_id int NOT NULL ref users.id'));
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, userSql + 'CREATE TABLE `posts` (\n`id` INT AUTO_INCREMENT PRIMARY KEY,\n`user_id` int NOT NULL,\nFOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT\n);\n');
});

test('NOT NULL 없는 외래키 여러 개를 쉼표와 줄바꿈으로 합친다', () => {
  const result = run(users + posts('author_id int ref users.id\neditor_id int ref users.id'));
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, userSql + 'CREATE TABLE `posts` (\n`id` INT AUTO_INCREMENT PRIMARY KEY,\n`author_id` int,\n`editor_id` int,\nFOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,\nFOREIGN KEY (`editor_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT\n);\n');
});

test('REF 대소문자는 허용하고 참조 이름의 대소문자와 백틱을 보존한다', () => {
  const result = run('table Us`ers {\nID auto\n}\n' + posts('owner int REF Us`ers.ID'));
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /REFERENCES `Us``ers` \(`ID`\) ON DELETE RESTRICT/);
});

const invalid = [
  ['참조 대상 누락', users + posts('user_id int ref'), /7번째 줄: ref 뒤에/],
  ['점 누락', users + posts('user_id int ref users'), /7번째 줄: 참조 형식/],
  ['참조 테이블 빈 값', users + posts('user_id int ref .id'), /7번째 줄: 참조 형식/],
  ['참조 컬럼 빈 값', users + posts('user_id int ref users.'), /7번째 줄: 참조 형식/],
  ['점 과다', users + posts('user_id int ref users.id.extra'), /7번째 줄: 참조 형식/],
  ['뒤의 추가 옵션', users + posts('user_id int ref users.id NOT NULL'), /마지막에 한 번만/],
  ['중복 ref', users + posts('user_id int ref users.id ref users.id'), /마지막에 한 번만/],
  ['알 수 없는 옵션', users + posts('user_id int BOGUS ref users.id'), /지원하지 않는 컬럼 옵션/],
  ['없는 테이블', users + posts('user_id int ref missing.id'), /posts.user_id: 참조할 테이블 'missing'/],
  ['없는 컬럼', users + posts('user_id int ref users.missing'), /posts.user_id: 참조할 컬럼 'users.missing'/],
  ['auto가 아닌 참조 대상', users + posts('user_id int ref users.name'), /현재는 auto 기본키만/],
  ['int가 아닌 외래키', users + posts('user_id text ref users.id'), /현재 외래키 컬럼은 int/],
  ['부모가 뒤에 선언됨', posts('user_id int ref users.id') + users, /앞에 선언된 테이블만/],
  ['자기 참조', 'table users {\nid auto\nparent_id int ref users.id\n}', /앞에 선언된 테이블만/],
];

for (const [name, schema, message] of invalid) {
  test(`${name}: preview와 create-table 모두 SQL·확인 질문 전에 실패한다`, () => {
    for (const command of ['preview', 'create-table']) {
      const result = run(schema, command);
      assert.equal(result.status, 1, command);
      assert.match(result.stderr, message);
      assert.equal(result.stdout, '', command);
    }
  });
}
