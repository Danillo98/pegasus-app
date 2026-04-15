-- Adiciona a coluna agendamento_status para controle fino do ciclo de vida
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS agendamento_status TEXT DEFAULT 'Pendente';

-- Atualiza registros existentes baseando-se no pagamento_status
UPDATE agendamentos 
SET agendamento_status = CASE 
    WHEN pagamento_status = true THEN 'Confirmado'
    ELSE 'Pendente'
END
WHERE agendamento_status IS NULL OR agendamento_status = 'Pendente';
