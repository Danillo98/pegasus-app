-- Adiciona coluna valor_total na tabela agendamentos
ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS valor_total numeric DEFAULT 0;
