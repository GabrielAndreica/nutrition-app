-- Migration: Add server-side workout session persistence
-- Run this in Supabase SQL Editor (or via psql)
--
-- Stores the in-progress workout session as JSONB on the users row.
-- Shape: { focus, exercises, currentIndex, xpEarned, startedAt }
-- NULL means no active session.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS active_workout_session JSONB DEFAULT NULL;

-- Optional index for faster lookup (not strictly needed, sessions are fetched by user id)
-- CREATE INDEX IF NOT EXISTS idx_users_active_workout_session
--   ON users USING GIN (active_workout_session)
--   WHERE active_workout_session IS NOT NULL;
