import notionPublisher from "./publishers/notion.js";
import slackPublisher from "./publishers/slack.js";
import teamworkPublisher from "./publishers/teamwork.js";

const publishers = {
  notion: notionPublisher,
  slack: slackPublisher,
  teamwork: teamworkPublisher,
};

// Optional publishers - loaded dynamically if available
let clickupPublisherLoaded = false;
let clickupPublisherPromise = null;

async function loadClickUpPublisher() {
  if (clickupPublisherPromise) return clickupPublisherPromise;
  clickupPublisherPromise = import("./publishers/clickup.js")
    .then((module) => {
      publishers.clickup = module.default;
      clickupPublisherLoaded = true;
      return module.default;
    })
    .catch((err) => {
      console.warn("[publisher-registry] ClickUp publisher not available:", err.message);
      clickupPublisherLoaded = true; // Mark as loaded even if failed
      return null;
    });
  return clickupPublisherPromise;
}

export async function getPublisher(type) {
  // For clickup, load dynamically if not already loaded
  if (type === "clickup" && !clickupPublisherLoaded) {
    await loadClickUpPublisher();
  }
  return publishers[type] || null;
}


