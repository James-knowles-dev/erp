import IORedis from "ioredis";

// Shared connection for BullMQ (queue.server.ts and worker.server.ts). BullMQ requires
// maxRetriesPerRequest: null on the connection it's given -- see
// https://docs.bullmq.io/guide/going-to-production#maxretriesperrequest
let connection: IORedis | undefined;

export function getRedisConnection(): IORedis {
  if (!connection) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is not set.");
    connection = new IORedis(url, { maxRetriesPerRequest: null });
  }
  return connection;
}
