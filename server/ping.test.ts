import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import pingRouter from "./kokuli-ping";

test("GET /kokuli/ping returns 200 with pong and timestamp", async () => {
  const app = express();
  app.use("/", pingRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address);
  assert.ok(typeof address === "object" && "port" in address);
  const port = address.port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/kokuli/ping`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.pong, true);
    assert.equal(typeof body.timestamp, "number");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
