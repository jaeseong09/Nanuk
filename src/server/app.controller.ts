import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { AppService } from "./app.service.js";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}
  @Get()
  getHello() {
    return this.appService.getHello();
  }

  @Get(":tableName")
  getRows(@Param("tableName") tableName: string) {
    return this.appService.getRows(tableName);
  }

  @Post(":tableName")
  createRow(
    @Param("tableName") tableName: string,
    @Body() data: Record<string, unknown>,
  ) {
    return this.appService.createRow(tableName, data);
  }
}
