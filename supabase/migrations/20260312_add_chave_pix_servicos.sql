-- Adiciona a coluna chave_pix à tabela servicos
ALTER TABLE public.servicos
  ADD COLUMN IF NOT EXISTS chave_pix text;
