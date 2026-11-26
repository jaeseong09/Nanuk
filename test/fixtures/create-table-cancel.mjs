// 취소 시점을 일정하게 재현하기 위한 입력·DB 대역. 실제 DB에는 접속하지 않는다.
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const mysql = require('mysql2/promise');
const readline = require('node:readline/promises');
const mode = process.argv[2];
const rl = new EventEmitter();
const calls = { connect: 0, query: 0, end: 0, close: 0, question: 0, sqls: [] };
rl.close = () => { calls.close++; };
rl.question = async (_, { signal }) => {
  calls.question++;
  if (mode === 'question') {
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      queueMicrotask(() => rl.emit('SIGINT'));
    });
  }
  if (mode === 'no') return 'n';
  return 'y';
};
readline.createInterface = () => rl;
syncBuiltinESMExports();
mysql.createConnection = async () => {
  calls.connect++;
  if (mode === 'connect') rl.emit('SIGINT');
  return {
    query: async (sql) => {
      calls.query++;
      calls.sqls.push(sql);
      if (mode.startsWith('query-')) rl.emit('SIGINT');
      // 두 번째 SQL 실패로 첫 번째 성공과 세 번째 실행 여부를 검사한다.
      if (mode === 'second-error' && calls.query === 2) {
        throw Object.assign(new Error('table exists'), { code: 'ER_TABLE_EXISTS_ERROR' });
      }
      if (mode === 'second-query-error' && calls.query === 2) {
        rl.emit('SIGINT');
        throw Object.assign(new Error('connection lost'), { code: 'PROTOCOL_CONNECTION_LOST' });
      }
      if (mode === 'query-error' || mode === 'error') {
        throw Object.assign(new Error('connection lost'), { code: 'PROTOCOL_CONNECTION_LOST' });
      }
    },
    end: async () => { calls.end++; },
  };
};
const { default: main } = await import('../../src/commands/create-table.js');
await main();
console.log('TEST_CALLS:' + JSON.stringify(calls));
