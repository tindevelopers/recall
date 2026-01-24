-- Add recording metadata fields to meeting_artifacts
ALTER TABLE meeting_artifacts
  ADD COLUMN IF NOT EXISTS source_recording_url TEXT,
  ADD COLUMN IF NOT EXISTS source_recording_expiry TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_recording_url TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recording_format TEXT,
  ADD COLUMN IF NOT EXISTS recording_duration INTEGER,
  ADD COLUMN IF NOT EXISTS recording_size BIGINT;

-- Add storage configuration to calendars (S3-compatible)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'storage_provider_enum') THEN
    CREATE TYPE storage_provider_enum AS ENUM ('aws_s3', 'wasabi', 'backblaze', 'minio', 'custom');
  END IF;
END$$;

ALTER TABLE calendars
  ADD COLUMN IF NOT EXISTS storage_provider storage_provider_enum,
  ADD COLUMN IF NOT EXISTS storage_endpoint TEXT,
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT,
  ADD COLUMN IF NOT EXISTS storage_access_key TEXT,
  ADD COLUMN IF NOT EXISTS storage_secret_key TEXT,
  ADD COLUMN IF NOT EXISTS storage_region TEXT,
  ADD COLUMN IF NOT EXISTS auto_archive_recordings BOOLEAN NOT NULL DEFAULT FALSE;


