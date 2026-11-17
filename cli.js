#!/usr/bin/env node

import checkDatabase from "./doctor.js";
import init from "./init.js";
import createDB from "./create-database.js";

const command = process.argv[2];

const help = `Nanuk — MySQL 개발 환경 설정 도구

사용법:
  nanuk init      .env와 .gitignore 설정 준비
  nanuk doctor    현재 폴더의 DB 접속 설정 검사
  nanuk create-db    SQL을 확인하고 MySQL 데이터베이스 생성
  nanuk --help    도움말 표시`;

if (command === "doctor") {
  console.log("DB 검사를 시작합니다");
  await checkDatabase();
} else if (command === "init") {
  await init();
} else if (command === "create-db") {
  await createDB();
} else if (!command || command === "--help" || command === "-h") {
  console.log(help);
} else {
  console.error(`지원하지 않는 명령어입니다: ${command}\n`);
  console.error(help);
  process.exitCode = 1;
}
