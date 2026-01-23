import notionPublisher from "./publishers/notion.js";
import slackPublisher from "./publishers/slack.js";
import teamworkPublisher from "./publishers/teamwork.js";
import clickupPublisher from "./publishers/clickup.js";

const publishers = {
  notion: notionPublisher,
  slack: slackPublisher,
  teamwork: teamworkPublisher,
  clickup: clickupPublisher,
};

export function getPublisher(type) {
  return publishers[type];
}


