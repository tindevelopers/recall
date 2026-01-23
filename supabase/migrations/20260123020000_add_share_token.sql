-- Add shareToken to meeting_shares for public shareable links
ALTER TABLE meeting_shares 
ADD COLUMN IF NOT EXISTS "shareToken" VARCHAR(64) UNIQUE;

-- Create index for efficient token lookups
CREATE INDEX IF NOT EXISTS idx_meeting_shares_token ON meeting_shares("shareToken") 
WHERE "shareToken" IS NOT NULL;

-- Comment on the new field
COMMENT ON COLUMN meeting_shares."shareToken" IS 'Unique token for public shareable link. Allows viewing meeting without login.';

