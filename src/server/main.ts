import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import dotenv from "dotenv";

async function bootstrap() {
  dotenv.config({ quiet: true });
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();

  try {
    await app.listen(3000, "127.0.0.1");
  } catch (err) {
    await app.close();
    process.exitCode = 1;
  }
}

bootstrap();
