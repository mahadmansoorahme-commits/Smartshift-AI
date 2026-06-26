-- ============================================================================
-- SmartShiftAI — Database schema
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
-- Safe to re-run (uses IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. user_settings  (replaces browser localStorage)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id       uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  wage          numeric     DEFAULT 15,
  shift_hours   numeric     DEFAULT 8,
  worker_ratio  integer     DEFAULT 40,
  business_name text        DEFAULT '',
  currency      text        DEFAULT '$',
  updated_at    timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. uploads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.uploads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  filename    text,
  row_count   integer,
  date_range  text,
  csv_path    text,
  uploaded_at timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. models
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.models (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  model_type text,
  accuracy   numeric,
  mae        numeric,
  rmse       numeric,
  model_path text,
  upload_id  uuid REFERENCES public.uploads (id) ON DELETE SET NULL,
  trained_at timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 4. forecasts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.forecasts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  label       text,
  predictions jsonb,
  peak_day    jsonb,
  model_id    uuid REFERENCES public.models (id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5. schedules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schedules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  workers_needed   integer,
  total_labor_cost numeric,
  shifts           jsonb,
  forecast_id      uuid REFERENCES public.forecasts (id) ON DELETE SET NULL,
  created_at       timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 6. cost_analyses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cost_analyses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  predicted_cost numeric,
  actual_cost    numeric,
  savings        numeric,
  savings_pct    numeric,
  schedule_id    uuid REFERENCES public.schedules (id) ON DELETE SET NULL,
  created_at     timestamptz DEFAULT now()
);

-- ============================================================================
-- Row Level Security — every user can only see/modify their OWN rows
-- ============================================================================
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uploads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.models        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forecasts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_analyses ENABLE ROW LEVEL SECURITY;

-- user_settings policies (PK is user_id)
DROP POLICY IF EXISTS "own settings" ON public.user_settings;
CREATE POLICY "own settings" ON public.user_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- uploads policies
DROP POLICY IF EXISTS "own uploads" ON public.uploads;
CREATE POLICY "own uploads" ON public.uploads
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- models policies
DROP POLICY IF EXISTS "own models" ON public.models;
CREATE POLICY "own models" ON public.models
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- forecasts policies
DROP POLICY IF EXISTS "own forecasts" ON public.forecasts;
CREATE POLICY "own forecasts" ON public.forecasts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- schedules policies
DROP POLICY IF EXISTS "own schedules" ON public.schedules;
CREATE POLICY "own schedules" ON public.schedules
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- cost_analyses policies
DROP POLICY IF EXISTS "own cost_analyses" ON public.cost_analyses;
CREATE POLICY "own cost_analyses" ON public.cost_analyses
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- Auto-create a user_settings row whenever a new user signs up
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- Helpful indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_uploads_user       ON public.uploads (user_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_models_user         ON public.models (user_id, trained_at DESC);
CREATE INDEX IF NOT EXISTS idx_forecasts_user      ON public.forecasts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_schedules_user      ON public.schedules (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_analyses_user  ON public.cost_analyses (user_id, created_at DESC);