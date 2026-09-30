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

const migrationsPath = path.join(__dirname, "..", "prisma", "migrations");
const client = new Client({
  connectionString: databaseUrl.toString(),
  connectionTimeoutMillis: 10_000,
});

async function applySchema() {
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_ClassDexMigration" (
        "name" TEXT PRIMARY KEY,
        "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const migrations = fs
      .readdirSync(migrationsPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const name of migrations) {
      const migrationPath = path.join(migrationsPath, name, "migration.sql");
      if (!fs.existsSync(migrationPath)) {
        throw new Error(`Migration ${name} does not contain migration.sql.`);
      }
      const { rowCount } = await client.query(
        'SELECT 1 FROM "_ClassDexMigration" WHERE "name" = $1',
        [name],
      );
      if (rowCount) continue;

      await client.query("BEGIN");
      try {
        await client.query(fs.readFileSync(migrationPath, "utf8"));
        await client.query(
          'INSERT INTO "_ClassDexMigration" ("name") VALUES ($1)',
          [name],
        );
        await client.query("COMMIT");
        console.log(`Applied database migration ${name}.`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
    }

    const { rows } = await client.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [[
        "User",
        "FacultyProfile",
        "StudentProfile",
        "Class",
        "ClassEnrollment",
        "ClassSession",
        "AttendanceRecord",
        "RecitationLog",
        "Activity",
        "ActivityScore",
        "Project",
        "ProjectScore",
      ]],
    );
    const tables = rows.map(({ table_name }) => table_name);
    if (tables.length !== 12) {
      throw new Error(`Schema setup is incomplete. Found tables: ${tables.join(", ")}`);
    }
    const { rowCount: gracePeriodColumn } = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'Class'
         AND column_name = 'gracePeriodMinutes'`,
    );
    if (!gracePeriodColumn) {
      throw new Error("Schema setup is incomplete. Class.gracePeriodMinutes is missing.");
    }
    console.log(`Database schema is ready: ${tables.join(", ")}.`);
  } catch (error) {
    throw error;
  } finally {
    await client.end();
  }
}

applySchema().catch((error) => {
  console.error("Database schema setup failed:", error.message);
  process.exitCode = 1;
});
