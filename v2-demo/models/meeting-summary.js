import { DataTypes } from "sequelize";

export default (sequelize) => {
  return sequelize.define(
    "MeetingSummary",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      meetingArtifactId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      calendarEventId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "completed",
      },
      summary: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      actionItems: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      followUps: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      topics: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      // Sentiment and meeting insights
      sentiment: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "Overall meeting sentiment: { score: number (-1 to 1), label: string, confidence: number }",
      },
      keyInsights: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "Key insights/ideas from the meeting: [{ insight: string, importance: string }]",
      },
      decisions: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "Decisions made during the meeting: [{ decision: string, context: string }]",
      },
      outcome: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "Meeting outcome: productive, inconclusive, needs_followup, etc.",
      },
      source: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "Source of the summary: recall_webhook, recall_notepad_api, recall_event_api, openai, etc.",
      },
    },
    {
      sequelize,
      tableName: "meeting_summaries",
      modelName: "MeetingSummary",
    }
  );
};


