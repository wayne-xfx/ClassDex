const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

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

const adapter = new PrismaPg({
  connectionString: databaseUrl.toString(),
  connectionTimeoutMillis: 20_000,
  query_timeout: 30_000,
  idleTimeoutMillis: 10_000,
  keepAlive: true,
});
const prisma = new PrismaClient({
  adapter,
  transactionOptions: {
    maxWait: 15_000,
    timeout: 25_000,
  },
});

module.exports = { prisma };
