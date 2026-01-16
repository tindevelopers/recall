import path from "path";
import { fileURLToPath } from "url";
import { Sequelize } from "sequelize";
import { Umzug, SequelizeStorage } from "umzug";

import initUserModel from "./models/user.js";
import initCalendarModel from "./models/calendar.js";
import initCalendarEventModel from "./models/calendar-event.js";
import initCalendarWebhookModel from "./models/calendar-webhook.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db = {};

// Use PostgreSQL if DATABASE_URL is provided (Railway), otherwise use SQLite (local dev)
let sequelize;
if (process.env.DATABASE_URL) {
  // PostgreSQL configuration (Railway production)
  const url = new URL(process.env.DATABASE_URL);
  console.log(`INFO: Configuring PostgreSQL database`);
  console.log(`   Host: ${url.hostname}, Database: ${url.pathname.substring(1)}`);
  
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
    dialectOptions: {
      ssl: process.env.NODE_ENV === "production" ? {
        require: true,
        rejectUnauthorized: false
      } : false
    }
  });
  console.log("INFO: Using PostgreSQL database");
  console.log(`INFO: PostgreSQL connection configured - Host: ${url.hostname}, Database: ${url.pathname.substring(1)}`);
} else {
  // SQLite configuration (local development)
  const dbPath = process.env.DATABASE_PATH || path.join(__dirname, "db.sqlite");
  sequelize = new Sequelize({
    dialect: "sqlite",
    storage: dbPath,
    logging: false,
  });
  console.log(`INFO: Using SQLite database at ${dbPath}`);
  console.log(`WARNING: DATABASE_URL not set - using SQLite. For production, add PostgreSQL service in Railway.`);
}

const umzug = new Umzug({
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

export async function connect() {
  try {
    await sequelize.authenticate();
    console.log("INFO: Database connection established.");
  } catch (error) {
    console.error("❌ Database connection failed:");
    console.error(`   Error: ${error.message}`);
    if (process.env.DATABASE_URL) {
      console.error("   Using PostgreSQL with DATABASE_URL");
      // Don't log the full URL for security, but show if it's set
      const url = new URL(process.env.DATABASE_URL);
      console.error(`   Host: ${url.hostname}, Database: ${url.pathname.substring(1)}`);
    } else {
      console.error("   Using SQLite (DATABASE_URL not set)");
    }
    throw error;
  }
}

export async function migrate() {
  await umzug.up();
  console.log("INFO: Database migrations synced.");
}

db.sequelize = sequelize;
db.Sequelize = Sequelize;

db.User = initUserModel(sequelize);
db.Calendar = initCalendarModel(sequelize);
db.CalendarEvent = initCalendarEventModel(sequelize);
db.CalendarWebhook = initCalendarWebhookModel(sequelize);

db.User.hasMany(db.Calendar, { foreignKey: "userId" });
db.Calendar.belongsTo(db.User, { foreignKey: "userId" });

db.Calendar.hasMany(db.CalendarEvent, { foreignKey: "calendarId" });
db.Calendar.hasMany(db.CalendarWebhook, { foreignKey: "calendarId" });
db.CalendarEvent.belongsTo(db.Calendar, { foreignKey: "calendarId" });
db.CalendarWebhook.belongsTo(db.Calendar, { foreignKey: "calendarId" });

export default db;
