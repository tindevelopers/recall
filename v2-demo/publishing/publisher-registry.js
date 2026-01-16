import notionPublisher from "./publishers/notion.js";

const publishers = {
  notion: notionPublisher,
};

export function getPublisher(type) {
  return publishers[type];
}


