-- Remove a coluna da tabela servicos caso exista
ALTER TABLE public.servicos
  DROP COLUMN IF EXISTS chave_pix;

-- Adiciona a coluna chave_pix à tabela estabelecimentos
ALTER TABLE public.estabelecimentos
  ADD COLUMN IF NOT EXISTS chave_pix text;
