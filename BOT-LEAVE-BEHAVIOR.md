# Bot leave behavior when only notetakers remain

## What we send to Recall

The app sends **bot_detection** and (optionally) **automatic_leave** in the bot config when scheduling. Recall’s bot uses this to decide when to leave the meeting.

- **Bot detection**  
  - Detects other notetakers/bots by participant display names (e.g. “Fireflies.ai Notetaker”, “Otter”, “Notetaker”) and by behavior (no speaking/screen share).  
  - When it concludes that only bots remain, our bot disconnects after a short timeout to avoid duplicate notes.

- **Automatic leave** (if “Auto-leave when alone” is enabled in calendar settings)  
  - Uses `waiting_room_timeout`, `noone_joined_timeout`, and `everyone_left_timeout` so the bot leaves when alone or when everyone has left (by Recall’s participant count).

## Why the bot sometimes stayed (e.g. with Fireflies)

Previously, bot_detection **only started after 5 minutes** (`activate_after: 300`). So:

- If all humans left before 5 minutes (e.g. short test meeting), detection never ran.
- The bot would stay in the call with the other notetaker (e.g. Fireflies) and not leave.

So the “bot will leave when only notetakers remain” behavior only applied to meetings that had already been running for at least 5 minutes.

## Change made

- **activate_after** was reduced from **300 seconds (5 min)** to **90 seconds (~1.5 min)** for both:
  - name-based detection (participant names), and  
  - behavior-based detection (active_speaker / screen_share).

So now:

- After about 1.5 minutes, the bot starts checking whether the only other participants look like notetakers.
- If it detects only other notetakers (e.g. “Fireflies.ai Notetaker Gene”), it leaves after the usual short timeouts (10s for name-based, 30s for behavior-based).

Short meetings (e.g. “4 Feb Test Event”) where everyone leaves before 5 minutes should now see our bot leave instead of staying with Fireflies.

## Where it’s configured

- **recall/logic/bot-config.js**  
  - `bot_detection.using_participant_names.activate_after`  
  - `bot_detection.using_participant_events.activate_after`  
  - Both use the same constant (90 seconds). No calendar override yet; can be made configurable later if needed.

## Note on “Fireflies stayed”

If the **Fireflies** notetaker is still in the meeting after everyone left, that’s expected: we only control our own Recall bot. We can’t make Fireflies leave. The fix above only ensures **our** bot leaves when it detects that only other notetakers (like Fireflies) remain.
