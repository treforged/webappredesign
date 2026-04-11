-- Phase 3.1 addendum: pre-tax vs post-tax toggle per deduction
-- true (default) = pre-tax; false = post-tax (e.g. Roth 401k)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deduction_401k_pretax   BOOLEAN DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS deduction_hsa_pretax    BOOLEAN DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS deduction_fsa_pretax    BOOLEAN DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS deduction_medical_pretax BOOLEAN DEFAULT true NOT NULL;

COMMENT ON COLUMN public.profiles.deduction_401k_pretax   IS 'true=traditional pre-tax 401k; false=Roth post-tax';
COMMENT ON COLUMN public.profiles.deduction_hsa_pretax    IS 'HSA: true=pre-tax (typical), false=post-tax';
COMMENT ON COLUMN public.profiles.deduction_fsa_pretax    IS 'FSA: true=pre-tax (always), false=post-tax';
COMMENT ON COLUMN public.profiles.deduction_medical_pretax IS 'Medical ins: true=employer-sponsored pre-tax, false=post-tax';
