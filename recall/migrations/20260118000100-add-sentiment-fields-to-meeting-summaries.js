"use strict";

import { Sequelize } from "sequelize";

export const up = async ({ context: { queryInterface } }) => {
  await queryInterface.addColumn("meeting_summaries", "sentiment", {
    type: Sequelize.JSON,
    allowNull: true,
    comment: "Overall meeting sentiment: { score: number (-1 to 1), label: string, confidence: number }",
  });
  
  await queryInterface.addColumn("meeting_summaries", "keyInsights", {
    type: Sequelize.JSON,
    allowNull: true,
    comment: "Key insights/ideas from the meeting: [{ insight: string, importance: string }]",
  });
  
  await queryInterface.addColumn("meeting_summaries", "decisions", {
    type: Sequelize.JSON,
    allowNull: true,
    comment: "Decisions made during the meeting: [{ decision: string, context: string }]",
  });
  
  await queryInterface.addColumn("meeting_summaries", "outcome", {
    type: Sequelize.STRING,
    allowNull: true,
    comment: "Meeting outcome: productive, inconclusive, needs_followup, etc.",
  });
};

export const down = async ({ context: { queryInterface } }) => {
  await queryInterface.removeColumn("meeting_summaries", "outcome");
  await queryInterface.removeColumn("meeting_summaries", "decisions");
  await queryInterface.removeColumn("meeting_summaries", "keyInsights");
  await queryInterface.removeColumn("meeting_summaries", "sentiment");
};
