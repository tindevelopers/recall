import crypto from "crypto";

let redisClient = null;
let redisReady = false;

async function getRedisClient() {
  if (redisClient || redisReady) return redisClient;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    redisReady = true;
    return null;
  }

  try {
    const { createClient } = await import("redis");
    redisClient = createClient({ url: redisUrl });
    redisClient.on("error", (err) =>
      console.warn("[cache] Redis client error:", err?.message || err)
    );
    await redisClient.connect();
    redisReady = true;
    console.log("[cache] Redis client connected");
  } catch (err) {
    console.warn("[cache] Redis not available, using in-memory cache:", err?.message || err);
    redisReady = true;
    redisClient = null;
  }

  return redisClient;
}

const memoryCache = new Map();

function memorySet(key, value, ttlSeconds) {
  const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
  memoryCache.set(key, { value, expiresAt });
}

function memoryGet(key) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

async function cacheSet(key, value, ttlSeconds = 3600) {
  const client = await getRedisClient();
  if (client) {
    try {
      await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
      return;
    } catch (err) {
      console.warn("[cache] Redis set failed, falling back to memory:", err?.message || err);
    }
  }

  memorySet(key, value, ttlSeconds);
}

async function cacheGet(key) {
  const client = await getRedisClient();
  if (client) {
    try {
      const raw = await client.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn("[cache] Redis get failed, falling back to memory:", err?.message || err);
    }
  }

  return memoryGet(key);
}

function hashKey(input = "") {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

export { cacheGet, cacheSet, hashKey };

