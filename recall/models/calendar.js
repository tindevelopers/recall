import { DataTypes } from "sequelize";
import {
  buildGoogleCalendarOAuthUrl,
  buildMicrosoftOutlookOAuthUrl,
} from "../logic/oauth.js";

export default (sequelize) => {
  return sequelize.define(
    "Calendar",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      platform: {
        type: DataTypes.ENUM("google_calendar", "microsoft_outlook"),
        allowNull: false,
      },
      recallId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      recallData: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      autoRecordExternalEvents: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      autoRecordInternalEvents: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment:
          "When enabled, internal meetings (same-domain attendees) are eligible for auto-recording.",
      },
      autoRecordOnlyConfirmedEvents: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      useRetellTranscription: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      // Bot appearance settings
      botName: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: "Meeting Assistant",
        field: "bot_name",
      },
      botAvatarUrl: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "bot_avatar_url",
      },

      // Recording settings
      recordVideo: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: "record_video",
      },
      recordAudio: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: "record_audio",
      },

      // Transcription settings
      enableTranscription: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: "enable_transcription",
      },
      transcriptionLanguage: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: "en",
        field: "transcription_language",
      },
      transcriptionMode: {
        type: DataTypes.ENUM("realtime", "async"),
        allowNull: false,
        defaultValue: "realtime",
        field: "transcription_mode",
      },

      // AI enrichment settings
      enableSummary: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: "enable_summary",
      },
      enableActionItems: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: "enable_action_items",
      },
      enableFollowUps: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: "enable_follow_ups",
      },
      enableSuperAgent: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: "enable_super_agent",
        comment: "Enable AssemblyAI Super Agent (premium) analysis from Settings → Bot Settings",
      },
      // AI provider and model selection
      aiProvider: {
        type: DataTypes.ENUM("recall", "openai", "assemblyai", "anthropic"),
        allowNull: false,
        defaultValue: "recall",
        field: "ai_provider",
        comment: "AI provider for summarization: recall, openai, assemblyai, anthropic",
      },
      aiModel: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
        field: "ai_model",
        comment: "Specific model identifier (provider-specific, null = default)",
      },

      // Publishing settings
      autoPublishToNotion: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: "auto_publish_to_notion",
      },

      // Storage / archiving settings (optional; supports S3-compatible providers)
      storageProvider: {
        type: DataTypes.ENUM("aws_s3", "wasabi", "backblaze", "minio", "custom"),
        allowNull: true,
        field: "storage_provider",
      },
      storageEndpoint: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "storage_endpoint",
        comment: "Custom endpoint for S3-compatible storage (Wasabi, Backblaze, MinIO, etc.)",
      },
      storageBucket: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "storage_bucket",
      },
      storageAccessKey: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "storage_access_key",
      },
      storageSecretKey: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "storage_secret_key",
      },
      storageRegion: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "storage_region",
      },
      autoArchiveRecordings: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: "auto_archive_recordings",
        comment: "Automatically download recordings to configured storage after meetings",
      },

      // Bot behavior settings
      joinBeforeStartMinutes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        field: "join_before_start_minutes",
      },
      leaveAfterEndMinutes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "leave_after_end_minutes",
      },
      autoLeaveIfAlone: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: "auto_leave_if_alone",
      },
      autoLeaveAloneTimeoutSeconds: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 60,
        field: "auto_leave_alone_timeout_seconds",
      },

      email: {
        type: DataTypes.VIRTUAL,
        get() {
          return this.recallData?.["platform_email"] || this.recallData?.platform_email || this.recallData?.email || "Unknown";
        },
        set(value) {
          throw new Error("NOT_ALLOWED");
        },
      },
      status: {
        type: DataTypes.VIRTUAL,
        get() {
          return this.recallData?.["status"] || this.recallData?.status || "connected";
        },
        set(value) {
          throw new Error("NOT_ALLOWED");
        },
      },
      connectUrl: {
        type: DataTypes.VIRTUAL,
        get() {
          const state = { userId: this.userId, calendarId: this.id }
          return this.platform === "google_calendar" ? buildGoogleCalendarOAuthUrl(state) : buildMicrosoftOutlookOAuthUrl(state);
        },
        set(value) {
          throw new Error("NOT_ALLOWED");
        },
      }
    },
    {
      sequelize,
      tableName: "calendars",
      modelName: "Calendar",
    }
  );
};
