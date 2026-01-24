import Queue from 'bull';

const backgroundQueue = new Queue(
  "background-queue",
  process.env.REDIS_URL || "redis://127.0.0.1:6379"
);

// Increase max listeners to prevent warnings when multiple processors register
backgroundQueue.setMaxListeners(20);

// Also increase max listeners on the underlying Redis clients to prevent warnings
// Bull uses multiple Redis clients internally (client, subscriber, bclient)
backgroundQueue.on('ready', () => {
  if (backgroundQueue.client) {
    backgroundQueue.client.setMaxListeners(20);
  }
  if (backgroundQueue.bclient) {
    backgroundQueue.bclient.setMaxListeners(20);
  }
  // The eclient is used for events/subscriptions
  const eclient = backgroundQueue.clients?.[0];
  if (eclient) {
    eclient.setMaxListeners(20);
  }
});

export { backgroundQueue };