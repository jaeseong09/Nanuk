import { readFile } from "node:fs/promises";

const schemaText = await readFile(process.cwd() + "/schema.nanuk", "utf8");

const lines = schemaText
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "");

const tableName = lines[0].split(" ")[1];

const columnLines = lines.slice(1, -1);

const columns = columnLines.map((line) => {
  const notNull = line.toUpperCase().includes("NOT NULL");
  const [name, type] = line.split(" ");
  return { name, type, notNull };
});

const columnSqls = columns.map((col) => {
  if (col.type === "auto") {
    return `${col.name} INT AUTO_INCREMENT PRIMARY KEY`;
  }
  if (col.notNull) {
    return `${col.name} ${col.type} NOT NULL`;
  }

  return `${col.name} ${col.type}`;
});

const sql = `CREATE TABLE ${tableName} (
${columnSqls.join(",\n")}
);`;

console.log(sql);
