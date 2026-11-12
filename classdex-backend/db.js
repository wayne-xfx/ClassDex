const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

const { AsyncLocalStorage } = require("node:async_hooks");
const { Pool } = require("pg");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const READ_RETRY_OPERATIONS = new Set([
  "findUnique",
  "findFirst",
  "findMany",
  "count",
  "aggregate",
]);
const MAX_READ_RETRIES = 2;
const TRANSIENT_CODES = new Set([
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2024",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "57P01",
  "57P02",
  "57P03",
]);

function isTransientConnectionError(error) {
  if (!error) return false;
  const code = String(
    error.code || error.cause?.code || error.meta?.driverAdapterError?.cause?.code || "",
  ).trim();
  if (TRANSIENT_CODES.has(code)) {
    return true;
  }
  const message = `${error.message || ""} ${error.cause?.message || ""}`;
  return (
    /connection terminated unexpectedly/i.test(message) ||
    /terminating connection due to administrator command/i.test(message) ||
    /can't reach database server/i.test(message) ||
    /client has encountered a connection error/i.test(message) ||
    /timeout exceeded when trying to connect/i.test(message) ||
    /connection.*(?:timeout|timed out|terminated|refused|reset|closed|unavailable)/i.test(
      message,
    ) ||
    /(?:timeout|timed out|refused|reset).*connection/i.test(message)
  );
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPrismaWithReadRetry(
  basePrisma,
  {
    maxRetries = MAX_READ_RETRIES,
    baseDelayMs = 150,
    sleep = defaultSleep,
    logger = console,
  } = {},
) {
  const txStorage = new AsyncLocalStorage();

  async function executeWithRetry({ model, operation, args, query }) {
    const canRetry =
      READ_RETRY_OPERATIONS.has(operation) && txStorage.getStore() !== true;

    let attempt = 0;
    while (true) {
      try {
        return await query(args);
      } catch (error) {
        if (!canRetry || attempt >= maxRetries || !isTransientConnectionError(error)) {
          throw error;
        }
        attempt += 1;
        logger.warn?.(
          `[ClassDex DB] Retrying ${model || "query"}.${operation} after transient connection error (attempt ${attempt}/${maxRetries}): ${error?.code || error?.message || "unknown"}`,
        );
        if (baseDelayMs > 0) {
          await sleep(baseDelayMs * attempt);
        }
      }
    }
  }

  const extended = basePrisma.$extends({
    query: {
      $allModels: {
        $allOperations(params) {
          return executeWithRetry(params);
        },
      },
    },
  });

  return new Proxy(extended, {
    get(target, prop, receiver) {
      if (prop === "$transaction") {
        const origTx = target.$transaction.bind(target);
        return (arg, options) => txStorage.run(true, () => origTx(arg, options));
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

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

const pool = new Pool({
  connectionString: databaseUrl.toString(),
  connectionTimeoutMillis: 20_000,
  query_timeout: 30_000,
  idleTimeoutMillis: 10_000,
  keepAlive: true,
});

pool.on("error", (error) => {
  console.error(
    "[ClassDex DB Pool] Idle client error:",
    error?.code || error?.message || "unknown error",
  );
});

const adapter = new PrismaPg(pool, {
  onPoolError: (error) => {
    console.error(
      "[ClassDex DB Adapter] Pool error:",
      error?.code || error?.message || "unknown error",
    );
  },
  onConnectionError: (error) => {
    console.error(
      "[ClassDex DB Adapter] Connection error:",
      error?.code || error?.message || "unknown error",
    );
  },
});

const basePrisma = new PrismaClient({
  adapter,
  transactionOptions: {
    maxWait: 15_000,
    timeout: 25_000,
  },
});

const prisma = createPrismaWithReadRetry(basePrisma);

module.exports = {
  prisma,
  pool,
  isTransientConnectionError,
  createPrismaWithReadRetry,
  READ_RETRY_OPERATIONS,
  MAX_READ_RETRIES,
};
