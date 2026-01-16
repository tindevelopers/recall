import db from "../../db.js";
import { searchPagesAndDatabases, getPageOrDatabase } from "../../services/notion/api-client.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Get the user's Notion integration
    const notionIntegration = await db.Integration.findOne({
      where: {
        userId: req.authentication.user.id,
        provider: "notion",
      },
    });

    if (!notionIntegration) {
      return res.status(400).json({ error: "Notion not connected" });
    }

    const query = req.query.q || "";
    const results = await searchPagesAndDatabases({
      accessToken: notionIntegration.accessToken,
      query,
    });

    return res.json({ results });
  } catch (err) {
    console.error("[ERROR] Failed to fetch Notion pages:", err);
    return res.status(500).json({ error: err.message || "Failed to fetch pages" });
  }
};

// Get details about a specific page/database
export async function getNotionPageDetails(req, res) {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "ID is required" });
    }

    const notionIntegration = await db.Integration.findOne({
      where: {
        userId: req.authentication.user.id,
        provider: "notion",
      },
    });

    if (!notionIntegration) {
      return res.status(400).json({ error: "Notion not connected" });
    }

    const result = await getPageOrDatabase({
      accessToken: notionIntegration.accessToken,
      id,
    });

    if (!result) {
      return res.status(404).json({ error: "Page or database not found" });
    }

    return res.json(result);
  } catch (err) {
    console.error("[ERROR] Failed to fetch Notion page details:", err);
    return res.status(500).json({ error: err.message || "Failed to fetch page details" });
  }
}

