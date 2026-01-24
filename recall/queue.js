import Queue from 'bull';
import { EventEmitter } from 'events';

// Increase the default max listeners globally to prevent warnings
// This affects all EventEmitters in the application, including ioredis Commander
EventEmitter.defaultMaxListeners = 20;

const backgroundQueue = new Queue(
  "background-queue",
  process.env.REDIS_URL || "redis://127.0.0.1:6379"
);

// Increase max listeners to prevent warnings when multiple processors register
backgroundQueue.setMaxListeners(20);

// Increase max listeners on all underlying Redis clients
// Bull uses ioredis internally, which has Commander objects that emit events
if (backgroundQueue.client) {
  backgroundQueue.client.setMaxListeners(20);
}
if (backgroundQueue.bclient) {
  backgroundQueue.bclient.setMaxListeners(20);
}
if (backgroundQueue.eclient) {
  backgroundQueue.eclient.setMaxListeners(20);
}

export { backgroundQueue };