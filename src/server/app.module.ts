import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { DatabaseService } from "./database.service.js";
import { SchemaService } from "./schema.service.js";

@Module({
  controllers: [AppController],
  providers: [AppService, DatabaseService, SchemaService],
})
export class AppModule {}
