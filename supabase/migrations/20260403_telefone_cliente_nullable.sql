-- ============================================================
-- Migration: Torna telefone_cliente nullable
-- Agendamentos via web não têm telefone disponível no contexto
-- EXECUTE NO SUPABASE > SQL Editor
-- ============================================================

ALTER TABLE public.agendamentos
  ALTER COLUMN telefone_cliente DROP NOT NULL;

-- Garante que as colunas usadas pelo agendamento web existem
ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS cliente_nome text,
  ADD COLUMN IF NOT EXISTS data_agendamento date,
  ADD COLUMN IF NOT EXISTS hora_agendamento time,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'confirmado';
