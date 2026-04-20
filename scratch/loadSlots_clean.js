    async function loadSlots() {
      const now = new Date();
      const end = new Date(now); end.setDate(end.getDate() + 21);

      // Working schedule from DB
      const diasFunc = state.estab.dias_funcionamento || [1,2,3,4,5,6];
      const [aberH, aberM] = (state.estab.horario_abertura || '09:00').split(':').map(Number);
      const [fechH, fechM] = (state.estab.horario_fechamento || '18:00').split(':').map(Number);
      const WORK_START_MIN = aberH * 60 + aberM;
      const WORK_END_MIN   = fechH * 60 + fechM;
      const pausasPadrao   = state.estab.pausas_padrao || [];

      // HELPER: Convert HH:mm to minutes
      function toMinutes(timeStr) {
        if (!timeStr) return null;
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
      }

      // 1. Fetch existing bookings (CORRECT COLUMN: agendamento_status)
      const { data: bookings } = await sb
        .from('agendamentos')
        .select('data_agendamento, hora_agendamento, agendamento_status, servico_id')
        .eq('estabelecimento_id', state.estabId)
        .not('agendamento_status', 'in', '("cancelado","recusado","excluido")');

      // 2. Fetch day-specific exceptions
      const startStr = now.toISOString().split('T')[0];
      const endStr   = end.toISOString().split('T')[0];
      const { data: excecoes } = await sb
        .from('excecoes_agenda')
        .select('*')
        .eq('estabelecimento_id', state.estabId)
        .gte('data_excecao', startStr)
        .lte('data_excecao', endStr);
      
      const excecoesMap = {}; 
      (excecoes || []).forEach(e => {
        if (!excecoesMap[e.data_excecao]) excecoesMap[e.data_excecao] = [];
        excecoesMap[e.data_excecao].push(e);
      });

      // 3. Calculate duration for current request
      const totalDuration = state.servicos
        .filter(s => state.selectedIds.has(s.id))
        .reduce((acc, s) => acc + (s.duracao_minutos || 30), 0) || 30;

      // 4. Pre-process existing bookings into busy ranges
      const dailyBusyRanges = {};
      (bookings || []).forEach(b => {
        const d = b.data_agendamento;
        if (!dailyBusyRanges[d]) dailyBusyRanges[d] = [];
        const start = toMinutes(b.hora_agendamento);
        const servico = state.servicos.find(s => s.id === b.servico_id);
        const dur = servico ? Number(servico.duracao_minutos || 30) : 30;
        dailyBusyRanges[d].push({ start, end: start + dur });
      });

      function isBlocked(cursor) {
        const dayKey = cursor.toISOString().split('T')[0];
        const curMin = cursor.getHours() * 60 + cursor.getMinutes();
        const dow    = cursor.getDay();
        const curEnd = curMin + totalDuration;

        // Block past times
        if (cursor.getTime() < (now.getTime() + 5 * 60000)) return true;

        if (!diasFunc.includes(dow)) return true;
        if (curMin < WORK_START_MIN || curEnd > WORK_END_MIN) return true;

        const dayBookings = dailyBusyRanges[dayKey] || [];
        for (const b of dayBookings) {
          if (curMin < b.end && curEnd > b.start) return true;
        }

        for (const p of pausasPadrao) {
          const ps = toMinutes(p.inicio);
          const pe = toMinutes(p.fim);
          if (ps !== null && pe !== null && curMin < pe && curEnd > ps) return true;
        }

        const dayExcecoes = excecoesMap[dayKey] || [];
        for (const exc of dayExcecoes) {
          if (exc.tipo === 'fechado_dia_todo') return true;
          if (exc.tipo === 'fechado_resto_do_dia') {
            const es = toMinutes(exc.inicio);
            if (es !== null && curMin >= es) return true;
          }
          if (exc.tipo === 'pausa') {
            const es = toMinutes(exc.inicio);
            const ee = toMinutes(exc.fim);
            if (es !== null && ee !== null && curMin < ee && curEnd > es) return true;
          }
        }
        return false;
      }

      const slots = [];
      let cursor = new Date(now);
      
      // Round to next 15-min interval
      const m = cursor.getMinutes();
      cursor.setMinutes(m % 15 === 0 ? m : m + (15 - (m % 15)), 0, 0);

      while (slots.length < 2 && cursor < end) {
        if (!isBlocked(cursor)) {
          slots.push(new Date(cursor));
        }
        cursor = new Date(cursor.getTime() + 15 * 60000);

        const curMin = cursor.getHours() * 60 + cursor.getMinutes();
        if (curMin >= WORK_END_MIN) {
          cursor.setDate(cursor.getDate() + 1);
          cursor.setHours(Math.floor(WORK_START_MIN / 60), WORK_START_MIN % 60, 0, 0);
        }
      }
      state.slots = slots;
    }
