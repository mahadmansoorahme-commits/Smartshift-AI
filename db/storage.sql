-- ============================================================================
-- SmartShiftAI — Storage bucket for user CSV uploads
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
-- (Safe to re-run.)
-- Files are stored at path:  {user_id}/{upload_id}.csv
-- ============================================================================

-- Private bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('user-uploads', 'user-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: each user can only touch files inside their own {user_id}/ folder.
DROP POLICY IF EXISTS "uploads read own"   ON storage.objects;
DROP POLICY IF EXISTS "uploads insert own" ON storage.objects;
DROP POLICY IF EXISTS "uploads update own" ON storage.objects;
DROP POLICY IF EXISTS "uploads delete own" ON storage.objects;

CREATE POLICY "uploads read own" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'user-uploads' AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "uploads insert own" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'user-uploads' AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "uploads update own" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'user-uploads' AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "uploads delete own" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'user-uploads' AND (storage.foldername(name))[1] = auth.uid()::text
  );
