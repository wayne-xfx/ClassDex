if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    "postgresql://placeholder:placeholder@127.0.0.1:5432/classdex_unit?sslmode=disable";
}

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  pool,
  createPrismaWithReadRetry,
  isTransientConnectionError,
  READ_RETRY_OPERATIONS,
} = require("../db");

test.after(async () => {
  await pool.end().catch(() => {});
});

function makeFakePrisma(handler) {
  const models = {};
  const client = {
    $transaction: async (arg) => {
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      return arg(models);
    },
    $extends: ({ query }) => {
      const hook = query.$allModels.$allOperations;
      for (const modelName of ["User", "Class"]) {
        const lower = modelName[0].toLowerCase() + modelName.slice(1);
        models[lower] = new Proxy(
          {},
          {
            get(_t, operation) {
              return (args) =>
                hook({
                  model: modelName,
                  operation: String(operation),
                  args,
                  query: (nextArgs) => handler(modelName, String(operation), nextArgs),
                });
            },
          },
        );
      }
      return {
        ...models,
        $transaction: client.$transaction,
      };
    },
  };
  return client;
}

test("isTransientConnectionError identifies transient connection drops and excludes query/constraint errors", () => {
  assert.equal(isTransientConnectionError({ code: "P1001" }), true);
  assert.equal(isTransientConnectionError({ code: "P2024" }), true);
  assert.equal(isTransientConnectionError({ code: "ECONNRESET" }), true);
  assert.equal(
    isTransientConnectionError(new Error("Connection terminated unexpectedly")),
    true,
  );
  assert.equal(isTransientConnectionError({ code: "P2002", message: "Unique constraint" }), false);
  assert.equal(isTransientConnectionError({ code: "P2025", message: "Record not found" }), false);
});

test("read operations retry up to 2 times on transient connection errors and succeed", async () => {
  for (const op of READ_RETRY_OPERATIONS) {
    let calls = 0;
    const base = makeFakePrisma(async () => {
      calls += 1;
      if (calls <= 2) {
        const err = new Error("Connection terminated unexpectedly");
        err.code = "P1001";
        throw err;
      }
      return { ok: true, op };
    });

    const client = createPrismaWithReadRetry(base, {
      baseDelayMs: 0,
      logger: { warn: () => {} },
    });

    const res = await client.user[op]({ where: { id: "1" } });
    assert.deepEqual(res, { ok: true, op });
    assert.equal(calls, 3, `Expected 1 initial + 2 retries for ${op}`);
  }
});

test("read operations stop after max 2 retries (3 total attempts) when error persists", async () => {
  let calls = 0;
  const base = makeFakePrisma(async () => {
    calls += 1;
    const err = new Error("Can't reach database server");
    err.code = "P1001";
    throw err;
  });

  const client = createPrismaWithReadRetry(base, {
    baseDelayMs: 0,
    logger: { warn: () => {} },
  });

  await assert.rejects(() => client.user.findUnique({ where: { id: "1" } }), /Can't reach/);
  assert.equal(calls, 3);
});

test("read operations never retry non-connection errors", async () => {
  let calls = 0;
  const base = makeFakePrisma(async () => {
    calls += 1;
    const err = new Error("Record not found");
    err.code = "P2025";
    throw err;
  });

  const client = createPrismaWithReadRetry(base, {
    baseDelayMs: 0,
    logger: { warn: () => {} },
  });

  await assert.rejects(() => client.user.findFirst({}), /Record not found/);
  assert.equal(calls, 1);
});

test("write operations never retry even on transient connection errors", async () => {
  for (const writeOp of ["create", "update", "updateMany", "upsert", "delete", "deleteMany"]) {
    let calls = 0;
    const base = makeFakePrisma(async () => {
      calls += 1;
      const err = new Error("Connection terminated unexpectedly");
      err.code = "P1001";
      throw err;
    });

    const client = createPrismaWithReadRetry(base, {
      baseDelayMs: 0,
      logger: { warn: () => {} },
    });

    await assert.rejects(() => client.user[writeOp]({ data: {} }));
    assert.equal(calls, 1, `Write op ${writeOp} must never retry`);
  }
});

test("reads inside $transaction never retry", async () => {
  let calls = 0;
  const base = makeFakePrisma(async () => {
    calls += 1;
    const err = new Error("Connection terminated unexpectedly");
    err.code = "P1001";
    throw err;
  });

  const client = createPrismaWithReadRetry(base, {
    baseDelayMs: 0,
    logger: { warn: () => {} },
  });

  await assert.rejects(() =>
    client.$transaction(async (tx) => {
      await tx.user.findUnique({ where: { id: "1" } });
    }),
  );
  assert.equal(calls, 1, "Read inside interactive $transaction must never retry");
});
