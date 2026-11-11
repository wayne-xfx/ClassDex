import test from "node:test";
import assert from "node:assert/strict";
import { uploadPhoto } from "../src/utils/photoUpload.js";

function makeFakeFile({ type = "image/png", size = 128 } = {}) {
  return new Blob([new Uint8Array(size)], { type });
}

test("uploadPhoto validates allowed image type and max size", async () => {
  await assert.rejects(
    () => uploadPhoto(makeFakeFile({ type: "image/gif", size: 64 })),
    /Choose a JPG, PNG, or WebP image\./,
  );
  await assert.rejects(
    () => uploadPhoto(makeFakeFile({ type: "image/png", size: 5 * 1024 * 1024 + 1 })),
    /Choose an image smaller than 5 MB\./,
  );
});

test("uploadPhoto returns secure_url when Cloudinary unsigned upload succeeds", async () => {
  const file = makeFakeFile({ type: "image/png", size: 128 });
  const expectedUrl = "https://res.cloudinary.com/demo/image/upload/v1/avatar.png";
  const result = await uploadPhoto(file, {
    cloudName: "demo",
    uploadPreset: "ClassDex",
    isDev: false,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ secure_url: expectedUrl }),
    }),
  });
  assert.equal(result, expectedUrl);
});

test("uploadPhoto falls back to data URL in dev when Cloudinary returns 400", async () => {
  const file = makeFakeFile({ type: "image/jpeg", size: 128 });
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const result = await uploadPhoto(file, {
      cloudName: "enltxexd",
      uploadPreset: "ClassDex",
      isDev: true,
      fetch: async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: "Upload preset must be whitelisted for unsigned uploads" },
        }),
      }),
      readAsDataUrl: async () => "data:image/jpeg;base64,ZmFrZQ==",
    });
    assert.equal(result, "data:image/jpeg;base64,ZmFrZQ==");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Upload preset must be whitelisted for unsigned uploads/);
    assert.match(warnings[0], /local data URL photo fallback/i);
  } finally {
    console.warn = origWarn;
  }
});

test("uploadPhoto throws generic error in production when Cloudinary upload fails", async () => {
  const file = makeFakeFile({ type: "image/webp", size: 128 });
  const errors = [];
  const origError = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    await assert.rejects(
      () =>
        uploadPhoto(file, {
          cloudName: "enltxexd",
          uploadPreset: "ClassDex",
          isDev: false,
          fetch: async () => ({
            ok: false,
            status: 400,
            json: async () => ({
              error: { message: "Upload preset must be whitelisted for unsigned uploads" },
            }),
          }),
          readAsDataUrl: async () => "data:image/webp;base64,ZmFrZQ==",
        }),
      /Unable to upload photo right now\. Please try again\./,
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Upload preset must be whitelisted for unsigned uploads/);
  } finally {
    console.error = origError;
  }
});

test("uploadPhoto falls back to data URL in dev on network error", async () => {
  const file = makeFakeFile({ type: "image/png", size: 64 });
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const result = await uploadPhoto(file, {
      cloudName: "enltxexd",
      uploadPreset: "ClassDex",
      isDev: true,
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
      readAsDataUrl: async () => "data:image/png;base64,ZmFrZQ==",
    });
    assert.equal(result, "data:image/png;base64,ZmFrZQ==");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Failed to fetch/);
  } finally {
    console.warn = origWarn;
  }
});
