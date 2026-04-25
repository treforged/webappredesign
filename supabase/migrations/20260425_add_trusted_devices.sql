-- Add trusted_devices column to profiles for remembered-device 2FA skip
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS trusted_devices jsonb DEFAULT '[]'::jsonb;
