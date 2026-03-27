-- Migration: add paycheck_start_date to profiles
-- Apply manually in Supabase SQL Editor.
-- Safe to run multiple times (IF NOT EXISTS guard).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS paycheck_start_date date;
