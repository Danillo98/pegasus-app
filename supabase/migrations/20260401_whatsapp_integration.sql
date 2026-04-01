-- ============================================================
-- Integração WhatsApp Business API — Pegasus
-- ============================================================

-- 1. Novas colunas em agendamentos
ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS origem           TEXT DEFAULT 'app',        -- 'app' | 'whatsapp'
  ADD COLUMN IF NOT EXISTS status_reserva   TEXT,                      -- 'pendente_pix' | 'confirmado' | 'recusado'
  ADD COLUMN IF NOT EXISTS nome_whatsapp    TEXT,                      -- nome digitado pelo cliente no WhatsApp
  ADD COLUMN IF NOT EXISTS telefone_cliente TEXT;                      -- número WhatsApp do cliente

-- 2. Novas colunas em estabelecimentos (configuração WhatsApp)
ALTER TABLE public.estabelecimentos
  ADD COLUMN IF NOT EXISTS whatsapp_token     TEXT,                    -- token de acesso Meta API
  ADD COLUMN IF NOT EXISTS whatsapp_phone_id  TEXT,                    -- Phone Number ID
  ADD COLUMN IF NOT EXISTS whatsapp_waba_id   TEXT,                    -- WhatsApp Business Account ID
  ADD COLUMN IF NOT EXISTS whatsapp_ativo     BOOLEAN DEFAULT FALSE;   -- integração ativa/inativa

-- 3. Nova tabela: controle de sessões de conversa WhatsApp
CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_estabelecimento   UUID NOT NULL REFERENCES public.estabelecimentos(id) ON DELETE CASCADE,
  telefone_cliente     TEXT NOT NULL,
  -- Etapas: inicio | selecionando_servicos | confirmando_mais_servicos |
  --         escolhendo_horario | informando_nome | confirmando_resumo |
  --         aguardando_confirmacao_pix | concluido | recusado | expirado
  etapa                TEXT NOT NULL DEFAULT 'inicio',
  servicos_ids         UUID[] DEFAULT '{}',           -- IDs dos serviços selecionados
  horario_selecionado  TIMESTAMPTZ,                   -- horário escolhido pelo cliente
  nome_cliente         TEXT,                          -- nome digitado pelo cliente
  pagina_servicos      INT DEFAULT 0,                 -- paginação (9 por página)
  ultima_interacao     TIMESTAMPTZ DEFAULT NOW(),     -- usado para timeout de 5 min
  criado_em            TIMESTAMPTZ DEFAULT NOW()
);

-- Index para busca rápida por estabelecimento + telefone
CREATE INDEX IF NOT EXISTS whatsapp_sessions_estab_tel_idx
  ON public.whatsapp_sessions (id_estabelecimento, telefone_cliente);

-- Index para o cron de limpeza de sessões expiradas
CREATE INDEX IF NOT EXISTS whatsapp_sessions_ultima_interacao_idx
  ON public.whatsapp_sessions (ultima_interacao);

-- 4. RLS na tabela de sessões
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_sessions_own" ON public.whatsapp_sessions
  FOR ALL
  USING (auth.uid() = id_estabelecimento)
  WITH CHECK (auth.uid() = id_estabelecimento);
