-- Adiciona coluna de duração na tabela agendamentos
ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS duracao_minutos integer DEFAULT 30;
