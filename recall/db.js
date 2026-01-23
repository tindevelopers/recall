import dotenv from "dotenv";
// Load environment variables immediately - this ensures DATABASE_URL is available
dotenv.config();

import { Sequelize } from "sequelize";
import { Umzug, SequelizeStorage } from "umzug";

import initUserModel from "./models/user.js";
import initCalendarModel from "./models/calendar.js";
import initCalendarEventModel from "./models/calendar-event.js";
import initCalendarWebhookModel from "./models/calendar-webhook.js";
import initMeetingArtifactModel from "./models/meeting-artifact.js";
import initMeetingTranscriptChunkModel from "./models/meeting-transcript-chunk.js";
import initMeetingSummaryModel from "./models/meeting-summary.js";
import initIntegrationModel from "./models/integration.js";
import initPublishTargetModel from "./models/publish-target.js";
import initPublishDeliveryModel from "./models/publish-delivery.js";
import initMeetingShareModel from "./models/meeting-share.js";

let db = {};
let sequelize = null;
let umzug = null;

function initializeDatabase() {
  if (sequelize) {
    return; // Already initialized
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const url = new URL(process.env.DATABASE_URL);
  console.log(`INFO: Configuring PostgreSQL database`);
  console.log(`   Host: ${url.hostname}, Database: ${url.pathname.substring(1)}`);

  // Enable SSL for Railway PostgreSQL (hostnames contain railway.app or proxy.rlwy.net)
  // Also enable SSL in production environments
  const isRailwayDatabase = url.hostname.includes('railway.app') || url.hostname.includes('proxy.rlwy.net');
  const shouldUseSSL = process.env.NODE_ENV === "production" || isRailwayDatabase;
  
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
    dialectOptions: {
      ssl: shouldUseSSL ? {
        require: true,
        rejectUnauthorized: false
      } : false
    }
  });
  console.log("INFO: Using PostgreSQL database");
  console.log(`INFO: PostgreSQL connection configured - Host: ${url.hostname}, Database: ${url.pathname.substring(1)}`);

  umzug = new Umzug({
    migrations: {
      glob: "migrations/*.js",
      resolve: ({ name, path }) => {
        const getModule = () => import(`file:///${path.replace(/\\/g, "/")}`);
        return {
          name: name,
          path: path,
          up: async (upParams) => (await getModule()).up(upParams),
          down: async (downParams) => (await getModule()).down(downParams),
        };
      },
    },
    context: { queryInterface: sequelize.getQueryInterface() },
    storage: new SequelizeStorage({ sequelize }),
    logger: undefined,
  });
}

export async function connect() {
  initializeDatabase();
  initializeModels();
  try {
    await sequelize.authenticate();
    console.log("INFO: Database connection established.");
  } catch (error) {
    console.error("❌ Database connection failed:");
    console.error(`   Error: ${error.message}`);
    console.error("   Using PostgreSQL with DATABASE_URL");
    // Don't log the full URL for security, but show if it's set
    const url = new URL(process.env.DATABASE_URL);
    console.error(`   Host: ${url.hostname}, Database: ${url.pathname.substring(1)}`);
    throw error;
  }
}

export async function migrate() {
  initializeDatabase();
  await umzug.up();
  console.log("INFO: Database migrations synced.");
}

// Initialize database when models are accessed
function ensureInitialized() {
  if (!sequelize) {
    initializeDatabase();
  }
}

// Lazy getters for models
Object.defineProperty(db, 'sequelize', {
  get() {
    ensureInitialized();
    return sequelize;
  }
});

db.Sequelize = Sequelize;

// Initialize models lazily when db is accessed
function initializeModels() {
  ensureInitialized();
  if (db.User) {
    return; // Already initialized
  }
  
  db.User = initUserModel(sequelize);
  db.Calendar = initCalendarModel(sequelize);
  db.CalendarEvent = initCalendarEventModel(sequelize);
  db.CalendarWebhook = initCalendarWebhookModel(sequelize);
  db.MeetingArtifact = initMeetingArtifactModel(sequelize);
  db.MeetingTranscriptChunk = initMeetingTranscriptChunkModel(sequelize);
  db.MeetingSummary = initMeetingSummaryModel(sequelize);
  db.Integration = initIntegrationModel(sequelize);
  db.PublishTarget = initPublishTargetModel(sequelize);
  db.PublishDelivery = initPublishDeliveryModel(sequelize);

  db.User.hasMany(db.Calendar, { foreignKey: "userId" });
  db.Calendar.belongsTo(db.User, { foreignKey: "userId" });

  db.Calendar.hasMany(db.CalendarEvent, { foreignKey: "calendarId" });
  db.Calendar.hasMany(db.CalendarWebhook, { foreignKey: "calendarId" });
  db.CalendarEvent.belongsTo(db.Calendar, { foreignKey: "calendarId" });
  db.CalendarWebhook.belongsTo(db.Calendar, { foreignKey: "calendarId" });

  db.CalendarEvent.hasMany(db.MeetingArtifact, { foreignKey: "calendarEventId" });
  db.MeetingArtifact.belongsTo(db.CalendarEvent, { foreignKey: "calendarEventId" });
  db.MeetingArtifact.belongsTo(db.User, { foreignKey: "userId" });

  db.MeetingArtifact.hasMany(db.MeetingTranscriptChunk, {
    foreignKey: "meetingArtifactId",
  });
  db.MeetingTranscriptChunk.belongsTo(db.MeetingArtifact, {
    foreignKey: "meetingArtifactId",
  });

  db.MeetingArtifact.hasMany(db.MeetingSummary, {
    foreignKey: "meetingArtifactId",
  });
  db.MeetingSummary.belongsTo(db.MeetingArtifact, {
    foreignKey: "meetingArtifactId",
  });
  db.MeetingSummary.belongsTo(db.CalendarEvent, {
    foreignKey: "calendarEventId",
  });
  db.MeetingSummary.belongsTo(db.User, {
    foreignKey: "userId",
  });

  db.User.hasMany(db.Integration, { foreignKey: "userId" });
  db.Integration.belongsTo(db.User, { foreignKey: "userId" });

  db.User.hasMany(db.PublishTarget, { foreignKey: "userId" });
  db.PublishTarget.belongsTo(db.User, { foreignKey: "userId" });

  db.MeetingSummary.hasMany(db.PublishDelivery, {
    foreignKey: "meetingSummaryId",
  });
  db.PublishDelivery.belongsTo(db.MeetingSummary, {
    foreignKey: "meetingSummaryId",
  });
  db.PublishTarget.hasMany(db.PublishDelivery, {
    foreignKey: "publishTargetId",
  });
  db.PublishDelivery.belongsTo(db.PublishTarget, {
    foreignKey: "publishTargetId",
  });

  // Meeting sharing associations
  db.MeetingShare = initMeetingShareModel(sequelize);
  
  db.MeetingArtifact.hasMany(db.MeetingShare, {
    foreignKey: "meetingArtifactId",
    as: "shares",
  });
  db.MeetingShare.belongsTo(db.MeetingArtifact, {
    foreignKey: "meetingArtifactId",
  });
  
  db.User.hasMany(db.MeetingShare, {
    foreignKey: "sharedWithUserId",
    as: "sharedMeetings",
  });
  db.MeetingShare.belongsTo(db.User, {
    foreignKey: "sharedWithUserId",
    as: "sharedWithUser",
  });
  
  db.User.hasMany(db.MeetingShare, {
    foreignKey: "sharedByUserId",
    as: "meetingsSharedByMe",
  });
  db.MeetingShare.belongsTo(db.User, {
    foreignKey: "sharedByUserId",
    as: "sharedByUser",
  });

  // Owner association for MeetingArtifact
  db.MeetingArtifact.belongsTo(db.User, {
    foreignKey: "ownerUserId",
    as: "owner",
  });
  db.User.hasMany(db.MeetingArtifact, {
    foreignKey: "ownerUserId",
    as: "ownedMeetings",
  });
}

export default db;

