DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'meeting_platform_enum'
  ) THEN
    CREATE TYPE meeting_platform_enum AS ENUM ('teams', 'zoom', 'webex', 'google_meet');
  END IF;
END $$;

ALTER TABLE meeting_artifacts
  ADD COLUMN IF NOT EXISTS "meetingPlatform" meeting_platform_enum,
  ADD COLUMN IF NOT EXISTS "meetingId" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "displayMeetingId" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "meetingUrl" TEXT;

