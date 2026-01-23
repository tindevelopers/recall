-- Add owner tracking to meeting_artifacts
-- The ownerUserId is the primary owner (usually the meeting organizer)
-- The existing userId field becomes the "creator" (who triggered the recording)
ALTER TABLE meeting_artifacts 
ADD COLUMN IF NOT EXISTS "ownerUserId" UUID REFERENCES users(id);

-- Backfill ownerUserId from userId for existing records
UPDATE meeting_artifacts 
SET "ownerUserId" = "userId" 
WHERE "ownerUserId" IS NULL AND "userId" IS NOT NULL;

-- Create meeting_shares table for tracking shared access
CREATE TABLE IF NOT EXISTS meeting_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "meetingArtifactId" UUID NOT NULL REFERENCES meeting_artifacts(id) ON DELETE CASCADE,
    "sharedWithUserId" UUID REFERENCES users(id) ON DELETE CASCADE,
    "sharedWithEmail" VARCHAR(255),
    "sharedByUserId" UUID NOT NULL REFERENCES users(id),
    "accessLevel" VARCHAR(20) NOT NULL DEFAULT 'view' CHECK ("accessLevel" IN ('view', 'edit', 'admin')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
    "acceptedAt" TIMESTAMP WITH TIME ZONE,
    "expiresAt" TIMESTAMP WITH TIME ZONE,
    "notifyOnUpdates" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Either sharedWithUserId or sharedWithEmail must be set
    CONSTRAINT share_target_required CHECK (
        "sharedWithUserId" IS NOT NULL OR "sharedWithEmail" IS NOT NULL
    )
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_meeting_shares_artifact ON meeting_shares("meetingArtifactId");
CREATE INDEX IF NOT EXISTS idx_meeting_shares_user ON meeting_shares("sharedWithUserId");
CREATE INDEX IF NOT EXISTS idx_meeting_shares_email ON meeting_shares("sharedWithEmail");
CREATE INDEX IF NOT EXISTS idx_meeting_shares_status ON meeting_shares(status);

-- Unique constraint: can't share same meeting twice with same user
CREATE UNIQUE INDEX IF NOT EXISTS unique_meeting_user_share 
ON meeting_shares("meetingArtifactId", "sharedWithUserId") 
WHERE "sharedWithUserId" IS NOT NULL;

-- Unique constraint: can't share same meeting twice with same email
CREATE UNIQUE INDEX IF NOT EXISTS unique_meeting_email_share 
ON meeting_shares("meetingArtifactId", "sharedWithEmail") 
WHERE "sharedWithEmail" IS NOT NULL;

-- Add index on ownerUserId for efficient owner lookups
CREATE INDEX IF NOT EXISTS idx_meeting_artifacts_owner ON meeting_artifacts("ownerUserId");

-- Comment on the design
COMMENT ON TABLE meeting_shares IS 'Tracks shared access to meeting artifacts. Owner can share with users or email addresses.';
COMMENT ON COLUMN meeting_artifacts."ownerUserId" IS 'Primary owner of the meeting (usually the organizer). Has full control over sharing.';
COMMENT ON COLUMN meeting_shares."accessLevel" IS 'view = read-only, edit = can add notes/comments, admin = can reshare with others';
COMMENT ON COLUMN meeting_shares.status IS 'pending = awaiting acceptance, accepted = active share, declined = user declined, revoked = owner revoked';

