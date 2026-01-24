import Queue from 'bull';

const backgroundQueue = new Queue(
  "background-queue",
  process.env.REDIS_URL || "redis://127.0.0.1:6379"
);

// Increase max listeners to prevent warnings when multiple processors register
backgroundQueue.setMaxListeners(20);

export { backgroundQueue };