import { v4 as uuidv4 } from "uuid";

/**
 * Create action_items table and migrate existing JSON action items
 */
export async function up({ context: { queryInterface } }) {
  const Sequelize = queryInterface.sequelize.Sequelize;
  
  await queryInterface.createTable("action_items", {
    id: {
      type: Sequelize.UUID,
      allowNull: false,
      primaryKey: true,
      defaultValue: Sequelize.literal("gen_random_uuid()"),
    },
    meetingSummaryId: {
      type: Sequelize.UUID,
      allowNull: false,
      references: {
        model: "meeting_summaries",
        key: "id",
      },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    text: {
      type: Sequelize.TEXT,
      allowNull: false,
    },
    assignee: {
      type: Sequelize.STRING,
      allowNull: true,
    },
    dueDate: {
      type: Sequelize.DATE,
      allowNull: true,
    },
    status: {
      type: Sequelize.ENUM("pending", "completed", "cancelled"),
      allowNull: false,
      defaultValue: "pending",
    },
    completedAt: {
      type: Sequelize.DATE,
      allowNull: true,
    },
    completedBy: {
      type: Sequelize.UUID,
      allowNull: true,
    },
    createdAt: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal("NOW()"),
    },
    updatedAt: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal("NOW()"),
    },
  });

  // Migrate existing JSON action items into structured table
  const [summaries] = await queryInterface.sequelize.query(
    `SELECT id, "actionItems" FROM meeting_summaries WHERE "actionItems" IS NOT NULL`
  );

  const rows = [];
  for (const summary of summaries) {
    const items = Array.isArray(summary.actionItems)
      ? summary.actionItems
      : [];
    for (const item of items) {
      const text =
        item?.text ||
        item?.action ||
        item?.title ||
        JSON.stringify(item || {});
      if (!text) continue;
      rows.push({
        id: uuidv4(),
        meetingSummaryId: summary.id,
        text,
        assignee: item?.assignee || item?.owner || null,
        dueDate: item?.dueDate ? new Date(item.dueDate) : null,
        status: "pending",
        completedAt: null,
        completedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  if (rows.length) {
    await queryInterface.bulkInsert("action_items", rows);
  }
}

export async function down({ context: { queryInterface } }) {
  await queryInterface.dropTable("action_items");
}

