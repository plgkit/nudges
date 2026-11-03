// Talks to Postgres for the main thread. The main thread waits on a shared
// buffer, so this file must not send the database address back.
import { parentPort, workerData } from "node:worker_threads";
import pg from "pg";

const ready = new Int32Array(workerData.ready);
let client;
let opened = false;
try {
  client = new pg.Client({
    connectionString: workerData.url,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  opened = true;
  Atomics.store(ready, 0, 1);
} catch (err) {
  const missing = err && (err.code === "ERR_MODULE_NOT_FOUND" || err.code === "MODULE_NOT_FOUND");
  Atomics.store(ready, 0, missing ? 3 : 2);
}
Atomics.notify(ready, 0);

if (!opened) {
  process.exit(0);
}

parentPort.on("message", async (msg) => {
  const view = new Int32Array(msg.sab);
  try {
    const result = await client.query(msg.sql, msg.params ?? []);
    writeResult(msg.sab, 1, JSON.stringify(result.rows ?? []));
  } catch {
    writeResult(msg.sab, 2, "");
  }
  Atomics.notify(view, 0);
});

function writeResult(sab, status, text) {
  const view = new Int32Array(sab);
  const bytes = Buffer.from(text);
  if (bytes.length + 8 > sab.byteLength) {
    Atomics.store(view, 1, 0);
    Atomics.store(view, 0, 2);
    return;
  }
  Buffer.from(sab).set(bytes, 8);
  Atomics.store(view, 1, bytes.length);
  Atomics.store(view, 0, status);
}
