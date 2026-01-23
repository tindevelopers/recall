import { generateNotice } from "../utils.js";
import db from "../../db.js";
import { updateAutoRecordStatusForCalendarEvents } from "../../logic/autorecord.js";
import { queueBotScheduleJob } from "../../utils/queue-bot-schedule.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.redirect("/");
  } else {
    const calendar = await db.Calendar.findOne({
      where: {
        id: req.params.id,
        userId: req.authentication.user.id,
      },
    });
    if (calendar) {
      // html form payload does not include unchecked checkboxes, so we default to "off".
      const {
        autoRecordExternalEvents = "off",
        autoRecordInternalEvents = "off",
        autoRecordOnlyConfirmedEvents = "off",
        useRetellTranscription = "off",
        recordVideo = "off",
        recordAudio = "off",
        storageProvider,
        storageEndpoint,
        storageBucket,
        storageAccessKey,
        storageSecretKey,
        storageRegion,
        autoArchiveRecordings = "off",
      } = req.body || {};

      calendar.autoRecordExternalEvents = autoRecordExternalEvents === "on" ? true : false;
      calendar.autoRecordInternalEvents = autoRecordInternalEvents === "on" ? true : false;
      calendar.autoRecordOnlyConfirmedEvents = autoRecordOnlyConfirmedEvents === "on" ? true : false;
      calendar.useRetellTranscription = useRetellTranscription === "on" ? true : false;
      // Also handle recordVideo and recordAudio if provided (from settings page)
      // Settings form includes hidden inputs so these fields are always present when form is from settings page
      // Calendar page form doesn't include these fields, so they won't be in req.body
      // Note: When checkbox is checked, both checkbox ("on") and hidden input ("off") are sent
      // Express creates an array, so we need to check if "on" is in the array
      if ("recordVideo" in req.body) {
        const recordVideoValue = Array.isArray(req.body.recordVideo) 
          ? req.body.recordVideo.includes("on") ? "on" : "off"
          : req.body.recordVideo;
        calendar.recordVideo = recordVideoValue === "on";
      }
      if ("recordAudio" in req.body) {
        const recordAudioValue = Array.isArray(req.body.recordAudio)
          ? req.body.recordAudio.includes("on") ? "on" : "off"
          : req.body.recordAudio;
        calendar.recordAudio = recordAudioValue === "on";
      }

      // Storage configuration (optional)
      calendar.storageProvider = storageProvider || null;
      calendar.storageEndpoint = storageEndpoint || null;
      calendar.storageBucket = storageBucket || null;
      calendar.storageAccessKey = storageAccessKey || null;
      calendar.storageSecretKey = storageSecretKey || null;
      calendar.storageRegion = storageRegion || null;
      calendar.autoArchiveRecordings = autoArchiveRecordings === "on";

      // If provider not set, disable auto-archive
      if (!calendar.storageProvider || !calendar.storageBucket) {
        calendar.autoArchiveRecordings = false;
      }
      await calendar.save();
      // Verify by reloading from database
      await calendar.reload();
      
      res.cookie(
        "notice",
        JSON.stringify(
          generateNotice(
            "success",
            `Calendar(ID: ${calendar.id}, email: ${calendar.email}) recording preferences updated successfully.`
          )
        )
      );

      const [webhooks, events] = await Promise.all([
        calendar.getCalendarWebhooks({
          order: [["receivedAt", "DESC"]],
        }),
        // todo: filter out events that have ended/ongoing
        calendar.getCalendarEvents(),
      ]);

      await updateAutoRecordStatusForCalendarEvents({ calendar, events });
      for (const event of events) {
        await queueBotScheduleJob(event.recallId, calendar.id);
      }

      return res.redirect(`/calendar/${calendar.id}`);
    } else {
      return res.render("404.ejs", {
        notice: req.notice,
      });
    }
  }
};
