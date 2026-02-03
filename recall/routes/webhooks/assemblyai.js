import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";

function isValidSecret(req) {
  const expected = process.env.ASSEMBLYAI_WEBHOOK_SECRET;
  if (!expected) return true;
  const headerName =
    (process.env.ASSEMBLYAI_WEBHOOK_HEADER_NAME || "x-assemblyai-webhook-secret").toLowerCase();
  const received = req.headers[headerName];
  return typeof received === "string" && received === expected;
}

export default async (req, res) => {
  if (!isValidSecret(req)) {
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  const transcriptId = req.body?.id;
  const status = req.body?.status;

  if (!transcriptId) {
    return res.status(400).json({ error: "Missing transcript id" });
  }

  try {
    const analysis = await db.MeetingSuperAgentAnalysis.findOne({
      where: { assemblyTranscriptId: transcriptId },
      order: [["createdAt", "DESC"]],
    });

    if (!analysis) {
      return res.sendStatus(204);
    }

    if (status === "error") {
      await analysis.update({
        status: "error",
        errorMessage: req.body?.error || "AssemblyAI transcription failed",
      });
      return res.sendStatus(200);
    }

    if (status !== "completed") {
      return res.sendStatus(200);
    }

    await backgroundQueue.add(
      "meeting.super_agent.complete",
      { analysisId: analysis.id, transcriptId },
      {
        jobId: `super-agent-complete-${analysis.id}`,
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    return res.sendStatus(200);
  } catch (error) {
    console.error("[AssemblyAI Webhook] Failed:", error);
    return res.sendStatus(500);
  }
};
