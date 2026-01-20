"use strict";

import { Sequelize } from "sequelize";

export const up = async ({ context: { queryInterface } }) => {
  await queryInterface.addColumn("meeting_summaries", "source", {
    type: Sequelize.STRING,
    allowNull: true,
    comment: "Source of the summary: recall_webhook, recall_notepad_api, recall_event_api, openai, etc.",
  });
};

export const down = async ({ context: { queryInterface } }) => {
  await queryInterface.removeColumn("meeting_summaries", "source");
};
