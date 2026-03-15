-- Adiciona colunas faltantes na tabela agendamentos já existente
ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS servico_nome text,
  ADD COLUMN IF NOT EXISTS mp_payment_id text,
  ADD COLUMN IF NOT EXISTS mp_qr_code text,
  ADD COLUMN IF NOT EXISTS mp_qr_code_b64 text,
  ADD COLUMN IF NOT EXISTS pagamento_status text,
  ADD COLUMN IF NOT EXISTS taxa_reserva numeric DEFAULT 0;

-- Index para busca pelo webhook
CREATE INDEX IF NOT EXISTS agendamentos_mp_payment_idx
  ON public.agendamentos (mp_payment_id)
  WHERE mp_payment_id IS NOT NULL;

-- Policy RLS se ainda não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agendamentos' AND policyname = 'agendamentos_own'
  ) THEN
    CREATE POLICY "agendamentos_own" ON public.agendamentos
      FOR ALL
      USING (auth.uid() = estabelecimento_id)
      WITH CHECK (auth.uid() = estabelecimento_id);
  END IF;
END
$$;
