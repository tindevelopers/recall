import notionPublisher from "./publishers/notion.js";
import slackPublisher from "./publishers/slack.js";
import teamworkPublisher from "./publishers/teamwork.js";

const publishers = {
  notion: notionPublisher,
  slack: slackPublisher,
  teamwork: teamworkPublisher,
};

export function getPublisher(type) {
  return publishers[type];
}


