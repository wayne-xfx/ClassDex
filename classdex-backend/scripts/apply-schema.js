require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Add it to classdex-backend/.env");
}

const databaseUrl = new URL(connectionString);
const sslMode = databaseUrl.searchParams.get("sslmode");
if (["prefer", "require", "verify-ca"].includes(sslMode)) {
  databaseUrl.searchParams.set("sslmode", "verify-full");
}
databaseUrl.searchParams.set("sslnegotiation", "direct");

const migrationPath = path.join(
  __dirname,
  "..",
  "prisma",
  "migrations",
  "20260927011000_profiles_classes",
  "migration.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");
const client = new Client({
  connectionString: databaseUrl.toString(),
  connectionTimeoutMillis: 10_000,
});

async function applySchema() {
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(migration);
    await client.query("COMMIT");

    const { rows } = await client.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [["User", "FacultyProfile", "StudentProfile", "Class", "ClassEnrollment"]],
    );
    const tables = rows.map(({ table_name }) => table_name);
    if (tables.length !== 5) {
      throw new Error(`Schema setup is incomplete. Found tables: ${tables.join(", ")}`);
    }
    console.log(`Database schema is ready: ${tables.join(", ")}.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

applySchema().catch((error) => {
  console.error("Database schema setup failed:", error.message);
  process.exitCode = 1;
});
