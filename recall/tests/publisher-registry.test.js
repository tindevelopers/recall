import assert from "node:assert";
import { getPublisher } from "../publishing/publisher-registry.js";
import notionPublisher from "../publishing/publishers/notion.js";
import slackPublisher from "../publishing/publishers/slack.js";
import teamworkPublisher from "../publishing/publishers/teamwork.js";

// Basic sanity checks for registry
assert.strictEqual(await getPublisher("notion"), notionPublisher);
assert.strictEqual(await getPublisher("slack"), slackPublisher);
assert.strictEqual(await getPublisher("teamwork"), teamworkPublisher);

// Ensure publishers implement publish
assert.ok(typeof notionPublisher.publish === "function");
assert.ok(typeof slackPublisher.publish === "function");
assert.ok(typeof teamworkPublisher.publish === "function");

console.log("Publisher registry test passed");



