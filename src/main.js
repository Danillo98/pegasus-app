import './style.css'
import { supabase } from './supabase.js'

// --- GUARDA DE SEGURANÇA: BLOQUEAR LOGIN AUTOMÁTICO EM RECUPERAÇÃO/RESET ---
async function clearAuthLoop() {
  const url = window.location.href;
  if (url.includes('reset=success') || url.includes('type=recovery') || url.includes('access_token')) {
    // Se estivermos na página principal, forçar limpeza total
    if (!window.location.pathname.includes('reset-password.html')) {
        await supabase.auth.signOut();
        localStorage.clear();
        sessionStorage.clear();
        // Se for token de recuperação, manda para a página de reset
        if (url.includes('access_token')) {
           window.location.replace('/reset-password.html' + window.location.hash);
           return true; 
        }
        // Se for sucesso de reset, limpa a URL e mostra login
        window.history.replaceState({}, document.title, '/');
    }
  }
  return false;
}
const isRedirecting = await clearAuthLoop();
if (isRedirecting) throw new Error("Redirecting to reset page..."); // Trava execução do resto do módulo

function formatPhone(value) {
  if (!value) return ""
  value = value.replace(/\D/g, '')
  value = value.slice(0, 11)
  if (value.length > 10) {
    return value.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3")
  } else if (value.length > 6) {
    return value.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3")
  } else if (value.length > 2) {
    return value.replace(/(\d{2})(\d{0,5})/, "($1) $2")
  } else if (value.length > 0) {
    return value.replace(/(\d{0,2})/, "($1")
  }
  return value
}

function hasTimePassed(slotTime, selectedDate) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const selDateOnly = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
  
  if (selDateOnly < today) return true;
  if (selDateOnly > today) return false;
  
  const [h, m] = slotTime.split(':').map(Number);
  const slotDate = new Date();
  slotDate.setHours(h, m, 0, 0);
  
  return now > slotDate;
}

// ---- Mercado Pago OAuth callback handler ----
// Runs on every page load, detects the ?code= redirect from MP
async function handleMpCallback() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state') // contains user_id

  if (!code || !state) return

  // Clean URL immediately so user doesn't see query params
  window.history.replaceState({}, document.title, window.location.pathname)

  // Show loading state
  document.body.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:1rem; font-family:system-ui;">
      <div style="width:48px; height:48px; border:4px solid #e5e7eb; border-top-color:#009ee3; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
      <p style="font-weight:700; color:#374151;">Conectando com Mercado Pago...</p>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    </div>`

  try {
    // Get current session to pass JWT
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { window.location.reload(); return }

    const res = await fetch(
      'https://fdoecadsyvbhjgasdbxk.supabase.co/functions/v1/mp-oauth',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ code, user_id: state }),
      }
    )

    const result = await res.json()

    if (result.success) {
      // Reload user to get fresh metadata
      const { data: { user } } = await supabase.auth.getUser()
      if (user) appState.user = user
      appState.mpConnectSuccess = true

      // Resume pending agendamento if any
      const pendingRaw = localStorage.getItem('mp_pending_agendamento')
      if (pendingRaw) {
        try {
          const pending = JSON.parse(pendingRaw)
          localStorage.removeItem('mp_pending_agendamento')
          // Since we are early in the boot sequence, we might need a slight delay
          // or just wait for render first. Let's do it after render.
          setTimeout(() => {
            criarAgendamentoComPix(pending)
          }, 500)
        } catch(e) { console.error('Error parsing pending agendamento', e) }
      }

    } else {
      console.error('MP OAuth failed:', result)
      appState.mpConnectError = result.error || 'Erro desconhecido'
    }
  } catch (e) {
    console.error('MP callback error:', e)
    appState.mpConnectError = String(e)
  }

  render()
}
// ---------------------------------------------

window.alert = function(message) {
  let finalMessage = message;

  // Translation dict for common Supabase/Auth errors
  const errorTranslations = {
    'password should be at least 6 characters.': 'A senha deve conter no mínimo 6 caracteres.',
    'invalid login credentials': 'E-mail ou senha incorretos.',
    'user already registered': 'Já existe uma conta com este e-mail.',
    'email not confirmed': 'Confirme seu e-mail na caixa de entrada antes de entrar.',
    'missing email or phone': 'Por favor, insira um e-mail válido.',
    'signup requires a valid password': 'A senha informada é inválida.',
    'to security purposes, you can only request this': 'Por segurança, tente novamente mais tarde.'
  };

  for (const [eng, pt] of Object.entries(errorTranslations)) {
    if (finalMessage.toLowerCase().includes(eng)) {
      // Retain the "Erro: " prefix if it was passed, but format nicely
      finalMessage = finalMessage.startsWith('Erro:') ? `Erro: ${pt}` : pt;
      break;
    }
  }

  let title = 'Aviso';
  let color = '#3b82f6'; // Azul padrão (Info)
  let icon = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  
  const msgLower = finalMessage.toLowerCase();
  
  if (msgLower.includes('erro') || msgLower.includes('preencha') || msgLower.includes('coincidem') || msgLower.includes('desative')) {
    title = 'Atenção!';
    color = '#dc2626'; // Vermelho
    icon = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  } else if (msgLower.includes('sucesso') || msgLower.includes('enviado') || msgLower.includes('concluído') || msgLower.includes('salvo') || msgLower.includes('catálogo')) {
    title = 'Sucesso!';
    color = '#16a34a'; // Verde
    icon = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  }

  appState.customAlert = { title, message: finalMessage, color, icon };
  render();
};

// State
let appState = {
  theme: 'barbearia',
  screen: 'login', // 'login', 'dashboard', etc.
  loginSubScreen: 'default', // 'default', 'forgot', 'register'
  user: null,
  customAlert: null,
  mpConnectSuccess: false,
  mpConnectError: null,
  selectedDate: new Date(),
  viewingDate: new Date(), // For calendar navigation
  showModal: null,
  activeAgendaItem: null,
  agendaData: {},
  excecoesDia: [], // pauses / blocks for current day from excecoes_agenda table
  pixModal: null, // { qr_code, qr_code_b64, ticket_url, valor, agendamento_id }
  pendingAgendamento: null, // temp storage while waiting for MP token setup
  selectedAssinatura: 'mensal', // 'mensal' or 'anual'
  previousScreen: null,
  financasData: {
    month: new Date().getMonth(),
    year: new Date().getFullYear(),
    filterByDay: false, // Toggle for filtering list by selectedDate
    categoryFilter: 'Todos', // 'Todos', 'Entradas', 'Fixas', 'Variáveis'
    activeTransaction: null,
    tempDate: new Date().toISOString().split('T')[0],
    transactions: [],
    loaded: false
  },
  servicosAtivos: [],
  servicosLoaded: false,
  agendaLoaded: false,
  registrationData: { nome: '', telefone: '', endereco: '', email: '', senha: '', conf: '' },
  editingServicoId: null,
  editingServicoForm: {},
  deletingServicoId: null,
  calendarContext: null, // 'financas', 'new-transaction', 'edit-transaction'
  servicosForm: {
    name: '',
    price: '',
    duration: '00:00',
    chargeReserva: false,
    reservaValue: ''
  },
}
window.appState = appState;

function getAgendaDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function getInitialDayData() {
  return [
    { time: '09:00', client: 'Disponível', service: '', status: 'livre' },
    { time: '10:00', client: 'Disponível', service: '', status: 'livre' },
    { time: '11:00', client: 'Disponível', service: '', status: 'livre' },
    { time: '12:00', client: 'Disponível', service: '', status: 'livre' },
    { time: '13:00', client: 'Disponível', service: '', status: 'livre' },
    { time: '14:00', client: 'Disponível', service: '', status: 'livre' },
    { time: '15:00', client: 'Disponível', service: '', status: 'livre' },
    { time: '16:00', client: 'Disponível', service: '', status: 'livre' },
    { time: '17:00', client: 'Disponível', service: '', status: 'livre' },
    { time: '18:00', client: 'Disponível', service: '', status: 'livre' },
  ]
}

function formatDate(date) {
  const today = new Date();
  const options = { day: '2-digit', month: 'long' };
  const dateStr = date.toLocaleDateString('pt-BR', options);

  const d = new Date(date);
  const isToday = d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();

  return isToday ? `HOJE, ${dateStr.toUpperCase()}` : dateStr.toUpperCase();
}

// Icons (Lucide implementation via SVG strings)
const icons = {
  agenda: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-calendar-days"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/></svg>',
  financas: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-banknote"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01"/><path d="M18 12h.01"/></svg>',
  servicos: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-scissors"><circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/><path d="M8.12 15.88 16 8"/><path d="M20 4 8.12 15.88"/></svg>',
  assinaturas: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-credit-card"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>',
  back: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-left"><path d="m15 18-6-6 6-6"/></svg>',
  plus: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  search: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  up: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trending-up"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
  down: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trending-down"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>',
  print: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-printer"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>',
  edit: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pencil"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
  trash: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>',
  calendar: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-calendar-days"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/></svg>',
  suporte: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-headset"><path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z"/><path d="M21 16v2a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z"/></svg>',
  whatsapp: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.414 0 .018 5.396.015 12.035c0 2.123.554 4.197 1.604 6.023L0 24l6.135-1.61a11.757 11.757 0 005.91 1.583h.005c6.637 0 12.032-5.397 12.035-12.035a11.794 11.794 0 00-3.483-8.497"/></svg>',
}

async function syncAgendaData() {
  if (!appState.user) return;
  
  // 1) Load profile schedule settings
  const { data: prof } = await supabase.from('estabelecimentos')
    .select('dias_funcionamento, horario_abertura, horario_fechamento, pausas_padrao, chave_pix')
    .eq('id', appState.user.id).single();
    
  if (prof) {
    appState.profile = { ...(appState.profile || {}), ...prof };
    if (!prof.dias_funcionamento || prof.dias_funcionamento.length === 0) {
      appState.showModal = 'horario-funcionamento';
    }
  }

  // 2) Load booked appointments
  const { data } = await supabase.from('agendamentos')
    .select('*')
    .eq('estabelecimento_id', appState.user.id)
    .neq('agendamento_status', 'Concluído')
    .order('hora_agendamento', { ascending: true });

  if (data) {
    appState.agendaData = {};
    data.forEach(dbItem => {
      const dayKey = dbItem.data_agendamento;
      if (!appState.agendaData[dayKey]) appState.agendaData[dayKey] = [];
      appState.agendaData[dayKey].push({
        id: dbItem.id,
        time: dbItem.hora_agendamento?.slice(0, 5),
        client: dbItem.cliente_nome || 'Cliente',
        service: dbItem.servico_nome,
        status: (dbItem.agendamento_status || 'Pendente').toLowerCase(),
        valor_total: dbItem.valor_total
      });
    });
  }

  // 3) Load today's exceptions
  const todayKey = getAgendaDayKey(new Date());
  const { data: exc } = await supabase.from('excecoes_agenda').select('*')
    .eq('estabelecimento_id', appState.user.id)
    .eq('data_excecao', todayKey);
  if (exc) appState.excecoesDia = exc;

  appState.agendaLoaded = true;
  window._lastAgendaSync = Date.now();
}

let _ptr = { active: false, startY: 0, threshold: 80 };

function attachAgendaEvents() {
  const btnWA = document.getElementById('btn-whatsapp-business')
  if (btnWA) {
    btnWA.addEventListener('click', () => {
      appState.showModal = 'whatsapp'
      render()
    })
  }

  const container = document.getElementById('ptr-container')
  if (!container) return

  container.addEventListener('touchstart', (e) => {
    if (container.scrollTop <= 0) {
      _ptr.active = true
      _ptr.startY = e.touches[0].pageY
    }
  }, { passive: true })

  container.addEventListener('touchmove', (e) => {
    if (!_ptr.active) return
    const y = e.touches[0].pageY
    const dist = y - _ptr.startY
    if (dist > 0) {
      const el = document.getElementById('ptr-indicator')
      if (el) {
        el.style.display = 'flex'
        const h = Math.min(dist * 0.5, _ptr.threshold)
        el.style.height = h + 'px'
        el.style.opacity = Math.min(h / _ptr.threshold, 1)
        const span = el.querySelector('span')
        const spinner = document.getElementById('ptr-spinner')
        if (h >= _ptr.threshold - 10) {
          span.textContent = '↑ Solte para atualizar'
          if(spinner) spinner.style.animation = 'spin 0.8s linear infinite'
        } else {
          span.textContent = '↓ Puxe para atualizar'
          if(spinner) spinner.style.animation = 'none'
        }
      }
    }
  }, { passive: true })

  container.addEventListener('touchend', async () => {
    if (!_ptr.active) return
    _ptr.active = false
    const el = document.getElementById('ptr-indicator')
    if (el && el.offsetHeight >= _ptr.threshold - 15) {
      el.querySelector('span').textContent = 'Sincronizando...'
      await syncAgendaData()
      render()
    } else if (el) {
      el.style.height = '0'
      el.style.opacity = '0'
      setTimeout(() => { el.style.display = 'none' }, 200)
    }
  })

  // Re-attach other agenda-specific listeners
  const btnCalendar = document.getElementById('btn-calendar-trigger')
  if (btnCalendar) {
    btnCalendar.addEventListener('click', () => {
      appState.showModal = 'calendar'
      render()
    })
  }

  const btnOpenModal = document.getElementById('btn-open-agenda-modal')
  if (btnOpenModal) {
    btnOpenModal.addEventListener('click', () => {
      appState.showModal = 'new-agendamento'
      render()
    })
  }

  const btnEditHorario = document.getElementById('btn-edit-horario')
  if (btnEditHorario) {
    btnEditHorario.addEventListener('click', () => {
      appState.showModal = 'horario-funcionamento'
      render()
    })
  }

  const btnPausa = document.getElementById('btn-fazer-pausa')
  if (btnPausa) {
    btnPausa.addEventListener('click', () => {
      appState.showModal = 'fazer-pausa'
      render()
    })
  }

  const btnManPausa = document.getElementById('btn-gerenciar-pausa')
  if (btnManPausa) {
    btnManPausa.addEventListener('click', () => {
      appState.showModal = 'gerenciar-pausa'
      render()
    })
  }

  document.querySelectorAll('.agenda-item').forEach(el => {
    el.addEventListener('click', (e) => {
      // Ignore click if it was on action buttons
      if (e.target.closest('.btn-ag-accept') || e.target.closest('.btn-ag-reject')) return;

      const idx = parseInt(el.dataset.index)
      const dayKey = getAgendaDayKey(appState.selectedDate)
      appState.activeAgendaItem = appState.agendaData[dayKey][idx]
      appState.showModal = 'agenda-actions'
      render()
    })
  })

  document.querySelectorAll('.btn-ag-accept').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const { error } = await supabase.from('agendamentos').update({ 
        agendamento_status: 'Confirmado', 
        pagamento_status: true 
      }).eq('id', id);
      
      if (!error) {
         // Optimistic UI: update local state
         const dayKey = getAgendaDayKey(appState.selectedDate);
         const item = appState.agendaData[dayKey].find(i => i.id == id);
         if (item) { item.status = 'confirmado'; item.pagamento_status = true; }
         render();
      } else {
         alert('Erro ao confirmar: ' + error.message);
      }
    });
  });

  document.querySelectorAll('.btn-ag-reject').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const dayKey = getAgendaDayKey(appState.selectedDate);
      const clickedItem = appState.agendaData[dayKey].find(i => i.id == id);
      if (clickedItem) {
        appState.activeAgendaItem = clickedItem;
        appState.showModal = 'confirm-cancel';
        render();
      }
    });
  });

  attachGenericBack()
}

function render() {
  const root = document.getElementById('app')
  document.body.className = `mode-${appState.theme}`

  // Only scroll to top if screen actually changed
  if (appState.previousScreen !== appState.screen) {
    window.scrollTo(0, 0)
    appState.previousScreen = appState.screen
    
    // Always sync when entering agenda for maximum accuracy
    if (appState.screen === 'agenda') {
      syncAgendaData().then(render);
    }
  }

  // Auto-fetch servicos
  if (appState.screen === 'servicos' && !appState.servicosLoaded && appState.user) {
    supabase.from('servicos').select('*').eq('estabelecimento_id', appState.user.id).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) appState.servicosAtivos = data;
        appState.servicosLoaded = true;
        render();
      })
  }

  // Auto-fetch financas
  if (appState.screen === 'financas' && !appState.financasData.loaded && appState.user) {
    supabase.from('transacoes_financeiras').select('*').eq('estabelecimento_id', appState.user.id).order('data_transacao', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) appState.financasData.transactions = data.map(dbTransToLocal);
        appState.financasData.loaded = true;
        render();
      })
  }

  switch (appState.screen) {
    case 'login':
      root.innerHTML = renderLogin()
      attachLoginEvents()
      break
    case 'dashboard':
      root.innerHTML = renderDashboard()
      attachDashboardEvents()
      break
    case 'agenda':
      root.innerHTML = renderAgenda()
      attachAgendaEvents()
      break
    case 'financas':
      root.innerHTML = renderFinancas()
      attachFinancasEvents()
      break
    case 'servicos':
      root.innerHTML = renderServicos()
      attachServicosEvents()
      break
    case 'assinaturas':
      root.innerHTML = renderAssinaturas()
      attachAssinaturasEvents()
      break
    case 'suporte':
      root.innerHTML = renderSupport()
      attachSupportEvents()
      break
  }

  if (appState.showModal === 'confirm-logout') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = `
      <div class="card animate-fade-in" style="max-width:400px; width:92%; padding:2.5rem; text-align:center; border-radius:1.5rem;">
        <div style="width:70px; height:70px; background:#fee2e2; color:#dc2626; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 1.5rem; font-size:2rem; font-weight:900;">🚪</div>
        <h2 style="font-family:var(--font-alt); font-size:1.2rem; font-weight:900; margin-bottom:1rem;">SAIR DA CONTA?</h2>
        <p style="color:var(--text-secondary); margin-bottom:2rem; line-height:1.5;">Deseja realmente sair da sua conta?</p>
        <div class="flex flex-col gap-sm">
          <button id="btn-do-logout" style="width:100%; padding:1.1rem; border-radius:1rem; background:#dc2626; color:white; font-weight:900; letter-spacing:0.5px; border:none; cursor:pointer;">SIM, SAIR</button>
          <button id="btn-cancel-logout" style="width:100%; padding:1.1rem; border-radius:1rem; background:var(--surface-hover); color:var(--text-main); font-weight:900; letter-spacing:0.5px; border:none; cursor:pointer;">CANCELAR</button>
        </div>
      </div>
    `
    root.appendChild(modalOverlay)

    document.getElementById('btn-cancel-logout').addEventListener('click', () => {
      appState.showModal = null
      render()
    })
    document.getElementById('btn-do-logout').addEventListener('click', async () => {
      await supabase.auth.signOut()
      appState.user = null
      appState.screen = 'login'
      appState.showModal = null
      render()
    })
  }

  if (appState.showModal === 'new-agendamento') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = renderNewAgendamentoModal()
    root.appendChild(modalOverlay)
    attachNewAgendamentoEvents()
  }

  if (appState.showModal === 'calendar') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = renderCalendarModal()
    root.appendChild(modalOverlay)
    attachCalendarModalEvents()
  }

  if (appState.showModal === 'agenda-actions') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = renderAgendaActionsModal()
    root.appendChild(modalOverlay)
    attachAgendaActionsEvents()
  }

  if (appState.showModal === 'quick-book') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = renderQuickBookModal()
    root.appendChild(modalOverlay)
    attachQuickBookEvents()
  }
  if (appState.showModal === 'horario-funcionamento') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = renderHorarioFuncionamentoModal()
    root.appendChild(modalOverlay)
    attachHorarioFuncionamentoEvents()
  }

  if (appState.showModal === 'whatsapp') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = renderWhatsAppModal()
    root.appendChild(modalOverlay)
    attachWhatsAppEvents()
  }

  if (appState.showModal === 'fazer-pausa') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = renderFazPausaModal()
    root.appendChild(modalOverlay)
    attachFazPausaEvents()
  }

  if (appState.showModal === 'gerenciar-pausa') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = renderGerenciarPausaModal()
    root.appendChild(modalOverlay)
    attachGerenciarPausaEvents()
  }

  if (appState.showModal === 'print-options') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = renderPrintOptionsModal()
    root.appendChild(modalOverlay)
    attachPrintOptionsEvents()
  }

  if (appState.showModal === 'report-view') {
    const reportFull = document.createElement('div')
    reportFull.style = "position: fixed; inset: 0; background: white; z-index: 20000; overflow-y: auto;"
    reportFull.innerHTML = appState.reportType === 'monthly' ? renderMonthlyReport() : renderAnnualReport()
    root.appendChild(reportFull)
    attachReportViewEvents()
  }

  if (appState.showModal === 'new-transaction') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = renderNewTransactionModal()
    root.appendChild(modalOverlay)
    attachNewTransactionEvents()
  }

  if (appState.showModal === 'edit-transaction') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = renderEditTransactionModal()
    root.appendChild(modalOverlay)
    attachEditTransactionEvents()
  }

  if (appState.showModal === 'delete-confirm') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = renderDeleteConfirmModal()
    root.appendChild(modalOverlay)
    attachDeleteConfirmEvents()
  }

  if (appState.showModal === 'delete-servico') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = `
      <div class="card animate-fade-in" style="max-width: 380px; width: 90%; padding: 2rem; text-align: center;">
        <div style="width:60px; height:60px; background:#dc2626; color:white; border-radius:50%; display:flex; align-items:center; justify-content:center; margin: 0 auto 1rem;">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </div>
        <h3 style="font-size: 1.4rem; font-weight: 800; margin-bottom: 0.5rem;">Excluir Serviço?</h3>
        <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">Esta ação não pode ser desfeita. O serviço será removido permanentemente.</p>
        <div class="flex gap-sm w-full">
          <button id="btn-cancel-delete-servico" style="flex:1; border:1.5px solid var(--border); color:var(--text-secondary); padding:1rem; border-radius:0.5rem; font-weight:800;">CANCELAR</button>
          <button id="btn-confirm-delete-servico" style="flex:1; background:#dc2626; color:white; padding:1rem; border-radius:0.5rem; font-weight:800;">EXCLUIR</button>
        </div>
      </div>
    `
    root.appendChild(modalOverlay)

    document.getElementById('btn-cancel-delete-servico').addEventListener('click', () => {
      appState.showModal = null
      appState.deletingServicoId = null
      render()
    })
    document.getElementById('btn-confirm-delete-servico').addEventListener('click', () => {
      const id = appState.deletingServicoId
      
      // Optimistic delete
      appState.servicosAtivos = appState.servicosAtivos.filter(s => s.id !== id)
      appState.showModal = null
      appState.deletingServicoId = null
      render()

      supabase.from('servicos').delete().eq('id', id).then(({ error }) => {
        if (error) {
          alert('Erro ao sincronizar exclusão: ' + error.message)
        }
      })
    })
  }
  if (appState.showModal === 'confirm-delete-trans') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = `
      <div class="card animate-fade-in" style="max-width:380px; width:92%; padding:2.5rem; text-align:center; border-radius:1.5rem;">
        <div style="width:70px; height:70px; background:#fee2e2; color:#dc2626; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 1.5rem; font-size:2rem; font-weight:900;">🗑️</div>
        <h2 style="font-family:var(--font-alt); font-size:1.3rem; font-weight:900; margin-bottom:1rem;">EXCLUIR TRANSAÇÃO?</h2>
        <p style="color:var(--text-secondary); margin-bottom:2rem; line-height:1.5;">Deseja realmente excluir esta transação? Esta ação não pode ser desfeita.</p>
        <div class="flex flex-col gap-sm">
          <button id="btn-do-delete-trans" style="width:100%; padding:1.1rem; border-radius:1rem; background:#dc2626; color:white; font-weight:900; letter-spacing:1px; border:none; cursor:pointer;">SIM, EXCLUIR</button>
          <button id="btn-cancel-delete-trans" style="width:100%; padding:1.1rem; border-radius:1rem; background:var(--surface-hover); color:var(--text-main); font-weight:900; letter-spacing:1px; border:none; cursor:pointer;">CANCELAR</button>
        </div>
      </div>
    `
    root.appendChild(modalOverlay)
    
    document.getElementById('btn-cancel-delete-trans').addEventListener('click', () => {
      appState.showModal = null
      render()
    })
    document.getElementById('btn-do-delete-trans').addEventListener('click', () => {
      const dbId = appState.financasData.pendingDeleteId
      
      // Optimistic delete
      appState.financasData.transactions = appState.financasData.transactions.filter(t => t.id !== dbId)
      appState.showModal = null
      render()

      supabase.from('transacoes_financeiras').delete().eq('id', dbId).then(({ error }) => {
        if (error) alert('Erro ao sincronizar exclusão: ' + error.message)
      })
    })
  }

  if (appState.showModal === 'confirm-reverse-trans') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = `
      <div class="card animate-fade-in" style="max-width:400px; width:92%; padding:2.5rem; text-align:center; border-radius:1.5rem;">
        <div style="width:70px; height:70px; background:#e0e7ff; color:#4338ca; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 1.5rem; font-size:2rem; font-weight:900;">🔄</div>
        <h2 style="font-family:var(--font-alt); font-size:1.2rem; font-weight:900; margin-bottom:1rem;">ESTORNAR TRANSAÇÃO?</h2>
        <p style="color:var(--text-secondary); margin-bottom:2rem; line-height:1.5;">Esta ação removerá o valor do caixa e o <strong>agendamento voltará a ficar Pendente</strong> no dia original da reserva.</p>
        <div class="flex flex-col gap-sm">
          <button id="btn-do-reverse-trans" style="width:100%; padding:1.1rem; border-radius:1rem; background:var(--primary); color:white; font-weight:900; letter-spacing:0.5px; border:none; cursor:pointer;">SIM, ESTORNAR</button>
          <button id="btn-cancel-reverse-trans" style="width:100%; padding:1.1rem; border-radius:1rem; background:var(--surface-hover); color:var(--text-main); font-weight:900; letter-spacing:0.5px; border:none; cursor:pointer;">CANCELAR</button>
        </div>
      </div>
    `
    root.appendChild(modalOverlay)
    
    document.getElementById('btn-cancel-reverse-trans').addEventListener('click', () => {
      appState.showModal = null
      render()
    })
    document.getElementById('btn-do-reverse-trans').addEventListener('click', () => {
      const dbId = appState.financasData.pendingReverseDbId
      const agendaId = appState.financasData.pendingReverseAgendaId
      
      // Optimistic state
      appState.financasData.transactions = appState.financasData.transactions.filter(t => t.id !== dbId)
      appState.agendaLoaded = false
      appState.agendaData = {}
      appState.showModal = null
      render()

      // Background Sync
      supabase.from('agendamentos').update({ 
        agendamento_status: 'Pendente',
        pagamento_status: false 
      }).eq('id', agendaId).then(({ error: agError }) => {
        if (agError) {
          alert('Erro ao sincronizar estorno no agendamento: ' + agError.message)
        } else {
          supabase.from('transacoes_financeiras').delete().eq('id', dbId).then(({ error: trError }) => {
            if (trError) alert('Erro ao sincronizar exclusão da transação: ' + trError.message)
          })
        }
      })
    })
  }

  if (appState.showModal === 'confirm-reverse-fixed') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = `
      <div class="card animate-fade-in" style="max-width:400px; width:92%; padding:2.5rem; text-align:center; border-radius:1.5rem;">
        <div style="width:70px; height:70px; background:#e0e7ff; color:#4338ca; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 1.5rem; font-size:2rem; font-weight:900;">🔄</div>
        <h2 style="font-family:var(--font-alt); font-size:1.2rem; font-weight:900; margin-bottom:1rem;">ESTORNAR PAGAMENTO?</h2>
        <p style="color:var(--text-secondary); margin-bottom:2rem; line-height:1.5;">Esta ação removerá o pagamento e o lançamento voltará a ficar como <strong>'Pagar Agora'</strong> para a competência selecionada.</p>
        <div class="flex flex-col gap-sm">
          <button id="btn-do-reverse-fixed" style="width:100%; padding:1.1rem; border-radius:1rem; background:var(--primary); color:white; font-weight:900; letter-spacing:0.5px; border:none; cursor:pointer;">SIM, ESTORNAR</button>
          <button id="btn-cancel-reverse-fixed" style="width:100%; padding:1.1rem; border-radius:1rem; background:var(--surface-hover); color:var(--text-main); font-weight:900; letter-spacing:0.5px; border:none; cursor:pointer;">CANCELAR</button>
        </div>
      </div>
    `
    root.appendChild(modalOverlay)
    
    document.getElementById('btn-cancel-reverse-fixed').addEventListener('click', () => {
      appState.showModal = null
      render()
    })
    document.getElementById('btn-do-reverse-fixed').addEventListener('click', () => {
      const dbId = appState.financasData.pendingReverseFixedId
      
      // Optimistic state update
      appState.financasData.transactions = appState.financasData.transactions.filter(t => t.id !== dbId)
      appState.showModal = null
      render()

      // Background Sync
      supabase.from('transacoes_financeiras').delete().eq('id', dbId).then(({ error }) => {
        if (error) alert('Erro ao sincronizar estorno fixo: ' + error.message)
      })
    })
  }

  if (appState.showModal === 'confirm-delete-all-fixed') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = `
      <div class="card animate-fade-in" style="max-width:400px; width:92%; padding:2.5rem; text-align:center; border-radius:1.5rem;">
        <div style="width:70px; height:70px; background:#fee2e2; color:#dc2626; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 1.5rem; font-size:2rem; font-weight:900;">🗑️</div>
        <h2 style="font-family:var(--font-alt); font-size:1.2rem; font-weight:900; margin-bottom:1rem;">EXCLUIR DESPESA FIXA?</h2>
        <p style="color:var(--text-secondary); margin-bottom:2rem; line-height:1.5;">Esta ação excluirá a conta fixa <strong>"${appState.financasData.pendingDeleteAllFixedDesc}"</strong> do mês atual e de todos os meses seguintes. (O histórico de pagamentos passados será mantido).</p>
        <div class="flex flex-col gap-sm">
          <button id="btn-do-delete-all-fixed" style="width:100%; padding:1.1rem; border-radius:1rem; background:#dc2626; color:white; font-weight:900; letter-spacing:0.5px; border:none; cursor:pointer;">SIM, EXCLUIR CONTA</button>
          <button id="btn-cancel-delete-all-fixed" style="width:100%; padding:1.1rem; border-radius:1rem; background:var(--surface-hover); color:var(--text-main); font-weight:900; letter-spacing:0.5px; border:none; cursor:pointer;">CANCELAR</button>
        </div>
      </div>
    `
    root.appendChild(modalOverlay)
    
    document.getElementById('btn-cancel-delete-all-fixed').addEventListener('click', () => {
      appState.showModal = null
      render()
    })
    document.getElementById('btn-do-delete-all-fixed').addEventListener('click', async () => {
      const desc = appState.financasData.pendingDeleteAllFixedDesc
      const limitDate = `${appState.financasData.year}-${String(appState.financasData.month + 1).padStart(2,'0')}-01`
      
      // Delete specific month payments (including advance ones with [REF:..]) from this month forward
      const { error: trError } = await supabase.from('transacoes_financeiras').delete().eq('categoria', 'Fixo').like('descricao', `${desc}%`).gte('data_transacao', limitDate)
      // Delete templates
      const { error: trErrorTpl } = await supabase.from('transacoes_financeiras').delete().eq('descricao', `${desc} [TEMPLATE]`)

      if (!trError && !trErrorTpl) {
        appState.financasData.transactions = appState.financasData.transactions.filter(t => {
          if (t.isTemplate && t.desc === desc) return false;
          // Keep if it's an old real transaction
          if (t.cat === 'Fixo' && t.desc === desc) {
            const d = t.fullDate ? new Date(t.fullDate + 'T12:00:00') : null
            return d && d < new Date(limitDate + 'T12:00:00')
          }
          return true;
        })
        appState.showModal = null
        render()
      } else {
        alert('Erro ao excluir despesa fixa: ' + (trError?.message || trErrorTpl?.message))
      }
    })
  }


  if (appState.showModal === 'confirm-cancel') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = `
      <div class="card animate-fade-in" style="max-width:390px;width:92%;padding:2rem;border-radius:1.5rem;text-align:center;">
        <button id="btn-close-cancel-x" style="position:absolute;top:1rem;right:1rem;background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-secondary);line-height:1;padding:0.5rem;z-index:99;">✕</button>
        <div style="width:70px;height:70px;background:#fee2e2;color:#dc2626;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 1.5rem;font-size:2rem;font-weight:900;">!</div>
        <h2 style="font-family:var(--font-alt);font-size:1.3rem;font-weight:900;line-height:1.2;margin-bottom:1rem;">CANCELAR AGENDAMENTO</h2>
        <p style="font-size:0.95rem;color:var(--text-secondary);margin-bottom:2rem;line-height:1.5;">Deseja realmente cancelar o agendamento de <strong>${appState.activeAgendaItem?.client}</strong>?</p>
        <div class="flex flex-col gap-sm">
          <button id="btn-confirm-cancel-final" style="width:100%;padding:1.1rem;border-radius:1rem;background:#dc2626;color:white;font-weight:900;font-size:0.88rem;letter-spacing:1.5px;border:none;cursor:pointer;">SIM, CANCELAR</button>
          <button id="btn-close-cancel" style="width:100%;padding:1.1rem;border-radius:1rem;background:var(--surface-hover);color:var(--text-main);font-weight:900;font-size:0.88rem;letter-spacing:1.5px;border:none;cursor:pointer;">NÃO, VOLTAR</button>
        </div>
      </div>
    `
    root.appendChild(modalOverlay)
    attachConfirmCancelEvents()
  }

  if (appState.showModal === 'mercadopago') {
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = `
      <div class="card animate-fade-in" style="max-width: 480px; width: 95%; padding: 2.5rem; text-align: left; border-radius: 24px; max-height: 90vh; overflow-y: auto;">
        <button id="btn-close-mp-x" style="position:absolute;top:1rem;right:1rem;background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-secondary);line-height:1;padding:0.5rem;z-index:99;">✕</button>
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1.5rem;">
          <div style="display:flex; align-items:center; gap:1rem;">
            <div style="width:48px; height:48px; background:linear-gradient(135deg,#009ee3,#0077b6); border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
            </div>
            <div>
              <h3 style="font-family:var(--font-alt); font-size:1.2rem; margin:0; color:var(--primary);">Conectar Mercado Pago</h3>
              <p style="font-size:0.8rem; color:var(--text-secondary); margin:0; line-height:1.4;">Configure uma única vez para receber as taxas de reserva direto na sua conta.</p>
            </div>
          </div>
        </div>

        <div style="background:rgba(0,158,227,0.08); border:1.5px solid #009ee3; border-radius:16px; padding:1.2rem; margin-bottom:1.5rem;">
          <p style="font-size:0.85rem; font-weight:700; color:#0077b6; line-height:1.5; margin:0;">
            Como o envio automático de QR Code requer acesso especial (Marketplace), usaremos um método simples e direto: basta colar seu <strong>Access Token</strong> abaixo.
          </p>
        </div>

        <div style="display:flex;flex-direction:column;gap:1rem;margin-bottom:2rem;">
          <h4 style="font-size:0.85rem; font-weight:800; color:var(--text-main); text-transform:uppercase; letter-spacing:0.5px; margin:0;">Obtenha seu token em 3 passos:</h4>
          ${[
            { n:'1', text:'Acesse <strong><a href="https://www.mercadopago.com.br/developers/panel/app" target="_blank" style="color:#009ee3; text-decoration:none;">mercadopago.com.br/developers</a></strong> e faça login com sua conta.' },
            { n:'2', text:'Clique em <strong>"Criar aplicação"</strong>. Escolha um nome ("Meu Salão"), marque <strong>Checkout Pro/Transparente</strong> e avance até criar.' },
            { n:'3', text:'Abra a aplicação criada, vá em <strong>"Credenciais de produção"</strong> no menu lateral e copie o <strong>Access token</strong> (ele começa com <code style="background:var(--surface);padding:3px 6px;border-radius:6px;font-size:0.75rem;border:1px solid var(--border);color:var(--text-main);">APP_USR-</code>).' },
          ].map(s => `
            <div style="display:flex;gap:1rem;align-items:flex-start; background:var(--surface); padding:1rem; border-radius:12px; border:1px solid var(--border);">
              <div style="min-width:28px;height:28px;background:var(--primary);color:var(--on-primary);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:0.85rem;flex-shrink:0;box-shadow:0 4px 10px rgba(var(--primary-rgb), 0.3);">${s.n}</div>
              <p style="font-size:0.85rem;color:var(--text-secondary);line-height:1.5;margin:0;">${s.text}</p>
            </div>
          `).join('')}
        </div>

        <div style="background:var(--surface); border:1.5px solid var(--border); border-radius:16px; padding:1.25rem;">
          <label style="display:block; font-size:0.75rem;font-weight:800;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px; margin-bottom:0.5rem;">Cole seu Access Token</label>
          <input type="text" id="mp-token-input" placeholder="APP_USR-..." autocomplete="off"
            style="padding:16px;border-radius:12px;border:2px solid var(--border);width:100%;font-family:monospace;font-size:0.9rem;box-sizing:border-box;margin-bottom:0.75rem;transition:all 0.2s;"
            onfocus="this.style.borderColor='var(--primary)'" onblur="this.style.borderColor='var(--border)'">
          <p style="font-size:0.75rem;color:var(--text-secondary);margin:0;display:flex;align-items:center;gap:0.4rem;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            Token criptografado e salvo com segurança.
          </p>
        </div>

        <div style="display:flex; gap:1rem; margin-top:1.5rem;">
          <button id="btn-close-mp-2" style="background:var(--surface); border:1.5px solid var(--border); color:var(--text-main); padding:1rem; border-radius:12px; font-weight:700; width:100%; font-size:0.95rem; cursor:pointer;">CANCELAR</button>
          <button id="btn-confirm-mp" style="background:var(--primary); border:none; color:var(--on-primary); padding:1rem; border-radius:12px; font-weight:800; width:100%; font-size:0.95rem; cursor:pointer; box-shadow:0 4px 14px rgba(var(--primary-rgb), 0.4);">SALVAR E CONTINUAR</button>
        </div>
      </div>
    `
    root.appendChild(modalOverlay)

    const closeHandler = () => {
      appState.showModal = null
      appState.pendingAgendamento = null
      render()
    }

    document.getElementById('btn-close-mp-x').addEventListener('click', closeHandler)
    document.getElementById('btn-close-mp-2').addEventListener('click', closeHandler)

    document.getElementById('btn-confirm-mp').addEventListener('click', async () => {
      const token = document.getElementById('mp-token-input').value.trim()
      if (!token || !token.startsWith('APP_USR-')) {
        alert('Erro: Token inválido. Insira um credencial de produção que comece com APP_USR-')
        return
      }

      const btn = document.getElementById('btn-confirm-mp')
      btn.innerHTML = '<div style="width:20px;height:20px;border:3px solid white;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto;"></div>'
      btn.disabled = true

      const { error } = await supabase.auth.updateUser({ data: { mp_access_token: token } })
      if (error) {
        alert('Erro ao salvar token: ' + error.message)
        btn.textContent = 'SALVAR E CONTINUAR'
        btn.disabled = false
        return
      }

      // Update local user state
      const { data: { user } } = await supabase.auth.getUser()
      if (user) appState.user = user

      appState.showModal = null

      // Continue creating PIX if there was a pending agendamento
      if (appState.pendingAgendamento) {
        await criarAgendamentoComPix(appState.pendingAgendamento)
        appState.pendingAgendamento = null
      } else {
        alert('Mercado Pago conectado com sucesso!')
        render()
      }
    })
  }

  if (appState.showModal === 'pix-aguardando') {
    const pix = appState.pixModal
    const modalOverlay = document.createElement('div')
    modalOverlay.className = 'overlay'
    modalOverlay.innerHTML = `
      <div class="card animate-fade-in" style="max-width: 420px; width: 95%; padding: 2rem; text-align: center; border-radius: 24px;">
        <div style="width:52px;height:52px;background:linear-gradient(135deg,#00b37e,#059669);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;">
          <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M10 13.5a4 4 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95L11 7.5"/><path d="M14 10.5a4 4 0 0 0-5 0L6.5 13a3.5 3.5 0 0 0 4.95 4.95L13 16.5"/></svg>
        </div>
        <h3 style="font-family:var(--font-alt);margin-bottom:0.25rem;">PIX de Reserva</h3>
        <p style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:1.25rem;">Valor: <strong style="color:var(--primary);">R$ ${Number(pix?.valor ?? 0).toFixed(2).replace('.', ',')}</strong></p>

        ${pix?.qr_code_b64 ? `
          <img src="data:image/png;base64,${pix.qr_code_b64}" alt="QR Code PIX"
            style="width:180px;height:180px;border-radius:12px;border:2px solid var(--border);margin-bottom:1rem;">
        ` : ''}

        <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:12px;padding:0.75rem 1rem;text-align:left;margin-bottom:1rem;">
          <p style="font-size:0.65rem;font-weight:800;color:var(--text-secondary);margin-bottom:0.4rem;text-transform:uppercase;">Código PIX Copia e Cola</p>
          <p id="pix-code-text" style="font-size:0.7rem;font-family:monospace;word-break:break-all;color:var(--text-main);line-height:1.5;">${pix?.qr_code ?? ''}</p>
        </div>
        <button id="btn-copy-pix" style="background:var(--surface);border:1.5px solid var(--border);padding:0.75rem 1.5rem;border-radius:12px;font-weight:700;font-size:0.85rem;width:100%;margin-bottom:1rem;">📋 COPIAR CÓDIGO</button>

        <div id="pix-status" style="display:flex;align-items:center;justify-content:center;gap:0.5rem;color:var(--text-secondary);font-size:0.85rem;margin-bottom:1.5rem;">
          <div style="width:14px;height:14px;border:2px solid var(--text-secondary);border-top-color:var(--primary);border-radius:50%;animation:spin 0.8s linear infinite;"></div>
          <span>Aguardando pagamento...</span>
        </div>

        ${pix?.ticket_url ? `<a href="${pix.ticket_url}" target="_blank" style="display:block;color:#009ee3;font-size:0.8rem;font-weight:700;margin-bottom:1rem;">Abrir link de pagamento ↗</a>` : ''}
        <button id="btn-close-pix" style="color:var(--text-secondary);font-weight:700;font-size:0.85rem;">FECHAR (verificar depois)</button>
      </div>
    `
    root.appendChild(modalOverlay)

    // Copy code button
    document.getElementById('btn-copy-pix')?.addEventListener('click', () => {
      navigator.clipboard.writeText(pix?.qr_code ?? '')
      document.getElementById('btn-copy-pix').textContent = '✅ COPIADO!'
      setTimeout(() => { const b = document.getElementById('btn-copy-pix'); if(b) b.textContent = '📋 COPIAR CÓDIGO' }, 2000)
    })

    document.getElementById('btn-close-pix')?.addEventListener('click', () => {
      clearInterval(window._pixPollingInterval)
      appState.showModal = null
      appState.pixModal = null
      render()
    })

    // Poll for payment confirmation every 5s
    clearInterval(window._pixPollingInterval)
    window._pixPollingInterval = setInterval(async () => {
      if (!pix?.agendamento_id) return
      const { data } = await supabase
        .from('agendamentos')
        .select('pagamento_status')
        .eq('id', pix.agendamento_id)
        .single()

      if (data?.pagamento_status === 'approved') {
        clearInterval(window._pixPollingInterval)
        appState.showModal = null
        appState.pixModal = null
        alert('Reserva confirmada! O pagamento PIX foi recebido com sucesso.')
      } else if (data?.pagamento_status === 'rejected') {
        clearInterval(window._pixPollingInterval)
        const statusEl = document.getElementById('pix-status')
        if (statusEl) statusEl.innerHTML = '<span style="color:#dc2626;">❌ Pagamento recusado. Gere um novo QR code.</span>'
      }
    }, 5000)
  }

  if (appState.customAlert) {
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'overlay';
    modalOverlay.innerHTML = renderCustomAlert(appState.customAlert);
    root.appendChild(modalOverlay);

    const btnOk = document.getElementById('btn-alert-ok');
    if (btnOk) btnOk.addEventListener('click', () => {
      appState.customAlert = null;
      render();
    });
  }
}

function renderCustomAlert(alertData) {
  return `
    <div class="card flex flex-col items-center gap-sm animate-fade-in" style="padding: 2.5rem 1.5rem; text-align: center; max-width: 400px; width: 90%;">
      <div style="width: 70px; height: 70px; background: ${alertData.color}; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 0.5rem;">
        ${alertData.icon}
      </div>
      <h3 style="font-size: 1.6rem; font-weight: 800; color: var(--text-main);">${alertData.title}</h3>
      <p style="color: var(--text-secondary); margin-bottom: 1rem; font-size: 1.1rem; line-height: 1.5;">${alertData.message}</p>
      <button id="btn-alert-ok" class="w-full" style="background: var(--primary); color: var(--on-primary); padding: 1.25rem; border-radius: 10px; font-weight: 800; font-size: 1.1rem; box-shadow: 0 4px 15px var(--glow);">
        OK
      </button>
    </div>
  `
}

// --- RENDERERS ---

function renderTabHeader(title, content, showPrint = false, showCalendar = true) {
  return `
    <div class="tab-view min-h-screen">
      <header class="flex items-center" style="padding: 0.75rem var(--spacing-sm); border-bottom: 1px solid var(--border); background: var(--background); position: sticky; top: 0; z-index: 100; gap: 0.75rem;">
        <button id="btn-back-dashboard" style="padding: 0.5rem; border-radius: 50%; background: var(--surface); color: var(--primary); display: flex; align-items: center; justify-content: center;">${icons.back}</button>
        <h2 style="font-size: clamp(0.85rem, 3.8vw, 1.2rem); flex: 1; font-family: var(--font-alt); text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 800;">${title}</h2>
        ${showCalendar ? `<button id="btn-calendar-trigger" style="padding: 0.5rem; color: var(--primary); display: flex; align-items: center; justify-content: center;">${icons.agenda}</button>` : ''}
        ${showPrint ? `<button id="btn-print" style="padding: 0.5rem; color: var(--text-secondary); display: flex; align-items: center; justify-content: center;">${icons.print}</button>` : ''}
      </header>
      <div class="tab-body">
        ${content}
      </div>
    </div>
  `
}

function renderLogin() {
  let subContent = ''

  if (appState.loginSubScreen === 'default') {
    subContent = `
      <div class="w-full flex flex-col gap-md">
        <input type="email" id="login-email" placeholder="E-mail" style="padding: 0.8rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; font-size: 1rem;">
        <div class="flex flex-col items-end gap-xs">
          <input type="password" id="login-senha" placeholder="Senha" style="padding: 0.8rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; font-size: 1rem;">
          <button id="link-forgot" style="font-size: 0.9rem; color: var(--text-secondary); font-weight: 600; text-decoration: underline; margin-top: 0.2rem;">Esqueci minha senha</button>
        </div>
        <button id="btn-login" class="w-full" style="background: var(--primary); color: var(--on-primary); padding: 1rem; border-radius: 0.5rem; font-weight: 800; margin-top: 1rem; box-shadow: 0 4px 15px var(--glow); letter-spacing: 1.5px; font-size: 1.1rem;">
          ENTRAR
        </button>
        <button id="link-register" style="font-size: 0.95rem; color: var(--primary); font-weight: 800; text-align: center; margin-top: 1rem;">CRIAR CONTA</button>
      </div>
    `
  } else if (appState.loginSubScreen === 'forgot') {
    subContent = `
      <div class="w-full flex flex-col gap-md">
        <p style="font-size: 1.1rem; color: var(--text-secondary); text-align: center; margin-bottom: 10px;">Digite seu e-mail para redefinir a senha</p>
        <input type="email" id="forgot-email" placeholder="Seu E-mail" autocapitalize="none" style="padding: 18px; border-radius: 10px; border: 1px solid var(--border); width: 100%; font-size: 1.15rem;">
        <button id="btn-reset" class="w-full" style="background: var(--primary); color: var(--on-primary); padding: 22px; border-radius: 10px; font-weight: 800; margin-top: 10px; font-size: 1.3rem;">
          ENVIAR E-MAIL
        </button>
        <button id="link-back-login" style="font-size: 1.1rem; color: var(--text-secondary); font-weight: 600; text-align: center;">Voltar ao Login</button>
      </div>
    `
  } else if (appState.loginSubScreen === 'register') {
    subContent = `
      <div class="registration-form flex flex-col w-full" style="gap: 12px;">
        <div class="flex flex-col gap-xs" style="margin-bottom: 5px;">
          <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; text-align: left;">Tipo de Estabelecimento</label>
          <div class="theme-selector flex gap-sm w-full" style="background: var(--background); padding: 4px; border-radius: 10px; border: 1px solid var(--border);">
            <button id="reg-btn-barbearia" style="flex: 1; padding: 0.7rem; border-radius: 8px; font-weight: 800; font-size: 0.85rem; transition: all 0.3s;
              ${appState.theme === 'barbearia' ? 'background: var(--primary); color: var(--on-primary); box-shadow: var(--shadow-sm);' : 'color: var(--text-secondary);'}">
              BARBEARIA
            </button>
            <button id="reg-btn-salao" style="flex: 1; padding: 0.7rem; border-radius: 8px; font-weight: 800; font-size: 0.85rem; transition: all 0.3s;
              ${appState.theme === 'salao' ? 'background: var(--primary); color: var(--on-primary); box-shadow: var(--shadow-sm);' : 'color: var(--text-secondary);'}">
              SALÃO
            </button>
          </div>
        </div>
        <input type="text" id="reg-nome" placeholder="Nome Completo" value="${appState.registrationData.nome}" style="padding: 0.8rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; font-size: 1rem;">
        <input type="text" id="reg-telefone" placeholder="Telefone" value="${appState.registrationData.telefone}" style="padding: 0.8rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; font-size: 1rem;">
        <input type="text" id="reg-endereco" placeholder="Endereço" value="${appState.registrationData.endereco}" style="padding: 0.8rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; font-size: 1rem;">
        <input type="email" id="reg-email" placeholder="Email" value="${appState.registrationData.email}" style="padding: 0.8rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; font-size: 1rem;">
        <input type="password" id="reg-senha" placeholder="Senha" value="${appState.registrationData.senha}" style="padding: 0.8rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; font-size: 1rem;">
        <input type="password" id="reg-senha-confirm" placeholder="Confirmação de Senha" value="${appState.registrationData.conf}" style="padding: 0.8rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; font-size: 1rem;">
        <button id="btn-do-register" class="w-full" style="background: var(--primary); color: var(--on-primary); padding: 1rem; border-radius: 0.5rem; font-weight: 800; margin-top: 5px; font-size: 1.1rem; cursor: pointer; box-shadow: 0 4px 15px var(--glow);">
          CADASTRAR
        </button>
        <button id="link-back-login" style="font-size: 0.95rem; color: var(--text-secondary); font-weight: 600; text-align: center; margin-top: 0.5rem; cursor: pointer;">Voltar ao Login</button>
      </div>
    `
  }

  return `
    <div class="login-container flex flex-col items-center min-h-screen animate-fade-in" style="min-height: 100vh; justify-content: center; padding-top: 0;">
      <div class="login-logo-container" style="text-align: center; margin-bottom: 1rem;">
        <img src="/logo_pegasus.png" alt="Pegasus Logo" class="login-logo-img" style="width: 11vw; min-width: 176px; max-width: 264px; height: auto; filter: drop-shadow(0 10px 20px rgba(0,0,0,0.1));">
        <p class="login-tagline" style="margin-top: 0.5rem; color: var(--text-secondary); font-weight: 600; font-style: italic; font-family: var(--font-alt); font-size: 0.8rem;">O sistema de gestão que decola seu negócio!</p>
      </div>
      <div class="login-card-container" style="max-width: 32rem;">
        <div class="login-card card" style="width: 100%; padding: clamp(1rem, 3vw, 2rem);">
          <h1 style="font-size: 1.8rem; margin-bottom: 0px; font-family: var(--font-heading);">LOGIN</h1>
          <p style="color: var(--text-secondary); margin-bottom: 0.5rem; font-weight: 500; font-size: 0.9rem;">${appState.loginSubScreen === 'register' ? 'Cadastro de Conta' : 'Escolha seu perfil'}</p>
        
        ${appState.loginSubScreen !== 'register' ? `
        <div class="theme-selector flex gap-md w-full" style="margin-bottom: 1.2rem;">
          <button id="btn-barbearia" style="flex: 1; padding: 0.8rem; border-radius: 0.5rem; font-weight: 800; border: 2px solid ${appState.theme === 'barbearia' ? 'var(--primary)' : 'var(--border)'}; background: ${appState.theme === 'barbearia' ? 'var(--glow)' : 'transparent'}; font-size: 0.85rem;">
            BARBEARIA
          </button>
          <button id="btn-salao" style="flex: 1; padding: 0.8rem; border-radius: 0.5rem; font-weight: 800; border: 2px solid ${appState.theme === 'salao' ? 'var(--primary)' : 'var(--border)'}; background: ${appState.theme === 'salao' ? 'var(--glow)' : 'transparent'}; font-size: 0.85rem;">
            SALÃO DE BELEZA
          </button>
        </div>
        ` : ''}

        ${subContent}
        </div>
      </div>
    </div>
  `
}

function renderDashboard() {
  return `
    <div class="dashboard-container min-h-screen">
      <div class="animate-fade-in">
        <header class="flex justify-between items-center" style="padding: 1.25rem var(--spacing-lg) 1.25rem 2.5%; border-bottom: 1px solid var(--border); background: var(--background); position: sticky; top: 0; z-index: 100;">
          <div class="flex items-center">
             <img src="/logo_pegasus_sem_nome.png" alt="Pegasus Logo" style="height: 4.5rem; width: auto; object-fit: contain; margin-right: 0.5rem; ">
             <span style="font-size: 0.75rem; background: var(--primary); padding: 0.25rem 0.8rem; border-radius: 2rem; color: var(--on-primary); font-weight: 800; letter-spacing: 1px; text-transform: uppercase;">
              ${appState.theme === 'salao' ? 'Salão' : appState.theme}
             </span>
          </div>
          <button id="btn-logout" style="color: var(--text-secondary); font-weight: 700; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px; margin-left: 2rem;">Sair</button>
        </header>

        <div id="dash-ptr-container" style="overflow-y:auto;height:calc(100vh - 80px);">
          <div id="dash-ptr-indicator" style="display:none;flex-direction:column;align-items:center;gap:0.5rem;padding:1rem 0 0.5rem;">
            <div id="dash-ptr-spinner" style="width:28px;height:28px;border:3px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:none;"></div>
            <span style="font-size:0.75rem;color:var(--text-secondary);font-weight:700;">↓ Puxe para atualizar tudo</span>
          </div>

          <main style="padding-top: 1rem; padding-bottom: 6rem;">
            <div class="text-center" style="margin-bottom: 3rem; padding: 0 1.25rem;">
               <h1 style="font-size: clamp(2rem, 5vw, 3rem); margin-bottom: 0.6rem; font-family: var(--font-heading);">PAINEL GERAL</h1>
               <p style="color: var(--text-secondary); font-weight: 600; font-size: 1.1rem;">O que vamos fazer hoje?</p>
            </div>

          <div class="dashboard-grid">
            <div class="card" id="card-financas">
              <div class="icon-container" style="transform: scale(1.2);">${icons.financas}</div>
              <h3 style="margin-top: 1rem; font-size: 1.1rem;">Controle Financeiro</h3>
            </div>
            <div class="card" id="card-agenda">
              <div class="icon-container" style="transform: scale(1.2);">${icons.agenda}</div>
              <h3 style="margin-top: 1rem; font-size: 1.1rem;">Minha Agenda</h3>
            </div>
            <div class="card" id="card-assinaturas">
              <div class="icon-container" style="transform: scale(1.2);">${icons.assinaturas}</div>
              <h3 style="margin-top: 1rem; font-size: 1.1rem;">Assinaturas</h3>
            </div>
            <div class="card" id="card-servicos">
              <div class="icon-container" style="transform: scale(1.2);">${icons.servicos}</div>
              <h3 style="margin-top: 1rem; font-size: 1.1rem;">Serviços Fornecidos</h3>
            </div>
          </div>
        </main>
      </div>
    </div>
  </div>

      <!-- Botão Suporte Flutuante (Extreme Corner) - OUTSIDE animation to fix position:fixed -->
      <button id="btn-floating-support" style="
        position: fixed !important;
        bottom: 1.5rem !important;
        right: 1.5rem !important;
        width: 65px !important;
        height: 65px !important;
        border-radius: 50% !important;
        background: var(--primary) !important;
        color: var(--on-primary) !important;
        border: none !important;
        box-shadow: var(--shadow-lg) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        z-index: 99999 !important;
        cursor: pointer !important;
        transition: transform 0.2s;
      ">
        <div style="transform: scale(1.4);">${icons.suporte}</div>
      </button>
    </div>
  `
}

function renderAgenda() {
  const dayKey = getAgendaDayKey(appState.selectedDate)
  const profile = appState.profile || {}
  const diasFuncionamento = profile.dias_funcionamento
  const isConfigured = diasFuncionamento && diasFuncionamento.length > 0
  const todayDow = appState.selectedDate.getDay() // 0=Dom..6=Sáb
  const isDayOff = isConfigured && !diasFuncionamento.includes(todayDow)

  // Only booked items (no "livre" slots)
  const dayItems = appState.agendaData[dayKey] || []

  // Check for day-closing exception
  const fechadoHoje = appState.excecoesDia.some(e => e.tipo === 'fechado_dia_todo')

  let bodyContent
  if (isDayOff || fechadoHoje) {
    bodyContent = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;padding:5rem 2rem;">
        <span style="font-size:3rem;opacity:0.4;">🔒</span>
        <p style="font-weight:700;font-size:1rem;text-align:center;color:var(--text-secondary);opacity:0.5;">Estabelecimento fechado hoje....</p>
      </div>`
  } else if (dayItems.length === 0) {
    const dayNum = appState.selectedDate.getDate()
    bodyContent = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;padding:5rem 2rem;">
        <svg width="64" height="72" viewBox="0 0 64 72" fill="none" xmlns="http://www.w3.org/2000/svg" style="opacity:0.35;">
          <rect x="2" y="10" width="60" height="60" rx="7" fill="#e2e8f0" stroke="#cbd5e1" stroke-width="2"/>
          <rect x="2" y="10" width="60" height="20" rx="7" fill="#f87171"/>
          <rect x="2" y="22" width="60" height="8" fill="#f87171"/>
          <rect x="14" y="2" width="8" height="16" rx="4" fill="#94a3b8"/>
          <rect x="42" y="2" width="8" height="16" rx="4" fill="#94a3b8"/>
          <text x="32" y="60" text-anchor="middle" font-family="system-ui,sans-serif" font-size="26" font-weight="900" fill="#64748b">${dayNum}</text>
        </svg>
        <p style="font-weight:700;font-size:1rem;text-align:center;color:var(--text-secondary);opacity:0.5;">Ainda não existe um serviço agendado para hoje...</p>
      </div>`
  } else {
    bodyContent = dayItems.map((item, index) => {
      const isPendente = item.status === 'pendente'
      const valorDisplay = item.valor_total || item.valorTotal ? `R$ ${parseFloat(item.valor_total || item.valorTotal).toFixed(2).replace('.', ',')}` : '---'

      // Red border = ANY appointment whose time has already passed (regardless of status)
      const isOverdue = hasTimePassed(item.time, appState.selectedDate)

      let cardStyle
      if (isOverdue && isPendente) {
        // Overdue + pending: red border, full opacity (urgent!)
        cardStyle = 'background:rgba(255,241,242,0.9); border: 2.5px solid #ef4444; opacity:1;'
      } else if (isPendente) {
        // Pending but not yet overdue: dashed, faded
        cardStyle = 'background:rgba(255,255,255,0.5); border: 1.5px dashed #cbd5e1; opacity:0.5;'
      } else if (isOverdue) {
        // Confirmed but time passed: orange-red border to signal needs conclude/cancel
        cardStyle = 'background:#fff; border: 2px solid #f97316; opacity:1;'
      } else {
        cardStyle = 'background:#ffffff; border: 1px solid var(--border);'
      }

      return `
        <div class="agenda-item card ripple" data-index="${index}" style="cursor:pointer; padding:0; align-items:stretch; overflow:hidden; display:flex; flex-direction:column; border-radius:18px; ${cardStyle}">
          <!-- Header: Time | Price -->
          <div style="display:flex; border-bottom: 1px solid var(--border); background:rgba(0,0,0,0.01);">
            <div style="flex:1; padding:12px; text-align:center; border-right:1px solid var(--border); font-weight:800; font-size:1.1rem; color:var(--text-main); display:flex; align-items:center; justify-content:center; gap:6px;">
              <span>🕒</span> ${item.time}
            </div>
            <div style="flex:1; padding:12px; text-align:center; font-weight:800; font-size:1.1rem; color:var(--text-main);">${valorDisplay}</div>
          </div>

          <!-- Body: Name & Services -->
          <div style="padding: 0.4rem 1rem 0.75rem 1rem; display:flex; flex-direction:column; gap:0.6rem; text-align:center;">
            <h4 style="font-family:var(--font-body); font-weight:800; font-size:1.15rem; color:var(--text-main); margin:0; line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding: 0 5px;">
              ${item.client}
            </h4>
            ${item.service ? `
              <p style="color:var(--text-secondary); font-size:0.85rem; font-weight:600; margin:0; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; line-height:1.4; opacity:0.8;">
                ${item.service}
              </p>` : ''}
          </div>

          <!-- Footer: overdue warning OR pending confirm -->
          ${(isOverdue && isPendente) ? `
            <div class="card-footer-pendente" data-id="${item.id}" style="border-top:1.5px solid #fca5a5; padding:10px 12px; background:rgba(239,68,68,0.08); display:flex; justify-content:center; align-items:center; cursor:pointer; transition: all 0.2s; position:relative;">
              <span style="color:#dc2626; font-size:0.75rem; font-weight:900; letter-spacing:0.5px; text-transform:uppercase;">⚠️ Pendente — Confirme ou Cancele</span>
              <style>.card-footer-pendente:active { transform: scale(0.98); }</style>
            </div>
          ` : isOverdue ? `
            <div style="border-top:1.5px solid #fed7aa; padding:10px 12px; background:rgba(249,115,22,0.07); display:flex; justify-content:center; align-items:center;">
              <span style="color:#ea580c; font-size:0.75rem; font-weight:900; letter-spacing:0.5px; text-transform:uppercase;">⏰ Dar Baixa — Concluído ou Cancelado</span>
            </div>
          ` : isPendente ? `
            <div class="card-footer-pendente" data-id="${item.id}" style="border-top:1px solid #cbd5e1; padding:12px; background:rgba(203,213,225,0.1); display:flex; justify-content:center; align-items:center; cursor:pointer; transition: all 0.2s; position:relative;">
              <span class="btn-confirm-txt" style="color:#64748b; font-size:0.8rem; font-weight:800; letter-spacing:0.5px; text-transform:uppercase;">Confirme o pagamento</span>
              ${item.id ? `
                <div style="display:flex; gap:0.4rem; position:absolute; right:12px;">
                  <button class="btn-ag-accept ripple" data-id="${item.id}" style="background:#10b981; color:white; width:28px; height:28px; border-radius:50%; border:none; display:flex; align-items:center; justify-content:center; font-size:0.8rem;">✓</button>
                  <button class="btn-ag-reject ripple" data-id="${item.id}" style="background:#ef4444; color:white; width:28px; height:28px; border-radius:50%; border:none; display:flex; align-items:center; justify-content:center; font-size:0.8rem;">X</button>
                </div>
              ` : ''}
              <style>.card-footer-pendente:active { transform: scale(0.98); background: rgba(203,213,225,0.3); }</style>
            </div>
          ` : ''}
        </div>`
    }).join('')
  }

  // Pausa ativa hoje (badge)
  const now = new Date()
  const curTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
  const pausaAtivaRaw = appState.excecoesDia.find(e => e.tipo === 'pausa')
  const pausaAtiva = (pausaAtivaRaw && pausaAtivaRaw.fim?.slice(0,5) > curTime) ? pausaAtivaRaw : null

  const encerradoHoje = appState.excecoesDia.find(e => e.tipo === 'fechado_resto_do_dia')
  const pausaBadge = pausaAtiva
    ? `<button id="btn-gerenciar-pausa" style="font-size:0.7rem;font-weight:700;background:rgba(251,191,36,0.15);color:#b45309;border-radius:999px;padding:3px 12px;margin-left:0.75rem;border:none;cursor:pointer;">☕ PAUSA ${pausaAtiva.inicio?.slice(0,5)}–${pausaAtiva.fim?.slice(0,5)}</button>`
    : encerradoHoje
    ? `<button id="btn-gerenciar-pausa" style="font-size:0.7rem;font-weight:700;background:rgba(239,68,68,0.1);color:var(--red);border-radius:999px;padding:3px 12px;margin-left:0.75rem;border:none;cursor:pointer;">🔒 DIA ENCERRADO</button>`
    : ''

  return renderTabHeader(formatDate(appState.selectedDate), `
    <div id="ptr-container" style="overflow-y:auto;height:calc(100vh - 120px);">
    <div class="agenda-content p-lg animate-fade-in" style="max-width:50rem;margin:0 auto;padding:1.25rem;">

      <!-- Pull-to-refresh indicator -->
      <div id="ptr-indicator" style="display:none;flex-direction:column;align-items:center;gap:0.5rem;padding:1rem 0 0.5rem;">
        <div id="ptr-spinner" style="width:28px;height:28px;border:3px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:none;"></div>
        <span style="font-size:0.75rem;color:var(--text-secondary);font-weight:700;">↓ Solte para atualizar</span>
      </div>

      <div class="flex justify-between items-center" style="margin-bottom:2rem;">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:0.4rem;">
          <h2 style="font-family:var(--font-alt);font-size:1.1rem;font-weight:800;letter-spacing:1px;color:var(--text-secondary);">PROGRAMAÇÃO DO DIA</h2>
          <button id="btn-edit-horario" title="Editar horário de funcionamento" style="background:none;border:none;cursor:pointer;color:var(--text-secondary);padding:0.25rem;display:flex;align-items:center;opacity:0.6;">
            ${icons.edit}
          </button>
          ${pausaBadge}
        </div>
        <button id="btn-whatsapp-business" title="Mensagem Automática WhatsApp" style="background:none;border:none;cursor:pointer;color:#25D366;padding:0.5rem;display:flex;align-items:center;transition:transform 0.2s;">
          ${icons.whatsapp}
          <style>#btn-whatsapp-business:active { transform: scale(1.2); }</style>
        </button>
      </div>

      <div class="agenda-list flex flex-col gap-md" style="padding-bottom:10rem;">
        ${bodyContent}
      </div>

    </div>
    </div>

    <!-- FABs: only when no modal is open -->
    ${!appState.showModal ? `
    ${ (!isDayOff && !fechadoHoje && !encerradoHoje) ? `
    <button id="btn-fazer-pausa" class="fab ripple" style="position:fixed;bottom:4.75rem;right:1.5rem;padding:0 0.9rem;height:2rem;background:var(--surface);color:var(--text-main);border-radius:2rem;display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow-lg);z-index:9999;gap:0.4rem;border:2.5px solid var(--primary);">
      <span style="font-weight:800;font-size:0.7rem;letter-spacing:0.5px;">☕ FAZER PAUSA</span>
    </button>` : ''}

    <button id="btn-open-agenda-modal" class="fab ripple" style="position:fixed;bottom:1.5rem;right:1.5rem;padding:0 1rem;height:2.5rem;background:var(--primary);color:var(--on-primary);border-radius:2rem;display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow-lg);z-index:9999;gap:0.4rem;">
      ${icons.plus} <span style="font-weight:800;font-size:0.75rem;letter-spacing:1px;">AGENDAR MANUALMENTE</span>
    </button>
    ` : ''}
  `)
}

function renderWhatsAppModal() {
  const estabId = appState.user?.id || 'SEU_ID_AQUI'
  const message = `Olá, é um prazer te atender! Para adiantar seu atendimento, acesse este link e selecione o serviço e horário que deseja: https://pegasusapp.com.br/agendamento.html?estab=${estabId}`
  
  return `
    <div class="card animate-fade-in custom-scroll" style="max-width: 400px; width: 92%; padding: 1.25rem; border-radius: 1.5rem; max-height: 95vh; overflow-y: auto; display: flex; flex-direction: column; gap: 0.75rem;">
      <button id="btn-close-wa-x" style="position:absolute;top:0.5rem;right:0.5rem;background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-secondary);line-height:1;padding:0.5rem;z-index:99;">×</button>
      
      <div style="text-align: center;">
        <div style="background: #25D366; width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 0.25rem; box-shadow: 0 4px 12px rgba(37,211,102,0.3);">
          ${icons.whatsapp.replace('width="24"', 'width="24"').replace('height="24"', 'height="24"')}
        </div>
        <h2 style="font-family:var(--font-alt); font-size: 1.1rem; font-weight: 900; line-height: 1.1; color: #128C7E; margin: 0;">CONFIGURAR WHATSAPP</h2>
      </div>

      <div style="background: var(--surface); padding: 0.75rem 1rem; border-radius: 1rem; border: 1px solid var(--border);">
        <h4 style="font-size: 0.65rem; font-weight: 800; color: var(--primary); text-transform: uppercase; margin-bottom: 0.4rem; letter-spacing: 0.5px;">Passo a Passo:</h4>
        <ol style="padding-left: 1.1rem; font-size: 0.8rem; line-height: 1.3; color: var(--text-secondary); font-weight: 500; margin: 0;">
          <li style="margin-bottom: 0.15rem;">No WhatsApp, vá em <b>Ferramentas Comerciais</b></li>
          <li style="margin-bottom: 0.15rem;">Ative <b>Mensagem de Ausência</b></li>
          <li style="margin-bottom: 0.15rem;">Defina Envio para <b>"Sempre"</b></li>
          <li>Cole a mensagem abaixo</li>
        </ol>
      </div>

      <div style="background: #f0fdf4; border: 1.2px dashed #22c55e; padding: 0.6rem 0.8rem; border-radius: 0.75rem;">
        <p id="wa-message-text" style="font-size: 0.75rem; color: #166534; font-weight: 600; line-height: 1.3; margin: 0; text-align: center;">${message}</p>
      </div>

      <button id="btn-copy-wa-message" style="width: 100%; background: #25D366; color: white; padding: 0.85rem; border-radius: 0.75rem; font-weight: 800; border: none; cursor: pointer; box-shadow: 0 4px 15px rgba(37,211,102,0.2); transition: all 0.2s; font-size: 0.85rem;">
        COPIAR MENSAGEM
      </button>
    </div>
  `
}

function renderAgendaActionsModal() {
  const item = appState.activeAgendaItem
  return `
    <div class="card animate-fade-in" style="max-width: 400px; width: 90%; padding: 32px; border-radius: 24px;">
      <button id="btn-close-actions-x" style="position:absolute;top:1rem;right:1rem;background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-secondary);line-height:1;padding:0.5rem;z-index:99;">✕</button>
      <h3 style="margin-bottom: 10px; font-family: var(--font-alt); color: var(--primary);">${item.client}</h3>
      <p style="color: var(--text-secondary); margin-bottom: 30px; font-weight: 600;">${item.time} - ${item.service}</p>
      
      <div class="flex flex-col gap-md w-full">
        ${item.status === 'pendente' ? `
          <button id="btn-confirm-payment" style="background:#10b981; color:white; padding:18px; border-radius:12px; font-weight:900; width:100%; box-shadow:0 4px 15px rgba(16,185,129,0.3); border:none; cursor:pointer;">COMPROVANTE RECEBIDO (CONFIRMAR)</button>
        ` : ''}
        ${item.status !== 'pendente' ? `
          <button id="btn-conclude-service" style="background: #16a34a; color: white; padding: 18px; border-radius: 12px; font-weight: 800; width: 100%;">SERVIÇO CONCLUÍDO</button>
        ` : ''}
        <button id="btn-cancel-service" style="background: #dc2626; color: white; padding: 18px; border-radius: 12px; font-weight: 800; width: 100%;">CANCELAR SERVIÇO</button>
        <button id="btn-close-actions" style="color: var(--text-secondary); font-weight: 700; margin-top: 10px;">VOLTAR</button>
      </div>
    </div>
  `
}

// ─── Popup: Horário de funcionamento (setup/edit) ─────────────────────────────
function renderHorarioFuncionamentoModal() {
  const profile = appState.profile || {}
  const dias = Array.isArray(profile.dias_funcionamento) ? profile.dias_funcionamento : []
  const abertura = profile.horario_abertura || '09:00'
  const fechamento = profile.horario_fechamento || '18:00'
  const pausas = Array.isArray(profile.pausas_padrao) ? profile.pausas_padrao : []
  const isEdit = dias.length > 0

  const diasSemana = [
    { label: 'DOM', val: 0 }, { label: 'SEG', val: 1 },
    { label: 'TER', val: 2 }, { label: 'QUA', val: 3 },
    { label: 'QUI', val: 4 }, { label: 'SEX', val: 5 },
    { label: 'SÁB', val: 6 },
  ]

  const lbl = `font-size:0.7rem;font-weight:800;letter-spacing:1.5px;color:var(--text-secondary);margin-bottom:0.6rem;display:block;`
  const input = `width:100%;padding:0.8rem;border-radius:0.75rem;border:1.5px solid var(--border);background:var(--surface);color:var(--text-main);font-family:inherit;font-size:1rem;`
  const pausaRow = (p, i) => `
    <div class="pausa-row" data-idx="${i}" style="display:flex;gap:0.6rem;align-items:center;margin-bottom:0.5rem;">
      <input type="time" class="pausa-inicio" value="${p.inicio||''}" style="flex:1;${input}">
      <span style="color:var(--text-secondary);font-weight:700;font-size:0.85rem;">até</span>
      <input type="time" class="pausa-fim" value="${p.fim||''}" style="flex:1;${input}">
      <button class="btn-remove-pausa" style="background:none;border:none;color:var(--red);font-size:1.2rem;cursor:pointer;padding:0.25rem;flex-shrink:0;">✕</button>
    </div>`

  return `
    <div class="card animate-fade-in custom-scroll" style="max-width:440px;width:92%;padding:2rem;border-radius:1.5rem;max-height:90vh;overflow-y:auto;">
      <button id="btn-close-horario-x" style="position:absolute;top:1rem;right:1rem;background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-secondary);line-height:1;padding:0.5rem;z-index:99;">✕</button>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.5rem;">
        <h2 style="font-family:var(--font-alt);font-size:1.3rem;font-weight:900;line-height:1.2;">
          ${isEdit ? 'EDITAR' : 'CONFIGURE O'}<br>HORÁRIO DE<br>FUNCIONAMENTO
        </h2>
      </div>

      <span style="${lbl}">DIAS DE FUNCIONAMENTO</span>
      <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:1.5rem;">
        ${diasSemana.map(d => {
          const sel = dias.includes(d.val)
          return `<button class="dia-btn${sel?' dia-sel':''}" data-dia="${d.val}"
            style="padding:0.45rem 0.8rem;border-radius:0.75rem;border:1.5px solid ${sel?'var(--primary)':'var(--border)'};background:${sel?'var(--primary)':'transparent'};color:${sel?'var(--on-primary)':'var(--text-main)'};font-weight:800;font-size:0.75rem;cursor:pointer;transition:all 0.18s;">${d.label}</button>`
        }).join('')}
      </div>

      <span style="${lbl}">HORÁRIO DE FUNCIONAMENTO</span>
      <div style="display:flex;gap:0.75rem;margin-bottom:1.5rem;align-items:flex-end;">
        <div style="flex:1;">
          <label style="font-size:0.72rem;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:0.3rem;">Abertura</label>
          <input type="time" id="horario-abertura" value="${abertura}" style="${input}">
        </div>
        <span style="color:var(--text-secondary);font-weight:700;padding-bottom:0.85rem;">–</span>
        <div style="flex:1;">
          <label style="font-size:0.72rem;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:0.3rem;">Fechamento</label>
          <input type="time" id="horario-fechamento" value="${fechamento}" style="${input}">
        </div>
      </div>

      <button id="btn-add-pausa-padrao" style="display:block;width:100%;text-align:left;font-size:0.85rem;font-weight:800;color:var(--primary);background:none;border:none;cursor:pointer;padding:0.3rem 0;margin-bottom:0.6rem;">+ Adicionar Intervalo no expediente</button>
      <div id="pausas-padrao-list">
        ${pausas.length > 0
          ? pausas.map((p,i) => pausaRow(p,i)).join('')
          : `<p id="pausas-empty" style="font-size:0.8rem;color:var(--text-secondary);padding:0.4rem 0 0.6rem;">Nenhum intervalo configurado.</p>`
        }
      </div>

      <button id="btn-save-horario" style="width:100%;padding:1.1rem;border-radius:1rem;background:var(--primary);color:var(--on-primary);font-weight:900;font-size:0.88rem;letter-spacing:1.5px;border:none;cursor:pointer;margin-top:1.25rem;">SALVAR CONFIGURAÇÃO</button>
    </div>`
}

// ─── Popup: Fazer Pausa ───────────────────────────────────────────────────────
function renderFazPausaModal() {
  const now = new Date()
  const cur = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
  const inp = `width:100%;padding:0.8rem;border-radius:0.75rem;border:1.5px solid var(--border);background:var(--surface);color:var(--text-main);font-family:inherit;font-size:1rem;`
  return `
    <div class="card animate-fade-in" style="max-width:390px;width:92%;padding:2rem;border-radius:1.5rem;">
      <button id="btn-close-pausa-x" style="position:absolute;top:1rem;right:1rem;background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-secondary);line-height:1;padding:0.5rem;z-index:99;">✕</button>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.25rem;">
        <h2 style="font-family:var(--font-alt);font-size:1.3rem;font-weight:900;line-height:1.2;">FAZER PAUSA</h2>
      </div>
      <p style="font-size:0.85rem;color:var(--text-secondary);font-weight:600;margin-bottom:1.25rem;line-height:1.5;">
        Selecione o horário de início e fim da pausa de <strong>hoje</strong>. Agendamentos não serão aceitos neste intervalo.
      </p>
      <span style="font-size:0.7rem;font-weight:800;letter-spacing:1.5px;color:var(--text-secondary);display:block;margin-bottom:0.6rem;">HORÁRIO DA PAUSA</span>
      <div style="display:flex;gap:0.75rem;margin-bottom:1.25rem;align-items:flex-end;">
        <div style="flex:1;">
          <label style="font-size:0.72rem;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:0.3rem;">Início</label>
          <input type="time" id="pausa-inicio" value="${cur}" style="${inp}">
        </div>
        <span style="color:var(--text-secondary);font-weight:700;padding-bottom:0.85rem;">–</span>
        <div style="flex:1;">
          <label style="font-size:0.72rem;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:0.3rem;">Fim</label>
          <input type="time" id="pausa-fim" style="${inp}">
        </div>
      </div>
      <label style="display:flex;align-items:flex-start;gap:0.75rem;padding:1rem;border-radius:0.85rem;border:1.5px solid var(--border);cursor:pointer;margin-bottom:1.25rem;">
        <input type="checkbox" id="encerrar-dia" style="width:18px;height:18px;accent-color:var(--primary);margin-top:2px;flex-shrink:0;">
        <span style="font-size:0.875rem;font-weight:600;color:var(--text-main);">Encerrar o dia a partir deste horário<br><span style="color:var(--text-secondary);font-size:0.78rem;">Nenhum agendamento será aceito pelo restante do dia</span></span>
      </label>
      <button id="btn-confirmar-pausa" style="width:100%;padding:1.1rem;border-radius:1rem;background:var(--primary);color:var(--on-primary);font-weight:900;font-size:0.88rem;letter-spacing:1.5px;border:none;cursor:pointer;">CONFIRMAR PAUSA</button>
    </div>`
}

function renderServiceSearchSelect(inputId, listId, services) {
  if (!services || services.length === 0) {
    return `<p style="font-size:0.85rem; color: var(--text-secondary); padding: 12px; border: 1px dashed var(--border); border-radius: 12px; text-align:center;">
      Nenhum serviço cadastrado. Adicione em <strong>Serviços Fornecidos</strong> primeiro.
    </p>`
  }
  return `
    <div style="position:relative;">
      <div style="position:relative;">
        <input type="text" id="${inputId}" autocomplete="off" placeholder="Buscar serviço..."
          style="padding: 14px 14px 14px 40px; border-radius: 12px; width: 100%; box-sizing: border-box; border: 1.5px solid var(--border); background: var(--surface); font-family: inherit; font-size: 1rem; transition: all 0.2s;">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
          style="position:absolute; left:14px; top:50%; transform:translateY(-50%); color:var(--text-secondary); pointer-events:none;">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
      </div>
      <div id="${listId}" class="custom-scroll" style="display:none; position:absolute; left:0; right:0; max-height:225px; overflow-y:auto; border: 1.5px solid var(--border); border-radius: 12px; background: var(--surface); margin-top: 5px; z-index: 1000; box-shadow: var(--shadow-lg);">
        ${services.map(s => `
          <label class="service-opt" data-nome="${s.nome}">
            <input type="checkbox" value="${s.nome}">
            <span>${s.nome} <span class="price-tag">(R$ ${parseFloat(s.preco || 0).toFixed(2).replace('.', ',')})</span></span>
          </label>
        `).join('')}
      </div>
      <input type="hidden" id="${inputId}-selected" value="[]">
    </div>
  `
}

function attachServiceSearchSelect(inputId, listId, onSelectionChange) {
  const searchInput = document.getElementById(inputId)
  const listEl = document.getElementById(listId)
  const hiddenInput = document.getElementById(inputId + '-selected')
  if (!searchInput || !listEl) return

  const closeListHandler = (e) => {
    if (listEl && !searchInput.contains(e.target) && !listEl.contains(e.target)) {
      listEl.style.display = 'none' 
      searchInput.style.borderColor = 'var(--border)'
      document.removeEventListener('mousedown', closeListHandler)
    }
  }

  searchInput.addEventListener('focus', () => { 
    listEl.style.display = 'block'
    searchInput.style.borderColor = 'var(--primary)'
    setTimeout(() => document.addEventListener('mousedown', closeListHandler), 0)
  })

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase().trim()
    const selectedText = hiddenInput.value ? JSON.parse(hiddenInput.value).join(', ').toLowerCase() : ''
    
    const items = listEl.querySelectorAll('.service-opt')
    
    // Se o campo estiver vazio ou contiver exatamente a lista de selecionados, mostra tudo
    if (q === '' || q === selectedText) {
      items.forEach(opt => opt.style.display = 'flex')
    } else {
      // Caso contrário, filtra pelo que o usuário digitou
      // Se houver vírgulas (múltiplas seleções), pegamos o último pedaço após a última vírgula? 
      // Não, vamos filtrar o texto inteiro do input para ser mais simples e intuitivo.
      items.forEach(opt => {
        const text = opt.innerText.toLowerCase()
        opt.style.display = text.includes(q) ? 'flex' : 'none'
      })
    }
  })

  // Visual Check Logic
  const labels = listEl.querySelectorAll('.service-opt')
  labels.forEach(label => {
    const chk = label.querySelector('input[type="checkbox"]')
    
    // Initial state if already checked
    if (chk.checked) {
      label.classList.add('selected')
    }

    label.addEventListener('click', (e) => {
      // Prevent double trigger if clicking near the hidden input or if multiple events fire
      e.preventDefault();
      chk.checked = !chk.checked;
      chk.dispatchEvent(new Event('change'));
    })

    chk.onchange = () => {
      const allChecks = Array.from(listEl.querySelectorAll('input[type="checkbox"]'))
      const selected = allChecks.filter(c => c.checked).map(c => c.value)
      
      // Update visual style for all
      allChecks.forEach(c => {
        const parent = c.closest('.service-opt')
        if (c.checked) {
          parent.classList.add('selected')
        } else {
          parent.classList.remove('selected')
        }
      })

      hiddenInput.value = JSON.stringify(selected)
      searchInput.value = selected.join(', ')
      if (onSelectionChange) onSelectionChange(selected)
    }
  })
}

function renderQuickBookModal() {
  const item = appState.activeAgendaItem
  return `
    <div class="card animate-fade-in" style="max-width: 400px; width: 90%; padding: 32px; border-radius: 24px; text-align: left; align-items: stretch;">
      <button id="btn-close-quick-x" style="position:absolute;top:1rem;right:1rem;background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-secondary);line-height:1;padding:0.5rem;z-index:99;">✕</button>
      <h3 style="margin-bottom: 5px; font-family: var(--font-alt); color: var(--primary);">AGENDAR HORÁRIO</h3>
      <p style="color: var(--text-secondary); margin-bottom: 25px; font-weight: 600;">Horário selecionado: ${item.time}</p>
      
      <div class="flex flex-col gap-md">
        <div class="flex flex-col gap-xs">
          <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary);">NOME DO CLIENTE</label>
          <input type="text" id="quick-client-name" placeholder="Ex: João da Silva" maxlength="50" style="padding: 14px; border-radius: 12px;">
        </div>
        <div class="flex flex-col gap-xs">
          <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary);">TELEFONE (OPCIONAL)</label>
          <input type="tel" id="quick-client-phone" placeholder="(00) 00000-0000" style="padding: 14px; border-radius: 12px;">
        </div>
        <div class="flex flex-col gap-xs">
          <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary);">SERVIÇO</label>
          ${renderServiceSearchSelect('quick-service-search', 'quick-service-list', appState.servicosAtivos)}
        </div>
        
        <button id="btn-confirm-quick" style="background: var(--primary); color: var(--on-primary); padding: 18px; border-radius: 12px; font-weight: 800; margin-top: 15px;">CONFIRMAR AGENDAMENTO</button>
        <button id="btn-close-quick" style="color: var(--text-secondary); font-weight: 700; text-align: center; margin-top: 10px;">CANCELAR</button>
      </div>
    </div>
  `
}

function renderNewAgendamentoModal() {
  return `
    <div class="card animate-fade-in" style="max-width: 450px; width: 90%; padding: 32px; align-items: stretch; text-align: left; border-radius: 24px;">
      <button id="btn-close-modal" style="position:absolute;top:1rem;right:1rem;background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-secondary);line-height:1;padding:0.5rem;z-index:99;">✕</button>
      <div class="flex justify-between items-center" style="margin-bottom: 24px;">
        <h3 style="font-family: var(--font-alt); font-size: 1.2rem; color: var(--primary);">NOVO AGENDAMENTO</h3>
      </div>
      

      
      <div class="flex flex-col gap-md">
        <div class="flex flex-col gap-xs">
          <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Serviço Desejado</label>
          ${renderServiceSearchSelect('modal-service-search', 'modal-service-list', appState.servicosAtivos)}
        </div>

        <div class="flex flex-col gap-xs">
          <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Nome do Cliente</label>
          <input type="text" id="modal-client-name" placeholder="Ex: João Silva" maxlength="50" style="padding: 14px; border-radius: 12px; width: 100%; box-sizing: border-box;">
        </div>
        
        <div class="flex flex-col gap-xs">
          <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Telefone (Opcional)</label>
          <input type="tel" id="modal-client-phone" placeholder="(00) 00000-0000" style="padding: 14px; border-radius: 12px; width: 100%; box-sizing: border-box;">
        </div>
        
        <div class="modal-grid">
          <div class="flex flex-col gap-xs">
            <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Data</label>
            <input type="date" id="modal-date" style="padding: 14px; border-radius: 12px; font-family: inherit;">
          </div>
          <div class="flex flex-col gap-xs">
            <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Horário</label>
            <input type="time" id="modal-time" style="padding: 14px 10px; border-radius: 12px; font-family: inherit; text-align: center;">
          </div>
        </div>
        
        <button id="btn-save-agendamento" style="background: var(--primary); color: var(--on-primary); padding: 18px; border-radius: 12px; font-weight: 800; margin-top: 10px; letter-spacing: 1px;">
          CONFIRMAR AGENDAMENTO
        </button>
      </div>
    </div>
  `
}

function renderCalendarModal() {
  const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const d = appState.viewingDate;
  const month = d.getMonth();
  const year = d.getFullYear();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let daysHtml = '';
  for (let i = 0; i < firstDay; i++) {
    daysHtml += '<div class="calendar-day empty"></div>';
  }

  for (let i = 1; i <= daysInMonth; i++) {
    let dateToCompare = appState.selectedDate;
    if (appState.calendarContext === 'new-transaction') {
      dateToCompare = new Date(appState.financasData.tempDate + 'T00:00:00');
    } else if (appState.calendarContext === 'edit-transaction') {
      dateToCompare = new Date(appState.financasData.activeTransaction.fullDate + 'T00:00:00');
    }

    const isSelected = i === dateToCompare.getDate() &&
      month === dateToCompare.getMonth() &&
      year === dateToCompare.getFullYear();
    daysHtml += `<div class="calendar-day ${isSelected ? 'selected' : ''}" data-day="${i}">${i}</div>`;
  }

  return `
    <div class="calendar-modal card animate-fade-in" style="max-width: 380px; width: 95%; padding: 24px; border-radius: 24px; border: 2px solid var(--primary);">
      <div class="flex justify-between items-center w-full" style="margin-bottom: 20px;">
        <button id="cal-prev" style="padding: 8px;">${icons.back}</button>
        <h3 style="font-family: var(--font-alt); font-size: 1rem; text-transform: uppercase; letter-spacing: 1px;">
          ${monthNames[month]} ${year}
        </h3>
        <button id="cal-next" style="padding: 8px; transform: rotate(180deg);">${icons.back}</button>
      </div>
      
      <div class="calendar-grid" style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; width: 100%;">
        ${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(day => `
          <div style="font-size: 0.7rem; font-weight: 800; color: var(--text-secondary); padding: 10px 0;">${day}</div>
        `).join('')}
        ${daysHtml}
      </div>
      
      <button id="btn-close-calendar" style="margin-top: 20px; color: var(--primary); font-weight: 700; font-size: 0.9rem;">FECHAR</button>
    </div>
  `
}

// ---------- DB helpers ----------
function dbTransToLocal(row) {
  const type = row.tipo === 'entrada' ? 'in' : 'out';
  const cat = row.categoria === 'Entrada' ? '' : row.categoria;
  const dp = row.data_transacao.split('-');
  // Extract time from created_at timestamp
  let timeStr = ''
  if (row.created_at) {
    const d = new Date(row.created_at)
    timeStr = ` - ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  }
  let finalDesc = row.descricao;
  const isTemplate = finalDesc.includes('[TEMPLATE]');
  if (isTemplate) {
    finalDesc = finalDesc.replace(' [TEMPLATE]', '');
  }

  let fixedCompetence = null;
  const refMatch = finalDesc.match(/ \[REF:(\d{2})\/(\d{4})\]/);
  if (refMatch) {
    fixedCompetence = `${refMatch[2]}-${refMatch[1]}`; // YYYY-MM
    finalDesc = finalDesc.replace(refMatch[0], '');
  }

  return {
    id: row.id,
    desc: finalDesc,
    val: Number(row.valor),
    type, 
    cat: row.categoria === 'Entrada' ? '' : row.categoria,
    date: `${dp[2]}/${dp[1]}${timeStr}`,
    fullDate: row.data_transacao,
    rawCreatedAt: row.created_at,
    agendamentoId: row.agendamento_id,
    isFixed: row.categoria === 'Fixo',
    fixedCompetence,
    isTemplate
  };
}

function localTransToDb(desc, val, typeFull, dateInput, userId) {
  const tipo = typeFull.startsWith('in') ? 'entrada' : 'saida';
  const categoria = typeFull === 'in' ? 'Entrada' : (typeFull === 'out-fixo' ? 'Fixo' : 'Variável');
  const finalDesc = typeFull === 'out-fixo' ? `${desc} [TEMPLATE]` : desc;
  return { estabelecimento_id: userId, descricao: finalDesc, valor: val, tipo, categoria, data_transacao: dateInput };
}

// Unified helper to get transactions for a month, including virtual recurring fixed expenses
function getMonthlyTransactions(month, year, allTransactions) {
  const transactionsWithIdx = allTransactions.map((t, i) => ({ ...t, originalIndex: i }));

  // Real transactions in this month
  const realThisMonth = transactionsWithIdx.filter(t => {
    if (t.isTemplate) return false;
    const d = t.fullDate ? new Date(t.fullDate + 'T12:00:00') : null;
    return d && d.getMonth() === month && d.getFullYear() === year;
  });

  // Fixed expenses registered in previous months (or current month if template)
  const fixedExpenses = allTransactions.filter(t => t.isFixed);
  
  // Pagamentos feitos em QUALQUER mês, especificamente para ESTE mês
  const futuresForThisMonth = fixedExpenses.filter(t => t.fixedCompetence === `${year}-${String(month + 1).padStart(2,'0')}`);

  // Pagamentos feitos NESTE mês, mas especificamente para OUTRO mês
  const paymentsForOtherMonths = realThisMonth.filter(t => t.fixedCompetence && t.fixedCompetence !== `${year}-${String(month + 1).padStart(2,'0')}`);

  // Nomes das despesas fixas já pagas (convencionalmente ou especificamente)
  const fixedThisMonthNames = [
    ...realThisMonth.filter(t => t.isFixed && !paymentsForOtherMonths.includes(t)).map(t => t.desc.toLowerCase()),
    ...futuresForThisMonth.map(t => t.desc.toLowerCase())
  ];

  // Virtual fixed entries (not yet paid this month)
  const virtualFixed = fixedExpenses
    .filter(t => {
      if (!t.fullDate) return false;
      const d = new Date(t.fullDate + 'T12:00:00');
      let createdBeforeOrDuring = false;
      if (t.isTemplate) {
        createdBeforeOrDuring = (d.getFullYear() < year) || (d.getFullYear() === year && d.getMonth() <= month);
      } else {
        createdBeforeOrDuring = (d.getFullYear() < year) || (d.getFullYear() === year && d.getMonth() < month);
      }
      const alreadyPaid = fixedThisMonthNames.includes(t.desc.toLowerCase());
      return createdBeforeOrDuring && !alreadyPaid;
    })
    // Deduplicate by name (only one per month)
    .filter((t, i, arr) => arr.findIndex(x => x.desc.toLowerCase() === t.desc.toLowerCase()) === i)
    .map(t => ({
      ...t,
      id: `virtual-${t.id}`,
      fullDate: `${year}-${String(month + 1).padStart(2,'0')}-01`,
      date: `01/${String(month + 1).padStart(2,'0')}`,
      originalIndex: -1,
      isVirtual: true,
      ignoreInTotals: true
    }));

  const monthlyTransactions = [...realThisMonth, ...virtualFixed];
  
  const injectedFutures = futuresForThisMonth.map(t => ({
    ...t,
    isVirtual: false,
    originalIndex: -1,
    ignoreInTotals: true 
  }));

  return [...monthlyTransactions, ...injectedFutures].sort((a, b) => {
    const timeA = a.rawCreatedAt ? new Date(a.rawCreatedAt).getTime() : 0;
    const timeB = b.rawCreatedAt ? new Date(b.rawCreatedAt).getTime() : 0;
    return timeB - timeA;
  });
}

// ---------------------------------

function renderFinancas() {
  const monthNames = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
  const { month, year, transactions, filterByDay, categoryFilter } = appState.financasData;

  const monthlyTransactions = getMonthlyTransactions(month, year, transactions);

  const totalIn = monthlyTransactions.filter(t => t.type === 'in' && !t.ignoreInTotals).reduce((acc, t) => acc + t.val, 0);
  const totalOut = monthlyTransactions.filter(t => t.type === 'out' && !t.ignoreInTotals).reduce((acc, t) => acc + t.val, 0);
  const balance = totalIn - totalOut;

  // Filter list by day if enabled
  let filteredList = monthlyTransactions;
  if (filterByDay) {
    const selectedKey = getAgendaDayKey(appState.selectedDate);
    filteredList = monthlyTransactions.filter(t => t.fullDate === selectedKey);
  }

  return renderTabHeader('CONTROLE FINANCEIRO', `
    <div class="financas-content p-lg animate-fade-in" style="max-width: 50rem; margin: 0 auto; padding: 1rem;">
      
      <!-- Filter Badge -->
      ${filterByDay ? `
        <div style="background: var(--surface); padding: 0.625rem 1rem; border-radius: 0.75rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
           <span style="font-size: 0.8rem; font-weight: 700;">Filtrando por: ${appState.selectedDate.toLocaleDateString('pt-BR')}</span>
           <button id="btn-clear-filter" style="color: var(--primary); font-size: 0.75rem; font-weight: 800; letter-spacing: 0.5px;">VER MÊS INTEIRO</button>
        </div>
      ` : ''}

      <!-- Month Selector -->
      <div class="flex justify-between items-center" style="margin-bottom: 1.5rem;">
        <button id="btn-month-prev" class="p-sm" style="background: var(--surface); border-radius: 50%; width: 2.25rem; height: 2.25rem; display: flex; align-items: center; justify-content: center;">${icons.back}</button>
        <h3 style="font-family: var(--font-alt); text-transform: uppercase; font-size: 0.9rem; font-weight: 800; letter-spacing: 1px;">${monthNames[month]} ${year}</h3>
        <button id="btn-month-next" class="p-sm" style="transform: rotate(180deg); background: var(--surface); border-radius: 50%; width: 2.25rem; height: 2.25rem; display: flex; align-items: center; justify-content: center;">${icons.back}</button>
      </div>

      <!-- Balance Card -->
      <div style="margin-bottom: 1.5rem; padding: 2rem; background: var(--surface); color: var(--text-main); border: 2.5px solid var(--primary); box-shadow: var(--shadow-md); display: flex; flex-direction: column; align-items: flex-start; text-align: left; border-radius: 1.25rem; backdrop-filter: blur(5px); position: relative;">
        <p style="font-size: 0.75rem; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; color: var(--primary);">Resumo do Mês</p>
        <div style="margin: 0.75rem 0; color: ${balance >= 0 ? '#16a34a' : '#dc2626'};">
          <span style="font-size: 1.5rem; font-weight: 800; vertical-align: top; margin-top: 0.4rem; display: inline-block;">R$</span>
          <h1 style="font-size: clamp(2rem, 4vw, 3rem); display: inline-block; margin-left: 0.4rem; font-family: var(--font-body); font-weight: 900;">${balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h1>
        </div>
        <div class="flex gap-md" style="margin-top: 0.5rem; flex-wrap: wrap;">
          <div class="flex items-center gap-xs" style="background: transparent; padding: 0.5rem 1rem; border-radius: 3rem; font-weight: 800; font-size: 0.8rem; color: #16a34a; border: 1.5px solid var(--primary);">
            Entradas R$ ${totalIn.toLocaleString('pt-BR')}
          </div>
          <div class="flex items-center gap-xs" style="background: transparent; padding: 0.5rem 1rem; border-radius: 3rem; font-weight: 800; font-size: 0.8rem; color: #dc2626; border: 1.5px solid var(--primary);">
            Saídas R$ ${totalOut.toLocaleString('pt-BR')}
          </div>
        </div>
      </div>

      <!-- List Title -->
      <div class="flex items-center gap-md" style="margin-bottom: 1.25rem; justify-content: space-between; width: 100%;">
        <h3 style="font-size: 0.85rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px;">
          ${filterByDay ? 'Transações do Dia' : 'Fluxo de Caixa'}
        </h3>
        <button id="btn-print" style="color: var(--on-primary); font-size: 0.75rem; font-weight: 900; letter-spacing: 1.5px; text-transform: uppercase; background: var(--primary); padding: 0.75rem 1.5rem; border-radius: 3rem; box-shadow: var(--shadow-md); transition: all 0.2s;">
           Relatórios
        </button>
      </div>

      <!-- Filters -->
      <div class="flex gap-xs w-full" style="overflow-x: auto; padding-bottom: 1rem; margin-bottom: 0.25rem; scrollbar-width: none;">
        ${['Todos', 'Entradas', 'Fixas', 'Variáveis'].map(f => `
          <button class="filter-chip ${categoryFilter === f ? 'active' : ''}" data-filter="${f}" style="${categoryFilter === f ? 'background: var(--primary); color: var(--on-primary);' : 'border: 1px solid var(--border); color: var(--text-secondary);'} padding: 0.6rem 1.25rem; border-radius: 2rem; font-weight: 800; font-size: 0.75rem; transition: all 0.2s; white-space: nowrap;">
            ${f}
          </button>
        `).join('')}
      </div>

      <!-- List -->
      <div class="transactions-list flex flex-col gap-sm" style="padding-bottom: 6rem;">
        ${(() => {
      let list = filteredList;
      if (categoryFilter === 'Entradas') list = list.filter(t => t.type === 'in');
      if (categoryFilter === 'Fixas') list = list.filter(t => t.cat === 'Fixo');
      if (categoryFilter === 'Variáveis') list = list.filter(t => t.cat === 'Variável');

      return list.length ? list.map((t, tIdx) => {
        const isFromAgenda = Boolean(t.agendamentoId)
        const valColor = t.type === 'in' ? '#16a34a' : '#dc2626'
        const valSign = t.type === 'in' ? '+' : '-'
        
        return `
          <div style="position:relative; margin-top:16px; border: 1.5px solid #d1d5db; border-radius:16px; background:#fff; overflow:visible;">
            <!-- Date Header floating center -->
            <div style="position:absolute; top:-10px; left:50%; transform:translateX(-50%); background:#fff; padding:0 12px; font-size:0.72rem; font-weight:700; color:#6b7280; white-space:nowrap; letter-spacing:0.3px;">
              ${t.date}
            </div>
            <!-- Row: [content left] [icons right] -->
            <div style="display:flex; flex-direction:row; align-items:flex-start; padding:18px 12px 16px 16px; gap:12px;">
              <!-- Left: all stacked -->
              <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:6px;">
                <!-- Value -->
                <span style="color:${valColor}; font-weight:800; font-size:1rem; line-height:1.2;">
                  ${valSign} R$${t.val.toFixed(2).replace('.',',')}
                </span>
                <!-- Name -->
                <h4 style="font-size:0.95rem; font-weight:800; color:#111; margin:0; line-height:1.3; word-break:break-word;">
                  ${t.desc}
                </h4>
                ${t.cat && t.cat !== 'Entrada' ? `
                  <!-- Service -->
                  <div style="display:flex; align-items:center; gap:8px;">
                    <p style="font-size:0.82rem; color:#4b5563; font-weight:500; font-style:italic; margin:0; line-height:1.3; word-break:break-word;">
                      ${t.cat}
                    </p>
                    ${t.cat === 'Fixo' && !t.isVirtual ? `
                      <span style="font-size:0.6rem; font-weight:900; background:#dcfce7; color:#166534; padding:2px 6px; border-radius:4px; letter-spacing:0.5px;">✓ PAGO</span>
                    ` : ''}
                  </div>
                ` : ''}
              </div>
              <!-- Right: Actions column -->
              <div style="flex-shrink:0; display:flex; flex-direction:column; align-items:center; gap:8px;" class="no-print">
                ${t.isVirtual ? `
                  <button class="btn-pay-fixed ripple" data-desc="${t.desc}" data-val="${t.val}" data-full-date="${t.fullDate}" style="background:#dc2626; color:white; border:none; padding:4px 10px; border-radius:6px; font-size:0.65rem; font-weight:900; letter-spacing:0.5px;">PAGAR AGORA</button>
                  <button class="btn-edit-trans" data-dbid="${t.id.replace('virtual-','')}" title="Editar Todas" style="background:none;border:none;cursor:pointer;padding:2px;font-size:1.1rem;line-height:1;">✏️</button>
                  <button class="btn-delete-trans-all" data-desc="${t.desc}" title="Excluir Transação Fixa" style="background:none;border:none;cursor:pointer;padding:2px;font-size:1.1rem;line-height:1;">🗑️</button>
                ` : `
                  <button class="btn-edit-trans" data-dbid="${t.id}" title="Editar" style="background:none;border:none;cursor:pointer;padding:2px;font-size:1.1rem;line-height:1;">✏️</button>
                  ${isFromAgenda ? `
                    <button class="btn-reverse-trans" data-dbid="${t.id}" data-agendaid="${t.agendamentoId}" title="Estornar" style="background:none;border:none;cursor:pointer;padding:2px;font-size:1.1rem;line-height:1;">🔄</button>
                    <button class="btn-delete-trans" data-dbid="${t.id}" title="Excluir" style="background:none;border:none;cursor:pointer;padding:2px;font-size:1.1rem;line-height:1;">🗑️</button>
                  ` : (t.cat === 'Fixo' ? `
                    <button class="btn-reverse-fixed-payment" data-dbid="${t.id}" title="Estornar Pagamento Fixo" style="background:none;border:none;cursor:pointer;padding:2px;font-size:1.1rem;line-height:1;">🔄</button>
                    <button class="btn-delete-trans-all" data-desc="${t.desc}" title="Excluir" style="background:none;border:none;cursor:pointer;padding:2px;font-size:1.1rem;line-height:1;">🗑️</button>
                  ` : `
                    <button class="btn-delete-trans" data-dbid="${t.id}" title="Excluir" style="background:none;border:none;cursor:pointer;padding:2px;font-size:1.1rem;line-height:1;">🗑️</button>
                  `)}
                `}
              </div>
            </div>
          </div>
        `
      }).join('') : '<p style="text-align: center; color: var(--text-secondary); font-size: 0.8rem; padding: 40px;">Nenhum detalhe encontrado para este filtro.</p>'
    })()}
      </div>
    </div>
    <button id="btn-add-trans" class="fab ripple" style="position: fixed; bottom: 30px; right: 30px; padding: 0 16px; height: 48px; background: var(--primary); color: var(--on-primary); border-radius: 24px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 15px var(--glow); z-index: 9999; gap: 8px;">
        ${icons.plus} <span style="font-weight: 700; font-size: 0.8rem; letter-spacing: 0.5px;">NOVA TRANSAÇÃO</span>
    </button>
  `, false)
}

function renderPrintOptionsModal() {
  return `
    <div class="card animate-fade-in" style="max-width: 400px; width: 90%; padding: 32px; border-radius: 24px;">
      <button id="btn-close-print-modal-x" style="position:absolute;top:1rem;right:1rem;background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-secondary);line-height:1;padding:0.5rem;z-index:99;">✕</button>
      <h3 style="margin-bottom: 20px; font-family: var(--font-alt); color: var(--primary); text-transform: uppercase;">Escolha o Relatório</h3>
      
      <div class="flex flex-col gap-md w-full">
        <button id="btn-report-monthly" style="background: var(--surface); padding: 20px; border-radius: 12px; font-weight: 800; width: 100%; text-align: left; display: flex; justify-content: space-between; align-items: center;">
           <span>RELATÓRIO MENSAL</span>
           <span>${icons.back}</span>
        </button>
        <button id="btn-report-annual" style="background: var(--surface); padding: 20px; border-radius: 12px; font-weight: 800; width: 100%; text-align: left; display: flex; justify-content: space-between; align-items: center;">
           <span>RESUMO ANUAL</span>
           <span>${icons.back}</span>
        </button>
        <button id="btn-close-print-modal" style="color: var(--text-secondary); font-weight: 700; margin-top: 10px;">VOLTAR</button>
      </div>
    </div>
  `
}

function renderMonthlyReport() {
  const { month, year, transactions } = appState.financasData;
  const monthNames = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];

  const monthly = getMonthlyTransactions(month, year, transactions);

  const totalIn = monthly.filter(t => t.type === 'in' && !t.ignoreInTotals).reduce((acc, t) => acc + t.val, 0);
  const totalOut = monthly.filter(t => t.type === 'out' && !t.ignoreInTotals).reduce((acc, t) => acc + t.val, 0);

  return `
    <div id="printable-report" style="padding: 40px 20px; color: #1a1a1a; font-family: 'Inter', sans-serif; background: white; min-height: 100vh; max-width: 900px; margin: 0 auto;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px;" class="no-print">
         <button id="btn-close-report" style="padding: 10px; background: #f4f4f5; border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer; border: none; color: var(--primary);">${icons.back}</button>
         <button onclick="window.print()" style="padding: 10px; background: #1a1a1a; color: white; border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer; border: none;">${icons.print}</button>
      </div>

      <div style="text-align: center; margin-bottom: 60px;">
        <h1 style="font-size: 1.8rem; letter-spacing: 4px; font-weight: 900; margin-bottom: 8px; font-family: serif;">RELATÓRIO FINANCEIRO</h1>
        <p style="font-weight: 700; color: #4b5563; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 2px;">${monthNames[month]} ${year}</p>
        <div style="width: 120px; height: 2px; background: #1a1a1a; margin: 25px auto;"></div>
      </div>

      <div style="display: flex; gap: 10px; margin-bottom: 40px; justify-content: space-between; width: 100%;">
        <div style="flex: 1; border: 1.5px solid #e5e7eb; padding: 15px 10px; border-radius: 12px; text-align: center; min-width: 0;">
          <p style="font-size: 0.6rem; font-weight: 800; color: #9ca3af; margin-bottom: 5px; letter-spacing: 0.5px;">ENTRADAS</p>
          <p style="font-size: 1rem; font-weight: 900;" class="report-in">R$ ${totalIn.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
        </div>
        <div style="flex: 1; border: 1.5px solid #e5e7eb; padding: 15px 10px; border-radius: 12px; text-align: center; min-width: 0;">
          <p style="font-size: 0.6rem; font-weight: 800; color: #9ca3af; margin-bottom: 5px; letter-spacing: 0.5px;">SAÍDAS</p>
          <p style="font-size: 1rem; font-weight: 900;" class="report-out">R$ ${totalOut.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
        </div>
        <div style="flex: 1; background: #f9fafb; border: 1.5px solid #1a1a1a; padding: 15px 10px; border-radius: 12px; text-align: center; min-width: 0;">
          <p style="font-size: 0.6rem; font-weight: 800; color: #1a1a1a; margin-bottom: 5px; letter-spacing: 0.5px;">SALDO FINAL</p>
          <p style="font-size: 1rem; font-weight: 900;" class="report-total ${totalIn - totalOut >= 0 ? 'in' : 'out'}">R$ ${(totalIn - totalOut).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
        </div>
      </div>

      <div class="report-list" style="border-top: 2px solid #1a1a1a; padding-top: 10px;">
         <div style="display: flex; justify-content: space-between; font-size: 0.7rem; font-weight: 900; color: #6b7280; text-transform: uppercase; padding: 10px 0; border-bottom: 1px solid #ddd;">
            <span>DETALHAMENTO POR DATA</span>
            <span>FLUXO / VALOR</span>
         </div>
         
         ${monthly.sort((a, b) => b.fullDate.localeCompare(a.fullDate)).map(t => `
            <div style="padding: 20px 0; border-bottom: 1px solid #f3f4f6;">
               <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
                  <span style="font-weight: 800; font-size: 1rem;">${t.fullDate ? new Date(t.fullDate + 'T12:00:00').toLocaleDateString('pt-BR') : t.date}</span>
                  <span style="font-weight: 900; font-size: 1rem;" class="${t.type === 'in' ? 'report-in' : 'report-out'}">
                    ${t.type === 'in' ? '+' : '-'} R$ ${t.val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
               </div>
               <div style="font-size: 0.85rem; color: #4b5563; font-weight: 500; display: flex; align-items: center; gap: 10px;">
                  ${t.desc.toUpperCase()}
                  ${t.cat ? `<span style="font-size: 0.6rem; border: 1px solid #e5e7eb; padding: 2px 6px; border-radius: 4px; color: #6b7280; font-weight: 700;">${t.cat.toUpperCase()}</span>` : ''}
               </div>
            </div>
         `).join('')}
      </div>
      
    </div>
  `
}

function renderAnnualReport() {
  const { year, transactions } = appState.financasData;
  const monthNamesFull = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];

  const annualSummary = monthNamesFull.map((name, idx) => {
    const monthlyItems = getMonthlyTransactions(idx, year, transactions);
    const ent = monthlyItems.filter(t => t.type === 'in' && !t.ignoreInTotals).reduce((acc, t) => acc + t.val, 0);
    const sai = monthlyItems.filter(t => t.type === 'out' && !t.ignoreInTotals).reduce((acc, t) => acc + t.val, 0);
    return { name, ent, sai, sal: ent - sai };
  });

  const yearEnt = annualSummary.reduce((acc, m) => acc + m.ent, 0);
  const yearSai = annualSummary.reduce((acc, m) => acc + m.sai, 0);
  const yearBalance = yearEnt - yearSai;

  return `
    <div id="printable-report" style="padding: 40px 20px; color: #1a1a1a; font-family: 'Inter', sans-serif; background: white; min-height: 100vh; max-width: 900px; margin: 0 auto;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px;" class="no-print">
           <button id="btn-close-report" style="padding: 10px; background: #f4f4f5; border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer; border: none; color: var(--primary);">${icons.back}</button>
           <button onclick="window.print()" style="padding: 10px; background: #1a1a1a; color: white; border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer; border: none;">${icons.print}</button>
      </div>

        <div style="text-align: center; margin-bottom: 60px;">
          <h1 style="font-size: 1.8rem; letter-spacing: 4px; font-weight: 900; margin-bottom: 10px; font-family: serif;">RESUMO ANUAL FINANCEIRO</h1>
          <p style="font-weight: 700; color: #4b5563; font-size: 0.9rem; letter-spacing: 2px;">EXERCÍCIO DE ${year}</p>
          <div style="width: 150px; height: 3px; background: #1a1a1a; margin: 25px auto;"></div>
        </div>

        <div style="display: flex; gap: 10px; margin-bottom: 40px; justify-content: space-between; width: 100%;">
          <div style="flex: 1; border: 1.5px solid #e5e7eb; padding: 15px 10px; border-radius: 12px; text-align: center; min-width: 0;">
            <p style="font-size: 0.6rem; font-weight: 800; color: #9ca3af; margin-bottom: 5px; letter-spacing: 0.5px;">ENTRADAS</p>
            <p style="font-size: 1rem; font-weight: 900;" class="report-in">R$ ${yearEnt.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          </div>
          <div style="flex: 1; border: 1.5px solid #e5e7eb; padding: 15px 10px; border-radius: 12px; text-align: center; min-width: 0;">
            <p style="font-size: 0.6rem; font-weight: 800; color: #9ca3af; margin-bottom: 5px; letter-spacing: 0.5px;">SAÍDAS</p>
            <p style="font-size: 1rem; font-weight: 900;" class="report-out">R$ ${yearSai.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          </div>
          <div style="flex: 1; background: #f9fafb; border: 1.5px solid #1a1a1a; padding: 15px 10px; border-radius: 12px; text-align: center; min-width: 0;">
            <p style="font-size: 0.6rem; font-weight: 800; color: #1a1a1a; margin-bottom: 5px; letter-spacing: 0.5px;">SALDO FINAL</p>
            <p style="font-size: 1rem; font-weight: 900;" class="report-total ${yearBalance >= 0 ? 'in' : 'out'}">R$ ${yearBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          </div>
        </div>

        <h3 class="no-print" style="font-size: 1rem; margin-bottom: 25px; font-weight: 800; border-left: 4px solid #1a1a1a; padding-left: 15px;">Detalhamento por Período</h3>
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
          <thead>
            <tr style="text-align: left; font-size: 0.65rem; text-transform: uppercase; color: #6b7280; border-bottom: 2px solid #1a1a1a;">
              <th style="padding: 10px 0;">COMPETÊNCIA</th>
              <th style="text-align: right; padding: 10px 0;">ENTRADAS</th>
              <th style="text-align: right; padding: 10px 0;">SAÍDAS</th>
              <th style="text-align: right; padding: 10px 0;">SALDO</th>
            </tr>
          </thead>
          <tbody>
            ${annualSummary.map(m => `
              <tr style="border-bottom: 1px solid #f3f4f6; font-size: 0.95rem;">
                <td style="padding: 12px 0; font-weight: 700;">${m.name}</td>
                <td style="text-align: right; color: #374151;">R$ ${m.ent.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td style="text-align: right; color: #374151;">R$ ${m.sai.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td style="text-align: right; font-weight: 800;" class="${m.sal >= 0 ? 'report-in' : 'report-out'}">
                  R$ ${m.sal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `
}

function renderEditTransactionModal() {
  const t = appState.financasData.activeTransaction;
  if (!t) return '';

  const typeVal = t.type === 'in' ? 'in' : (t.cat === 'Fixo' ? 'out-fixo' : 'out-variavel');

  return `
    <div class="card animate-fade-in" style="max-width: 400px; width: 90%; padding: 32px; border-radius: 24px; text-align: left; align-items: stretch;">
      <button id="btn-close-edit-trans-x" style="position:absolute;top:1rem;right:1rem;background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-secondary);line-height:1;padding:0.5rem;z-index:99;">✕</button>
      <h3 style="margin-bottom: 25px; font-family: var(--font-alt); color: var(--primary);">EDITAR TRANSAÇÃO</h3>
      
      <div class="flex flex-col gap-md">
        <div class="flex flex-col gap-xs">
          <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary);">DESCRIÇÃO</label>
          <input type="text" id="edit-trans-desc" value="${t.desc}" autocapitalize="words" style="padding: 14px; border-radius: 12px; text-transform: capitalize;">
        </div>
        
        <div class="modal-grid">
           <div class="flex flex-col gap-xs">
            <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary);">VALOR (R$)</label>
            <input type="text" id="edit-trans-val" value="R$ ${Number(t.val).toFixed(2).replace('.', ',')}" placeholder="R$ 0,00" style="padding: 14px 10px; border-radius: 12px; width: 100%; font-weight: 700;">
          </div>
          <div class="flex flex-col gap-xs">
            <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary);">DATA</label>
            <button id="btn-edit-trans-date" style="padding: 14px 10px; border-radius: 12px; width: 100%; font-size: 0.8rem; border: 1px solid var(--border); background: var(--background); font-weight: 700; text-align: left; display: flex; align-items: center; justify-content: space-between;">
              ${t.fullDate.split('-').reverse().join('/')}
              ${icons.calendar}
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-xs">
          <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary);">TIPO / CATEGORIA</label>
          <select id="edit-trans-type" style="padding: 14px; border-radius: 12px; width: 100%; border: 1px solid var(--border); background: var(--background); font-weight: 700; color: ${typeVal === 'in' ? '#16a34a' : '#dc2626'};">
            <option value="in" ${typeVal === 'in' ? 'selected' : ''} style="color: #16a34a; font-weight: 800;">Entrada (+)</option>
            <option value="out-fixo" ${typeVal === 'out-fixo' ? 'selected' : ''} style="color: #dc2626; font-weight: 800;">Saída Fixa (-)</option>
            <option value="out-variavel" ${typeVal === 'out-variavel' ? 'selected' : ''} style="color: #dc2626; font-weight: 800;">Saída Variável (-)</option>
          </select>
        </div>
        
        <button id="btn-save-edit-trans" style="background: var(--primary); color: var(--on-primary); padding: 18px; border-radius: 12px; font-weight: 800; margin-top: 15px; letter-spacing: 1px;">SALVAR ALTERAÇÕES</button>
        <button id="btn-close-edit-trans" style="color: var(--text-secondary); font-weight: 700; text-align: center; margin-top: 10px;">CANCELAR</button>
      </div>
    </div>
  `
}

function renderNewTransactionModal() {
  return `
    <div class="card animate-fade-in" style="max-width: 400px; width: 90%; padding: 32px; border-radius: 24px; text-align: left; align-items: stretch;">
      <button id="btn-close-trans-x" style="position:absolute;top:1rem;right:1rem;background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-secondary);line-height:1;padding:0.5rem;z-index:99;">✕</button>
      <h3 style="margin-bottom: 25px; font-family: var(--font-alt); color: var(--primary);">NOVA TRANSAÇÃO</h3>
      
      <div class="flex flex-col gap-md">
        <div class="flex flex-col gap-xs">
          <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary);">DESCRIÇÃO</label>
          <input type="text" id="trans-desc" placeholder="Ex: Pagamento Fornecedor" autocapitalize="words" style="padding: 14px; border-radius: 12px; text-transform: capitalize;">
        </div>
        
        <div class="modal-grid">
           <div class="flex flex-col gap-xs">
            <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary);">VALOR (R$)</label>
            <input type="text" id="trans-val" placeholder="R$ 0,00" style="padding: 14px 10px; border-radius: 12px; width: 100%; font-weight: 700;">
          </div>
          <div class="flex flex-col gap-xs">
            <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary);">DATA</label>
            <button id="btn-new-trans-date" style="padding: 14px 10px; border-radius: 12px; width: 100%; font-size: 0.8rem; border: 1px solid var(--border); background: var(--background); font-weight: 700; text-align: left; display: flex; align-items: center; justify-content: space-between;">
              ${appState.financasData.tempDate.split('-').reverse().join('/')}
              ${icons.calendar}
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-xs">
          <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary);">TIPO / CATEGORIA</label>
          <select id="trans-type" style="padding: 14px; border-radius: 12px; width: 100%; border: 1px solid var(--border); background: var(--background); font-weight: 700; color: #16a34a;">
            <option value="in" style="color: #16a34a; font-weight: 800;">Entrada (+)</option>
            <option value="out-fixo" style="color: #dc2626; font-weight: 800;">Saída Fixa (-)</option>
            <option value="out-variavel" style="color: #dc2626; font-weight: 800;">Saída Variável (-)</option>
          </select>
        </div>
        
        <button id="btn-confirm-trans" style="background: var(--primary); color: var(--on-primary); padding: 18px; border-radius: 12px; font-weight: 800; margin-top: 15px; letter-spacing: 1px;">LANÇAR TRANSAÇÃO</button>
        <button id="btn-close-trans" style="color: var(--text-secondary); font-weight: 700; text-align: center; margin-top: 10px;">CANCELAR</button>
      </div>
    </div>
  `
}

function renderServicos() {
  return renderTabHeader('Serviços Fornecidos', `
    <div class="servicos-content p-lg animate-fade-in" style="max-width: 60rem; margin: 0 auto; padding: 1.25rem;">
      <div class="card" style="padding: 2rem; margin-bottom: 2.5rem; align-items: stretch;">
        <h3 style="margin-bottom: 1.5rem; text-align: left; font-size: 1.1rem; border-left: 4px solid var(--primary); padding-left: 1rem;">CADASTRAR NOVO SERVIÇO</h3>
        <div class="flex flex-col gap-md">
          <input type="text" id="input-nome-servico" value="${appState.servicosForm.name}" placeholder="Nome do Serviço" style="padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border); width: 100%; font-weight: 500;">
          
          <div style="display: flex; gap: 1rem; width: 100%;">
            <div style="flex: 1; display: flex; flex-direction: column; gap: 0.2rem;">
              <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Preço</label>
              <input type="text" id="input-preco-servico" value="${appState.servicosForm.price}" placeholder="R$ 0,00" style="padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border); font-weight: 500; width: 100%;">
            </div>
            <div style="flex: 1; display: flex; flex-direction: column; gap: 0.2rem;">
              <label style="font-size: 0.7rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Duração</label>
              <input type="time" id="input-duracao-servico" value="${appState.servicosForm.duration}" style="padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border); font-weight: 500; width: 100%;">
            </div>
          </div>

          <div class="flex flex-col" style="gap: 1rem; margin-top: 0.5rem; border-top: 1px solid var(--border); padding-top: 1.5rem;">
            <div class="flex items-center justify-between" style="gap: 1rem;">
              <span style="font-weight: 600; font-size: 0.95rem; text-align: left; color: var(--text-secondary);">Deseja cobrar uma taxa para reservas?</span>
              <div id="toggle-reserva" style="display: flex; background: var(--surface-hover); padding: 4px; border-radius: 20px; cursor: pointer; border: 1px solid var(--border); min-width: 120px; justify-content: space-between;">
                <span style="flex: 1; text-align: center; font-size: 0.7rem; font-weight: 900; padding: 6px 0; border-radius: 16px; transition: all 0.3s; 
                  ${!appState.servicosForm.chargeReserva ? 'background: var(--on-primary); color: var(--primary); box-shadow: var(--shadow-sm);' : 'color: var(--text-secondary);'}">NÃO</span>
                <span style="flex: 1; text-align: center; font-size: 0.7rem; font-weight: 900; padding: 6px 0; border-radius: 16px; transition: all 0.3s;
                  ${appState.servicosForm.chargeReserva ? 'background: var(--primary); color: var(--on-primary); box-shadow: var(--shadow-sm);' : 'color: var(--text-secondary);'}">SIM</span>
              </div>
            </div>

            ${appState.servicosForm.chargeReserva ? `
              <div class="animate-fade-in" style="display: flex; flex-direction: column; gap: 0.75rem;">
                <input type="text" id="input-taxa-reserva" placeholder="R$ 0,00" value="${appState.servicosForm.reservaValue}" 
                  style="padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border); width: 100%; font-weight: 800; font-size: 1.2rem; color: var(--primary); background: var(--surface);">
                <p style="font-size: 0.75rem; color: var(--text-secondary); line-height: 1.5; font-weight: 500; text-align: left;">
                  Esse valor será cobrado do cliente via PIX para realizar a reserva. Caso o usuário não compareça no horário marcado essa taxa serve para não deixar o estabelecimento no prejuízo.
                </p>
                <div style="display:flex; flex-direction:column; gap:0.25rem;">
                  <label style="font-size:0.75rem; font-weight:700; color:var(--text-secondary); text-transform:uppercase;">Sua Chave PIX</label>
                  <input type="text" id="input-chave-pix" placeholder="Telefone, CPF, E-mail..." value="${appState.servicosForm.chavePix || appState.profile?.chave_pix || ''}" style="padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border); width: 100%; font-weight: 500;">
                </div>
              </div>
            ` : ''}
          </div>

          <button id="btn-salvar-servico" style="background: var(--primary); color: var(--on-primary); padding: 1.2rem; border-radius: 0.75rem; font-weight: 800; margin-top: 1rem; font-size: 1.1rem; letter-spacing: 1px; box-shadow: var(--shadow-md);">
            SALVAR NO CATÁLOGO
          </button>
        </div>
      </div>

      <h3 style="margin-bottom: 1.25rem; font-size: 1rem; color: var(--text-secondary); letter-spacing: 1px; font-weight: 800; text-transform: uppercase;">SERVIÇOS ATIVOS</h3>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr)); gap: 1.25rem; padding-bottom: 4rem;">
        ${appState.servicosAtivos.length > 0 ? appState.servicosAtivos.map(s => {
          const isEditing = appState.editingServicoId === s.id;
          const ef = appState.editingServicoForm;
          const precoDisplay = 'R$ ' + Number(s.preco).toFixed(2).replace('.', ',');
          // Convert stored minutes back to HH:MM for time input
          const storedMins = ef.duracao_minutos !== undefined ? ef.duracao_minutos : s.duracao_minutos;
          const hh = String(Math.floor(storedMins / 60)).padStart(2, '0');
          const mm = String(storedMins % 60).padStart(2, '0');
          const timeValue = hh + ':' + mm;
          const cobraReserva = ef.chargeReserva !== undefined ? ef.chargeReserva : s.cobra_reserva;
          return `
          <div class="card" style="padding: 1.5rem; align-items: flex-start; text-align: left; position: relative;" data-servico-id="${s.id}">
            ${isEditing ? `
              <div class="flex flex-col w-full" style="gap: 0.75rem;">
                <input id="edit-nome-${s.id}" type="text" value="${ef.nome || s.nome}" style="padding: 0.7rem; border-radius: 0.5rem; border: 1.5px solid var(--primary); width: 100%; font-size: 1rem; font-weight: 700;">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;">
                  <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <label style="font-size:0.65rem; font-weight:700; color:var(--text-secondary); text-transform:uppercase;">Preço</label>
                    <input id="edit-preco-${s.id}" type="text" value="${ef.preco_str || precoDisplay}" style="padding: 0.7rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; font-weight: 700;">
                  </div>
                  <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <label style="font-size:0.65rem; font-weight:700; color:var(--text-secondary); text-transform:uppercase;">Duração</label>
                    <input id="edit-duracao-${s.id}" type="time" value="${timeValue}" style="padding: 0.7rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; font-weight: 700;">
                  </div>
                </div>
                <div style="border-top:1px solid var(--border); padding-top:0.75rem;">
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem;">
                    <span style="font-size:0.85rem; font-weight:600; color:var(--text-secondary);">Cobrar taxa de reserva?</span>
                    <div id="edit-toggle-reserva-${s.id}" style="display:flex; background:var(--surface-hover); padding:3px; border-radius:20px; cursor:pointer; border:1px solid var(--border); min-width:100px; justify-content:space-between;">
                      <span style="flex:1; text-align:center; font-size:0.65rem; font-weight:900; padding:5px 0; border-radius:14px; transition:all 0.3s; ${!cobraReserva ? 'background:var(--on-primary); color:var(--primary); box-shadow:var(--shadow-sm);' : 'color:var(--text-secondary);'}">NÃO</span>
                      <span style="flex:1; text-align:center; font-size:0.65rem; font-weight:900; padding:5px 0; border-radius:14px; transition:all 0.3s; ${cobraReserva ? 'background:var(--primary); color:var(--on-primary); box-shadow:var(--shadow-sm);' : 'color:var(--text-secondary);'}">SIM</span>
                    </div>
                  </div>
                  ${cobraReserva ? `
                    <div style="display:flex; flex-direction:column; gap:0.5rem; margin-top:0.75rem;">
                      <label style="font-size:0.65rem; font-weight:700; color:var(--text-secondary); text-transform:uppercase;">Taxa de Reserva</label>
                      <input id="edit-taxa-${s.id}" type="text" placeholder="R$ 0,00" value="${ef.taxa_str || (s.taxa_reserva ? 'R$ ' + Number(s.taxa_reserva).toFixed(2).replace('.', ',') : '')}" style="padding:0.7rem; border-radius:0.5rem; border:1px solid var(--border); width:100%; font-weight:700; color:var(--primary);">
                      
                      <label style="font-size:0.65rem; font-weight:700; color:var(--text-secondary); text-transform:uppercase; margin-top:0.25rem;">Chave PIX</label>
                      <input id="edit-chave-${s.id}" type="text" placeholder="Sua chave PIX" value="${ef.chave_pix !== undefined ? ef.chave_pix : (appState.profile?.chave_pix || '')}" style="padding:0.7rem; border-radius:0.5rem; border:1px solid var(--border); width:100%; font-weight:700; color:var(--text-main);">
                    </div>
                  ` : ''}
                </div>
                <div style="display:flex; gap:0.5rem; margin-top:0.25rem;">
                  <button class="btn-save-edit-servico" data-id="${s.id}" style="flex:1; background:var(--primary); color:var(--on-primary); padding:0.75rem; border-radius:0.5rem; font-weight:800; font-size:0.85rem;">SALVAR</button>
                  <button class="btn-cancel-edit-servico" data-id="${s.id}" style="flex:1; border:1.5px solid var(--border); color:var(--text-secondary); padding:0.75rem; border-radius:0.5rem; font-weight:800; font-size:0.85rem;">CANCELAR</button>
                </div>
              </div>
            ` : `
              <div style="width: 100%; display: flex; justify-content: space-between; align-items: flex-start;">
                <h4 style="font-family: var(--font-body); font-weight: 800; color: var(--primary); font-size: 1.1rem;">${s.nome}</h4>
                <button class="btn-edit-servico" data-id="${s.id}" title="Editar" style="color: var(--text-secondary); display:flex; align-items:center; padding:2px;">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                </button>
              </div>
              <p style="font-size: 2rem; font-weight: 900; margin: 0.625rem 0; color: var(--text-main);">${precoDisplay}</p>
              <p style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 600;">Duração estimada: ${s.duracao_minutos} min</p>
              <button class="btn-delete-servico" data-id="${s.id}" title="Excluir" style="position:absolute; bottom:1rem; right:1rem; color:#f87171; display:flex; align-items:center; padding:2px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
              </button>
            `}
          </div>
          `
        }).join('') : '<p style="color: var(--text-secondary); grid-column: 1 / -1; font-weight: 600;">Nenhum serviço cadastrado ainda. Adicione o seu primeiro!</p>'}
      </div>
    </div>
  `, false, false)
}

function renderAssinaturas() {
  const isMensal = appState.selectedAssinatura === 'mensal'
  const isAnual = appState.selectedAssinatura === 'anual'
  const isSalao = appState.theme === 'salao'

  // Dynamic colors based on theme
  const annualBorder = isSalao ? '#FF4D94' : '#000000'
  const annualLed = isSalao ? 'rgba(255, 77, 148, 0.7)' : 'rgba(0, 0, 0, 0.5)'
  const annualTagBg = isSalao ? '#FF4D94' : '#000000'
  const annualAccent = isSalao ? '#FF4D94' : '#000000'

  const monthlyBorder = '#d1d5db' // Light Gray
  const monthlyLed = 'rgba(209, 213, 219, 0.6)'

  return renderTabHeader('Assinaturas', `
    <div class="assinaturas-content p-lg animate-fade-in text-center" style="max-width: 60rem; margin: 0 auto; padding: 2.5rem 1.25rem;">
      <div style="margin-bottom: 3rem;">
        <h2 style="font-family: var(--font-heading); font-size: clamp(1.5rem, 4vw, 2.5rem); letter-spacing: -1px;">POTENCIALIZE SEU NEGÓCIO</h2>
        <p style="color: var(--text-secondary); margin-top: 0.625rem; font-weight: 600; font-size: 1.1rem;">Escolha o plano ideal para sua jornada.</p>
      </div>

      <div class="flex gap-lg justify-center items-stretch" style="display: flex; gap: 2rem; flex-wrap: wrap; isolation: isolate;">
        <!-- PLANO MENSAL -->
        <div id="card-mensal" class="card ripple" style="flex: 1; min-width: 20rem; border: 3px solid ${monthlyBorder}; box-shadow: ${isMensal ? `0 0 35px ${monthlyLed}` : 'var(--shadow-md)'}; transform: ${isMensal ? 'scale(1.03)' : 'scale(1)'}; z-index: ${isMensal ? '10' : '1'}; padding: 3rem 2rem; background: #ffffff; border-radius: 1.5rem; position: relative; cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); overflow: visible !important;">
          <h3 style="margin-top: 0.625rem; font-size: 1.25rem; font-weight: 900; color: #4b5563;">PLANO MENSAL</h3>
          <div style="margin: 1.5rem 0;">
            <h1 style="font-size: clamp(3rem, 6vw, 4rem); font-family: var(--font-body); font-weight: 900; color: #212529;">R$ 99<span style="font-size: 1.25rem; opacity: 0.6;">,90</span></h1>
          </div>
          <ul style="text-align: left; margin: 2rem 0; font-size: 1rem; color: #4b5563; line-height: 2.2; font-weight: 500;">
            <li style="display: flex; align-items: center; gap: 8px;"><div style="width: 18px; color: ${monthlyBorder}; font-weight: 900;">✓</div> Agenda Ilimitada</li>
            <li style="display: flex; align-items: center; gap: 8px;"><div style="width: 18px; color: ${monthlyBorder}; font-weight: 900;">✓</div> Financeiro Profissional com Fluxo de Caixa</li>
            <li style="display: flex; align-items: center; gap: 8px;"><div style="width: 18px; color: ${monthlyBorder}; font-weight: 900;">✓</div> Relatórios Mensais e Anuais em PDF</li>
            <li style="display: flex; align-items: center; gap: 8px;"><div style="width: 18px; color: ${monthlyBorder}; font-weight: 900;">✓</div> Suporte via WhatsApp</li>
            <li style="display: flex; align-items: center; gap: 8px;"><div style="width: 18px; color: ${monthlyBorder}; font-weight: 900;">✓</div> Compatibilidade com WhatsApp Business</li>
          </ul>
          <button id="btn-subscribe-mensal" style="background: #212529; color: white; padding: 1.25rem; border-radius: 0.75rem; font-weight: 800; width: 100%; box-shadow: var(--shadow-md); letter-spacing: 1px; border: none; cursor: pointer;">ASSINAR AGORA</button>
        </div>

        <!-- PLANO ANUAL -->
        <div id="card-anual" class="card ripple" style="flex: 1; min-width: 20rem; border: 3px solid ${annualBorder}; box-shadow: 0 0 35px ${annualLed}; transform: scale(1.03); z-index: 10; padding: 3rem 2rem; background: #ffffff; border-radius: 1.5rem; position: relative; cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); overflow: visible !important;">
          <div style="background: ${annualTagBg}; color: white; padding: 0.5rem 1.2rem; border-radius: 1.25rem; font-size: 0.75rem; font-weight: 900; position: absolute; top: -16px; left: 50%; transform: translateX(-50%); letter-spacing: 1px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); border: 2px solid white; white-space: nowrap; line-height: 1; z-index: 20;">MAIS ESCOLHIDO</div>
          <h3 style="margin-top: 0.625rem; font-size: 1.25rem; font-weight: 900; color: ${annualAccent};">PLANO ANUAL</h3>
          <div style="margin: 1.5rem 0;">
            <h1 style="font-size: clamp(3rem, 6vw, 4rem); font-family: var(--font-body); font-weight: 900; color: #212529;">R$ 999<span style="font-size: 1.25rem; opacity: 0.6;">,00</span></h1>
          </div>
          <p style="font-size: 0.8rem; font-weight: 900; background: ${isSalao ? 'rgba(255, 77, 148, 0.1)' : 'rgba(0, 0, 0, 0.05)'}; color: ${annualAccent}; padding: 0.6rem 1.25rem; border-radius: 1.25rem; display: inline-block; margin-bottom: 1.25rem; letter-spacing: 0.5px; border: 1.5px solid ${isSalao ? 'rgba(255, 77, 148, 0.2)' : 'rgba(0, 0, 0, 0.1)'};">ECONOMIZE 2 MESES DE ASSINATURA (R$199,80 DE ECONOMIA)</p>
          <ul style="text-align: left; margin: 1.5rem 0; font-size: 1rem; color: #4b5563; line-height: 2.2; font-weight: 500;">
            <li style="display: flex; align-items: center; gap: 8px;"><div style="width: 18px; color: ${annualBorder}; font-weight: 900;">✓</div> Agenda Ilimitada</li>
            <li style="display: flex; align-items: center; gap: 8px;"><div style="width: 18px; color: ${annualBorder}; font-weight: 900;">✓</div> Financeiro Profissional com Fluxo de Caixa</li>
            <li style="display: flex; align-items: center; gap: 8px;"><div style="width: 18px; color: ${annualBorder}; font-weight: 900;">✓</div> Relatórios Mensais e Anuais em PDF</li>
            <li style="display: flex; align-items: center; gap: 8px;"><div style="width: 18px; color: ${annualBorder}; font-weight: 900;">✓</div> Suporte via WhatsApp</li>
            <li style="display: flex; align-items: center; gap: 8px;"><div style="width: 18px; color: ${annualBorder}; font-weight: 900;">✓</div> Compatibilidade com WhatsApp Business</li>
          </ul>
          <button id="btn-subscribe-anual" style="background: #212529; color: white; padding: 1.25rem; border-radius: 0.75rem; font-weight: 800; width: 100%; box-shadow: var(--shadow-md); letter-spacing: 1px; border: none; cursor: pointer;">ASSINAR AGORA</button>
        </div>
      </div>
    </div>
  `, false, false)
}

// --- EVENT HANDLERS ---

function attachLoginEvents() {
  const btnB = document.getElementById('btn-barbearia')
  const btnS = document.getElementById('btn-salao')
  const btnLogin = document.getElementById('btn-login')
  const linkForgot = document.getElementById('link-forgot')
  const linkRegister = document.getElementById('link-register')
  const linkBack = document.getElementById('link-back-login')
  const btnReset = document.getElementById('btn-reset')
  const btnDoRegister = document.getElementById('btn-do-register')
  const regBtnB = document.getElementById('reg-btn-barbearia')
  const regBtnS = document.getElementById('reg-btn-salao')

  if (regBtnB) regBtnB.addEventListener('click', () => { appState.theme = 'barbearia'; render() })
  if (regBtnS) regBtnS.addEventListener('click', () => { appState.theme = 'salao'; render() })

  if (btnB) btnB.addEventListener('click', () => {
    appState.theme = 'barbearia'
    render()
  })
  if (btnS) btnS.addEventListener('click', () => {
    appState.theme = 'salao'
    render()
  })
  if (btnLogin) btnLogin.addEventListener('click', async () => {
    const email = document.getElementById('login-email').value
    const password = document.getElementById('login-senha').value
    
    if (!email || !password) return alert('Preencha email e senha.')

    btnLogin.textContent = 'ENTRANDO...'

    const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.message.includes('Email not confirmed')) {
        alert('Confirme seu e-mail na caixa de entrada antes de entrar, ou desative a exigência de confirmação no painel do Supabase.')
      } else {
        alert('Erro ao entrar: ' + error.message)
      }
      btnLogin.textContent = 'ENTRAR'
      return
    }

    // Carregar informações do estabelecimento
    const { data: profile } = await supabase
      .from('estabelecimentos')
      .select('*')
      .eq('id', authData.user.id)
      .single()

    if (profile) {
      appState.theme = profile.tipo // 'barbearia' ou 'salao'
      appState.profile = profile
    }

    appState.user = authData.user
    appState.screen = 'dashboard'
    render()
  })

  if (linkForgot) linkForgot.addEventListener('click', () => {
    appState.loginSubScreen = 'forgot'
    render()
  })
  if (linkRegister) linkRegister.addEventListener('click', () => {
    appState.loginSubScreen = 'register'
    render()
  })
  if (linkBack) linkBack.addEventListener('click', () => {
    appState.loginSubScreen = 'default'
    render()
  })
  if (btnReset) btnReset.addEventListener('click', async () => {
    const emailInput = document.getElementById('forgot-email')
    const email = emailInput ? emailInput.value : ''
    if (!email) return alert('Por favor, informe seu e-mail.')
    
    btnReset.textContent = 'ENVIANDO...'
    btnReset.disabled = true

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-password.html',
    })

    if (error) {
       console.error('Erro reset password:', error)
    }
    
    alert('Se houver uma conta ativa para o e-mail digitado, em instantes você receberá um e-mail para redefinição de senha!')
    appState.loginSubScreen = 'default'
    render()
  })

  // Registration event listeners for persistence
  const regNome = document.getElementById('reg-nome')
  const regTelefone = document.getElementById('reg-telefone')
  const regEndereco = document.getElementById('reg-endereco')
  const regEmail = document.getElementById('reg-email')
  const regSenha = document.getElementById('reg-senha')
  const regConf = document.getElementById('reg-senha-confirm')

  const capitalizeInput = (e) => {
    const start = e.target.selectionStart;
    const value = e.target.value;
    const formatted = value.replace(/(?:^|\s)\S/g, m => m.toUpperCase());
    if (value !== formatted) {
      e.target.value = formatted;
      e.target.setSelectionRange(start, start);
    }
  }

  if (regNome) {
    regNome.addEventListener('input', (e) => {
      capitalizeInput(e)
      appState.registrationData.nome = e.target.value
    })
  }
  if (regEndereco) {
    regEndereco.addEventListener('input', (e) => {
      capitalizeInput(e)
      appState.registrationData.endereco = e.target.value
    })
  }

  if (regTelefone) {
    regTelefone.addEventListener('input', (e) => { 
      let v = e.target.value.replace(/\D/g, '')
      if (v.length <= 10) {
        v = v.replace(/(\d{2})(\d)/, '($1) $2')
        v = v.replace(/(\d{4})(\d)/, '$1-$2')
      } else {
        v = v.replace(/(\d{2})(\d)/, '($1) $2')
        v = v.replace(/(\d{5})(\d)/, '$1-$2')
      }
      e.target.value = v.substring(0, 15)
      appState.registrationData.telefone = e.target.value
    }) 
  }
  if (regEmail) regEmail.addEventListener('input', (e) => { appState.registrationData.email = e.target.value })
  if (regSenha) regSenha.addEventListener('input', (e) => { appState.registrationData.senha = e.target.value })
  if (regConf) regConf.addEventListener('input', (e) => { appState.registrationData.conf = e.target.value })

  if (btnDoRegister) btnDoRegister.addEventListener('click', async () => {
    const nome = regNome?.value
    const telefone = regTelefone?.value
    const email = regEmail?.value
    const senha = regSenha?.value
    const conf = regConf?.value
    const endereco = regEndereco?.value

    if (!nome || !telefone || !email || !senha) {
      return alert('Preencha todos os campos obrigatórios.')
    }
    if (senha !== conf) {
      return alert('As senhas não coincidem.')
    }

    btnDoRegister.textContent = 'CRIANDO...'
    btnDoRegister.disabled = true

    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: senha,
      options: {
        data: {
          nome_completo: nome,
          telefone: telefone,
          endereco: endereco,
          tipo: appState.theme // barbearia ou salao
        }
      }
    })

    if (error) {
      alert('Erro: ' + error.message)
      btnDoRegister.textContent = 'CADASTRAR'
      btnDoRegister.disabled = false
      return
    }

    alert('Conta criada com sucesso! Seja bem-vindo ao Pegasus!<br>Você já pode fazer login.')
    appState.registrationData = { nome: '', telefone: '', endereco: '', email: '', senha: '', conf: '' }
    appState.loginSubScreen = 'default'
    render()
  })
}

function attachDashboardEvents() {
  const logout = document.getElementById('btn-logout')
  const agenda = document.getElementById('card-agenda')
  const financas = document.getElementById('card-financas')
  const servicos = document.getElementById('card-servicos')
  const assinaturas = document.getElementById('card-assinaturas')

  if (logout) logout.addEventListener('click', () => { appState.showModal = 'confirm-logout'; render() })
  if (agenda) agenda.addEventListener('click', () => { appState.screen = 'agenda'; render() })
  if (financas) financas.addEventListener('click', () => { appState.screen = 'financas'; render() })
  if (servicos) servicos.addEventListener('click', () => { appState.screen = 'servicos'; render() })
  if (assinaturas) assinaturas.addEventListener('click', () => { appState.screen = 'assinaturas'; render() })

  const btnSupport = document.getElementById('btn-floating-support')
  if (btnSupport) btnSupport.addEventListener('click', () => {
    appState.screen = 'suporte'
    render()
  })

  // --- PULL-TO-REFRESH DASHBOARD ---
  const container = document.getElementById('dash-ptr-container')
  if (container) {
    container.addEventListener('touchstart', (e) => {
      if (container.scrollTop <= 0) {
        _ptr.active = true
        _ptr.startY = e.touches[0].pageY
      }
    }, { passive: true })

    container.addEventListener('touchmove', (e) => {
      if (!_ptr.active) return
      const y = e.touches[0].pageY
      const dist = y - _ptr.startY
      if (dist > 0) {
        const el = document.getElementById('dash-ptr-indicator')
        if (el) {
          el.style.display = 'flex'
          const h = Math.min(dist * 0.5, _ptr.threshold)
          el.style.height = h + 'px'
          el.style.opacity = Math.min(h / _ptr.threshold, 1)
          const span = el.querySelector('span')
          const spinner = document.getElementById('dash-ptr-spinner')
          if (h >= _ptr.threshold - 10) {
            span.textContent = '↑ Solte para atualizar tudo'
            if(spinner) spinner.style.animation = 'spin 0.8s linear infinite'
          } else {
            span.textContent = '↓ Puxe para atualizar tudo'
            if(spinner) spinner.style.animation = 'none'
          }
        }
      }
    }, { passive: true })

    container.addEventListener('touchend', async () => {
      if (!_ptr.active) return
      _ptr.active = false
      const el = document.getElementById('dash-ptr-indicator')
      if (el && el.offsetHeight >= _ptr.threshold - 15) {
        el.querySelector('span').textContent = 'Sincronizando tudo...'
        
        // Full System Sync
        appState.servicosLoaded = false // Force reload servicos
        appState.financasData.loaded = false // Force reload financas
        await syncAgendaData() // Sync agenda
        
        render()
      } else if (el) {
        el.style.height = '0'
        el.style.opacity = '0'
        setTimeout(() => { el.style.display = 'none' }, 200)
      }
    })
  }
}

function renderConfigAgendamento() {
  const profile = appState.profile || {}
  const link = `https://pegasusapp.com.br/agendamento.html?estab=${profile.id}`
  const whatsAppText = `Olá! 👋 Para agendar seu horário de forma rápida e ver nossos serviços, clique no link abaixo:\n\n${link}`

  return renderTabHeader('Agendamento Online', `
    <div class="animate-fade-in" style="max-width: 40rem; margin: 0 auto; padding: 1.5rem;">
      
      <div class="card" style="align-items: flex-start; text-align: left; gap: 1.5rem; padding: 2rem;">
        <div>
          <h2 style="font-family: var(--font-alt); font-size: 1.4rem; margin-bottom: 0.5rem;">Seu Link Exclusivo</h2>
          <p style="color: var(--text-secondary); font-size: 0.95rem;">Copie o link abaixo e coloque na mensagem de saudação automática do seu <b>WhatsApp Business</b>.</p>
        </div>

        <div style="width: 100%; background: var(--surface2); padding: 1rem; border-radius: 12px; border: 1px dashed var(--border); word-break: break-all; font-family: monospace; font-size: 0.9rem; color: var(--primary);">
          ${link}
        </div>

        <button id="btn-copy-link" class="btn" style="background: var(--primary); color: var(--on-primary); padding: 1rem; border-radius: 0.8rem; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
          <span>📋</span> COPIAR LINK
        </button>
      </div>

      <div class="card" style="margin-top: 1.5rem; align-items: flex-start; text-align: left; gap: 1rem; padding: 2rem; border-left: 4px solid #25D366;">
        <h3 style="font-family: var(--font-alt); font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem;">
          <span style="color: #25D366; font-size: 1.5rem;">💬</span> Sugestão para WhatsApp
        </h3>
        <p style="color: var(--text-secondary); font-size: 0.9rem;">Copie este texto para usar como sua "Mensagem de Saudação":</p>
        
        <div style="width: 100%; background: #f0fdf4; padding: 1rem; border-radius: 12px; border: 1px solid #dcfce7; font-size: 0.95rem; color: #166534; line-height: 1.4; white-space: pre-wrap;">${whatsAppText}</div>
        
        <button id="btn-copy-msg" style="color: var(--primary); font-weight: 700; font-size: 0.85rem; background: none; border: none; cursor: pointer; text-decoration: underline;">Copiar texto da mensagem</button>
      </div>

      <div style="margin-top: 2rem; padding: 1rem; background: rgba(0,0,0,0.03); border-radius: 12px; font-size: 0.85rem; color: var(--text-secondary);">
        <p><b>Como configurar no WhatsApp Business?</b></p>
        <ol style="margin-top: 0.5rem; padding-left: 1.25rem; display: flex; flex-direction: column; gap: 0.4rem;">
          <li>Abra o WhatsApp Business</li>
          <li>Vá em <b>Ferramentas Comerciais</b></li>
          <li>Clique em <b>Mensagem de Saudação</b></li>
          <li>Ative e cole o texto acima!</li>
        </ol>
      </div>
    </div>
  `)
}

function attachConfigAgendamentoEvents() {
  const profile = appState.profile || {}
  const link = `https://pegasusapp.com.br/agendamento.html?estab=${profile.id}`
  const whatsAppText = `Olá! 👋 Para agendar seu horário de forma rápida e ver nossos serviços, clique no link abaixo:\n\n${link}`
  
  const btnBack = document.getElementById('btn-back-dashboard')
  if (btnBack) btnBack.onclick = () => { appState.screen = 'dashboard'; render(); }

  const btnCopyLink = document.getElementById('btn-copy-link')
  if (btnCopyLink) btnCopyLink.onclick = () => {
    navigator.clipboard.writeText(link).then(() => {
      const original = btnCopyLink.innerHTML
      btnCopyLink.innerHTML = '✅ LINK COPIADO!'
      btnCopyLink.style.background = '#10b981'
      setTimeout(() => {
        btnCopyLink.innerHTML = original
        btnCopyLink.style.background = 'var(--primary)'
      }, 2000)
    })
  }

  const btnCopyMsg = document.getElementById('btn-copy-msg')
  if (btnCopyMsg) btnCopyMsg.onclick = () => {
    navigator.clipboard.writeText(whatsAppText).then(() => {
      alert('Texto da mensagem copiado!')
    })
  }
}

function renderSupport() {
  return `
    <div class="support-container min-h-screen animate-fade-in" style="background: #f8fafc;">
      <header class="flex items-center" style="padding: 1.25rem var(--spacing-lg); border-bottom: 1px solid var(--border); background: var(--background); position: sticky; top: 0; z-index: 100; justify-content: center;">
        <button id="btn-back-support" style="position: absolute; left: var(--spacing-lg); color: var(--text-secondary); transform: scale(1.2);">${icons.back}</button>
        <h1 style="font-family: var(--font-heading); font-size: 1.25rem; letter-spacing: 2px; text-transform: uppercase;">SUPORTE</h1>
      </header>

      <main style="padding: 2rem 1.25rem; max-width: 500px; margin: 0 auto; display: flex; flex-direction: column; gap: 2rem;">
        
        <!-- Bloco Principal -->
        <div class="card" style="background: #ffffff; border-radius: 20px; padding: 2.5rem 1.5rem; text-align: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="background: rgba(34, 197, 94, 0.1); width: 80px; height: 80px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem;">
            <div style="color: #22c55e; transform: scale(2);">${icons.suporte}</div>
          </div>
          
          <h2 style="font-size: 1.5rem; margin-bottom: 0.5rem; color: #1e293b;">Fale Conosco no WhatsApp</h2>
          <p style="color: #64748b; font-size: 0.95rem; margin-bottom: 2rem; line-height: 1.5;">
            Nosso time de suporte está pronto para te ajudar. Descreva seu problema abaixo e clique em enviar.
          </p>

          <textarea id="support-message" placeholder="Como podemos ajudar?" 
            style="width: 100%; height: 160px; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1rem; font-size: 1rem; margin-bottom: 1.5rem; resize: none; color: #1e293b; outline: none;"></textarea>

          <button id="btn-send-whatsapp" style="
            width: 100%; 
            background: #22c55e; 
            color: white; 
            border: none; 
            padding: 1rem; 
            border-radius: 12px; 
            font-weight: 800; 
            font-size: 1.1rem; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            gap: 0.8rem;
            box-shadow: 0 4px 15px rgba(34, 197, 94, 0.3);
            text-transform: uppercase;
            cursor: pointer;
          ">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 1 1-7.6-11.7 8.38 8.38 0 0 1 3.8.9L22 2l-1.5 5.5Z"/></svg>
            ENVIAR WHATSAPP
          </button>

          <div style="margin-top: 1.5rem; color: #64748b; font-size: 0.9rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem; background: #f1f5f9; padding: 0.8rem; border-radius: 8px;">
            <span style="font-weight: 700;">+55 (22) 99878-6284</span>
          </div>
        </div>

        <!-- Bloco Sobre Mim -->
        <div class="card" style="background: #ffffff; border-radius: 20px; padding: 2rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="display: flex; align-items: flex-start; gap: 1rem; margin-bottom: 1rem;">
             <div style="width: 48px; height: 48px; min-width: 48px; background: #000; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
             </div>
             <div>
                <h3 style="font-family: var(--font-heading); font-size: 1rem; margin-bottom: 2px;">SOBRE MIM</h3>
                <p style="color: #64748b; font-size: 0.9rem; font-weight: 600;">Danillo Neto</p>
             </div>
          </div>
          <p style="color: #475569; font-size: 0.9rem; line-height: 1.6; font-style: italic;">
            Sou formado em Sistemas de Informação (TI) e trabalho desenvolvendo sistemas personalizados que solucionam problemas reais de empresas dos mais variados ramos. Minha missão é transformar processos complexos em ferramentas simples e eficientes.
            <br><br>
            <strong>Fico à disposição através do meu WhatsApp caso precise de sistemas para outros tipos de negócios. Basta me chamar, e faremos seu negócio decolar! 😉</strong>
          </p>
        </div>

      </main>
    </div>
  `
}

function attachSupportEvents() {
  const btnBack = document.getElementById('btn-back-support')
  const btnSend = document.getElementById('btn-send-whatsapp')

  if (btnBack) btnBack.addEventListener('click', () => {
    appState.screen = 'dashboard'
    render()
  })

  if (btnSend) btnSend.addEventListener('click', () => {
    const msg = document.getElementById('support-message').value
    if (!msg) return alert('Por favor, descreva sua dúvida ou problema.')

    const profile = appState.profile || {}
    const clientName = profile.nome_completo || 'Não informado'
    const typeLabel = (profile.tipo === 'salao' ? 'Salão de Beleza' : 'Barbearia')
    const address = profile.endereco || 'Não informado'

    const fullMessage = `*SUPORTE PEGASUS APP* 🚀\n\n*Cliente:* ${clientName}\n*Tipo:* ${typeLabel}\n*Endereço:* ${address}\n*Mensagem:* ${msg}`
    
    const whatsappUrl = `https://wa.me/5522998786284?text=${encodeURIComponent(fullMessage)}`
    window.open(whatsappUrl, '_blank')
  })
}


function attachGenericBack() {
  const back = document.getElementById('btn-back-dashboard')
  if (back) back.addEventListener('click', () => {
    // Reset loaded flags so next visit fetches fresh
    if (appState.screen === 'financas') appState.financasData.loaded = false
    if (appState.screen === 'servicos') appState.servicosLoaded = false
    appState.screen = 'dashboard'
    render()
  })
}



function attachCalendarModalEvents() {
  const overlay = document.querySelector('.overlay')
  const btnClose = document.getElementById('btn-close-calendar')
  const btnPrev = document.getElementById('cal-prev')
  const btnNext = document.getElementById('cal-next')
  const days = document.querySelectorAll('.calendar-day:not(.empty)')

  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) { appState.showModal = null; render() } })
  if (btnClose) btnClose.addEventListener('click', () => { appState.showModal = null; render() })

  if (btnPrev) btnPrev.addEventListener('click', () => {
    appState.viewingDate.setMonth(appState.viewingDate.getMonth() - 1)
    render()
  })

  if (btnNext) btnNext.addEventListener('click', () => {
    appState.viewingDate.setMonth(appState.viewingDate.getMonth() + 1)
    render()
  })

  days.forEach(day => {
    day.addEventListener('click', () => {
      const selectedDay = parseInt(day.dataset.day)
      const newDate = new Date(appState.viewingDate.getFullYear(), appState.viewingDate.getMonth(), selectedDay)
      const isoDate = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`

      if (appState.calendarContext === 'new-transaction') {
        appState.financasData.tempDate = isoDate
        appState.showModal = 'new-transaction'
      } else if (appState.calendarContext === 'edit-transaction') {
        appState.financasData.activeTransaction.fullDate = isoDate
        appState.showModal = 'edit-transaction'
      } else {
        appState.selectedDate = newDate
        appState.showModal = null
        if (appState.screen === 'financas') {
          appState.financasData.filterByDay = true
          appState.financasData.month = newDate.getMonth()
          appState.financasData.year = newDate.getFullYear()
        }
      }
      appState.calendarContext = null
      render()
    })
  })
}

function attachNewAgendamentoEvents() {
  const btnClose = document.getElementById('btn-close-modal')
  const btnSave = document.getElementById('btn-save-agendamento')
  const overlay = document.querySelector('.overlay')

  if (btnClose) btnClose.addEventListener('click', () => {
    appState.showModal = null
    render()
  })

  if (overlay) overlay.addEventListener('click', (e) => {
    // Only close if click is directly on the overlay AND the service list is not open
    const serviceList = document.getElementById('modal-service-list')
    const isListOpen = serviceList && serviceList.style.display !== 'none'
    if (e.target === overlay && !isListOpen) {
      appState.showModal = null
      render()
    }
  })

  const nameInput = document.getElementById('modal-client-name')
  const dateInputEl = document.getElementById('modal-date')
  const timeInputEl = document.getElementById('modal-time')
  const phoneInput = document.getElementById('modal-client-phone')

  const checkFormValidity = () => {
    const name = nameInput ? nameInput.value.trim() : ''
    const date = dateInputEl ? dateInputEl.value : ''
    const time = timeInputEl ? timeInputEl.value : ''
    const serviceHidden = document.getElementById('modal-service-search-selected')
    let selectedCount = 0
    try { selectedCount = JSON.parse(serviceHidden ? serviceHidden.value : '[]').length } catch(e) {}

    const isValid = name !== '' && date !== '' && time !== '' && selectedCount > 0
    
    if (btnSave) {
      btnSave.disabled = !isValid
      btnSave.style.opacity = isValid ? '1' : '0.5'
      btnSave.style.cursor = isValid ? 'pointer' : 'not-allowed'
    }
  }

  // Initial check
  checkFormValidity()

  if (nameInput) nameInput.addEventListener('input', checkFormValidity)
  if (dateInputEl) dateInputEl.addEventListener('input', checkFormValidity)
  if (timeInputEl) timeInputEl.addEventListener('input', checkFormValidity)

  attachServiceSearchSelect('modal-service-search', 'modal-service-list', () => {
    checkFormValidity()
  })

  if (phoneInput) {
    phoneInput.addEventListener('input', (e) => {
      e.target.value = formatPhone(e.target.value)
    })
  }

    if (btnSave) btnSave.addEventListener('click', async () => {
    btnSave.disabled = true
    const name = document.getElementById('modal-client-name').value
    const phone = document.getElementById('modal-client-phone').value || ''
    const dateInput = document.getElementById('modal-date').value
    const time = document.getElementById('modal-time').value
    const serviceHidden = document.getElementById('modal-service-search-selected')
    let selectedNames = []
    try { selectedNames = JSON.parse(serviceHidden ? serviceHidden.value : '[]') } catch(e) {}

    if (!name || !dateInput || !time || selectedNames.length === 0) {
      alert('Por favor, preencha todos os campos e selecione os serviços.')
      btnSave.disabled = false
      return
    }

    const serviceNome = selectedNames.join(', ')

    let valorTotal = 0
    let taxaTotalReserva = 0
    let cobraReserva = false
    let firstServiceId = null

    selectedNames.forEach(sn => {
      const servico = appState.servicosAtivos.find(s => s.nome === sn)
      if (servico) {
         valorTotal += Number(servico.preco || 0)
         if (!firstServiceId) firstServiceId = servico.id
         if (servico.cobra_reserva) {
           cobraReserva = true
           taxaTotalReserva += Number(servico.taxa_reserva || 0)
         }
      }
    })

    const date = new Date(dateInput + 'T12:00:00')
    const dayKey = getAgendaDayKey(date)

    if (!appState.agendaData[dayKey]) {
      appState.agendaData[dayKey] = []
    }

    const newEntry = { 
      time, 
      client: name, 
      service: serviceNome, 
      status: cobraReserva ? 'pendente' : 'confirmado',
      cobraReserva,
      taxaReserva: taxaTotalReserva,
      valorTotal: valorTotal
    }

    appState.agendaData[dayKey].push(newEntry)
    appState.agendaData[dayKey].sort((a,b) => a.time.localeCompare(b.time))

    // Optimistic Save complete
    appState.selectedDate = date
    appState.showModal = null
    btnSave.disabled = false
    
    if (cobraReserva) {
      alert('Reserva criada! Aguardando o cliente enviar o comprovante do PIX para confirmar.')
    }
    render()

    // Background DB Sync
    supabase.from('agendamentos').insert([{
      estabelecimento_id: appState.user?.id,
      cliente_nome: name,
      cliente_telefone: phone,
      servico_nome: serviceNome,
      servico_id: firstServiceId,
      data_agendamento: dateInput,
      hora_agendamento: time,
      agendamento_status: cobraReserva ? 'Pendente' : 'Confirmado',
      pagamento_status: !cobraReserva,
      taxa_reserva: cobraReserva ? taxaTotalReserva : 0,
      valor_total: valorTotal
    }]).select().single().then(({ data: dbData, error }) => {
      if (error) {
        console.error('Erro ao salvar agendamento no bd', error)
        alert('Erro ao sincronizar com o banco de dados. Verifique sua conexão.')
      } else if (dbData) {
        newEntry.id = dbData.id
      }
    })
  })
}

function attachAgendaActionsEvents() {
  const overlay = document.querySelector('.overlay')
  const btnCloseX = document.getElementById('btn-close-actions-x')
  const btnClose = document.getElementById('btn-close-actions')
  const btnConclude = document.getElementById('btn-conclude-service')
  const btnCancel = document.getElementById('btn-cancel-service')
  const btnConfirmPayment = document.getElementById('btn-confirm-payment')

  const close = () => { appState.showModal = null; render() }

  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  if (btnCloseX) btnCloseX.addEventListener('click', close)
  if (btnClose) btnClose.addEventListener('click', close)

  if (btnConfirmPayment) btnConfirmPayment.addEventListener('click', async () => {
    const dayKey = getAgendaDayKey(appState.selectedDate)
    const idx = appState.agendaData[dayKey].findIndex(i => i.id === appState.activeAgendaItem.id || (i.client === appState.activeAgendaItem.client && i.time === appState.activeAgendaItem.time))
    
    // Optimistic Update
    appState.showModal = null
    alert('Pagamento confirmado e agendamento efetivado!')
    
    if (idx > -1) {
      appState.agendaData[dayKey][idx] = { ...appState.activeAgendaItem, status: 'confirmado' }
    }
    render()

    // Background Sync
    if (appState.activeAgendaItem?.id) {
      supabase.from('agendamentos').update({ 
        pagamento_status: true,
        agendamento_status: 'Confirmado'
      }).eq('id', appState.activeAgendaItem.id).then(({ error }) => {
        if (error) {
          console.error('Erro ao confirmar pagamento:', error)
          alert('Erro ao sincronizar pagamento. Verifique sua conexão.')
        } else {
          // No need to wipe local data, keep it smooth
        }
      })
    }
  })

  if (btnConclude) btnConclude.addEventListener('click', async () => {
    // Prevent double-click: disable and close immediately
    if (btnConclude.disabled) return
    btnConclude.disabled = true
    btnConclude.textContent = '...'
    
    const dayKey = getAgendaDayKey(appState.selectedDate)
    const itemSnapshot = { ...appState.activeAgendaItem }
    
    // Optimistic: remove from local list immediately
    const idx = appState.agendaData[dayKey].findIndex(i => i.id === itemSnapshot.id)
    if (idx > -1) appState.agendaData[dayKey].splice(idx, 1)

    // Close modal immediately
    close()
    
    if (itemSnapshot?.id) {
       const { error: agError } = await supabase.from('agendamentos').update({ agendamento_status: 'Concluído' }).eq('id', itemSnapshot.id)
       
       if (agError) {
         console.error('Erro ao concluir:', agError)
         alert('Erro ao concluir serviço: ' + agError.message)
         return
       }
       
       const valor = Number(itemSnapshot.valor_total || itemSnapshot.valorTotal || 0)
       const finPayload = {
         estabelecimento_id: appState.user.id,
         descricao: `${itemSnapshot.client}`,
         valor: valor,
         tipo: 'entrada',
         categoria: itemSnapshot.service || 'Serviço',
         data_transacao: dayKey
       }
       
       const { data: finData, error: finError } = await supabase.from('transacoes_financeiras').insert([finPayload]).select()
       
       if (finError) {
         console.error('Erro ao lançar no financeiro:', finError.message)
         alert('Serviço concluído, mas erro no caixa: ' + finError.message)
       } else if (finData?.[0]?.id) {
         // Link agendamento_id (silently — column may not exist yet)
         await supabase.from('transacoes_financeiras')
           .update({ agendamento_id: itemSnapshot.id })
           .eq('id', finData[0].id)
           .then(({ error }) => { if (error) console.warn('agendamento_id não vinculado:', error.message) })
       }
       
       // Silent background reload will happen naturally or we just stay optimistic
       render()
    }
  })

  if (btnCancel) btnCancel.addEventListener('click', async () => {
    appState.showModal = 'confirm-cancel'
    render()
  })
}

function attachWhatsAppEvents() {
  const overlay = document.querySelector('.overlay')
  const btnCloseX = document.getElementById('btn-close-wa-x')
  const btnCopy = document.getElementById('btn-copy-wa-message')
  const messageText = document.getElementById('wa-message-text')

  const close = () => { appState.showModal = null; render() }

  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  if (btnCloseX) btnCloseX.addEventListener('click', close)

  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      const text = messageText.textContent
      navigator.clipboard.writeText(text).then(() => {
        const originalText = btnCopy.textContent
        btnCopy.textContent = 'COPIADO! ✅'
        btnCopy.style.background = '#128C7E'
        setTimeout(() => {
          btnCopy.textContent = originalText
          btnCopy.style.background = '#25D366'
        }, 2000)
      }).catch(err => {
        console.error('Erro ao copiar:', err)
        alert('Erro ao copiar mensagem. Tente selecionar o texto manualmente.')
      })
    })
  }
}

function attachConfirmCancelEvents() {
  const btnCloseX = document.getElementById('btn-close-cancel-x')
  const btnClose = document.getElementById('btn-close-cancel')
  const btnConfirm = document.getElementById('btn-confirm-cancel-final')
  
  const back = () => { appState.showModal = 'agenda-actions'; render() }
  const close = () => { appState.showModal = null; render() }

  if (btnCloseX) btnCloseX.addEventListener('click', back)
  if (btnClose) btnClose.addEventListener('click', back)
  
  if (btnConfirm) btnConfirm.addEventListener('click', async () => {
    const dayKey = getAgendaDayKey(appState.selectedDate)
    const idx = appState.agendaData[dayKey].indexOf(appState.activeAgendaItem)
    if (idx > -1) appState.agendaData[dayKey].splice(idx, 1)
    
    if (appState.activeAgendaItem?.id) {
       const { error } = await supabase.from('agendamentos').delete().eq('id', appState.activeAgendaItem.id)
       if (error) {
         console.error('Error deleting:', error)
         alert('Erro ao cancelar: ' + error.message)
       } else {
         alert('Agendamento cancelado com sucesso!')
       }
    }
    close()
  })
}

// ─── Events: Horário de funcionamento popup ───────────────────────────────────
function attachHorarioFuncionamentoEvents() {
  const profile = appState.profile || {}
  let selectedDays = [...(Array.isArray(profile.dias_funcionamento) ? profile.dias_funcionamento : [])]

  const overlay = document.querySelector('.overlay')
  if (overlay) overlay.addEventListener('click', (e) => {
    // Only allow closing overlay if already configured
    if (e.target === overlay && selectedDays.length > 0) { appState.showModal = null; render() }
  })

  const btnClose = document.getElementById('btn-close-horario-x')
  if (btnClose) btnClose.addEventListener('click', () => { appState.showModal = null; render() })

  // Day toggle
  document.querySelectorAll('.dia-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dia = parseInt(btn.dataset.dia)
      if (selectedDays.includes(dia)) {
        selectedDays = selectedDays.filter(d => d !== dia)
        btn.classList.remove('dia-sel')
        btn.style.background = 'transparent'
        btn.style.color = 'var(--text-main)'
        btn.style.borderColor = 'var(--border)'
      } else {
        selectedDays.push(dia)
        btn.classList.add('dia-sel')
        btn.style.background = 'var(--primary)'
        btn.style.color = 'var(--on-primary)'
        btn.style.borderColor = 'var(--primary)'
      }
    })
  })

  // Add interval row
  const btnAddPausa = document.getElementById('btn-add-pausa-padrao')
  if (btnAddPausa) {
    btnAddPausa.addEventListener('click', () => {
      const list = document.getElementById('pausas-padrao-list')
      const emptyMsg = list.querySelector('#pausas-empty')
      if (emptyMsg) emptyMsg.remove()
      const inp = `flex:1;padding:0.8rem;border-radius:0.75rem;border:1.5px solid var(--border);background:var(--surface);color:var(--text-main);font-family:inherit;font-size:1rem;`
      const row = document.createElement('div')
      row.className = 'pausa-row'
      row.style.cssText = 'display:flex;gap:0.6rem;align-items:center;margin-bottom:0.5rem;'
      row.innerHTML = `
        <input type="time" class="pausa-inicio" style="${inp}">
        <span style="color:var(--text-secondary);font-weight:700;font-size:0.85rem;">até</span>
        <input type="time" class="pausa-fim" style="${inp}">
        <button class="btn-remove-pausa" style="background:none;border:none;color:var(--red);font-size:1.2rem;cursor:pointer;padding:0.25rem;flex-shrink:0;">✕</button>`
      row.querySelector('.btn-remove-pausa').addEventListener('click', () => row.remove())
      list.appendChild(row)
    })
  }

  // Remove existing interval rows
  document.querySelectorAll('.btn-remove-pausa').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.pausa-row').remove())
  })

  // Save
  const btnSave = document.getElementById('btn-save-horario')
  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      const abertura = document.getElementById('horario-abertura')?.value
      const fechamento = document.getElementById('horario-fechamento')?.value
      if (selectedDays.length === 0) { alert('Selecione pelo menos um dia de funcionamento.'); return }
      if (!abertura || !fechamento) { alert('Informe os horários de abertura e fechamento.'); return }

      const pausas = []
      document.querySelectorAll('.pausa-row').forEach(row => {
        const inicio = row.querySelector('.pausa-inicio')?.value
        const fim = row.querySelector('.pausa-fim')?.value
        if (inicio && fim) pausas.push({ inicio, fim })
      })

      btnSave.disabled = true; btnSave.textContent = 'SALVANDO...'
      const { error } = await supabase.from('estabelecimentos').update({
        dias_funcionamento: selectedDays,
        horario_abertura: abertura,
        horario_fechamento: fechamento,
        pausas_padrao: pausas
      }).eq('id', appState.user.id)
      btnSave.disabled = false; btnSave.textContent = 'SALVAR CONFIGURAÇÃO'

      if (error) { alert('Erro ao salvar: ' + error.message); return }

      appState.profile = { ...(appState.profile || {}), dias_funcionamento: selectedDays, horario_abertura: abertura, horario_fechamento: fechamento, pausas_padrao: pausas }
      appState.showModal = null
      render()
    })
  }
}

// ─── Events: Fazer Pausa popup ────────────────────────────────────────────────
function attachFazPausaEvents() {
  const overlay = document.querySelector('.overlay')
  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) { appState.showModal = null; render() } })

  const btnClose = document.getElementById('btn-close-pausa-x')
  if (btnClose) btnClose.addEventListener('click', () => { appState.showModal = null; render() })

  const btnConfirmar = document.getElementById('btn-confirmar-pausa')
  if (btnConfirmar) btnConfirmar.addEventListener('click', async () => {
    const inicio = document.getElementById('pausa-inicio')?.value
    const fim = document.getElementById('pausa-fim')?.value
    const encerrarDia = document.getElementById('encerrar-dia')?.checked

    if (!encerrarDia && (!inicio || !fim)) { alert('Informe os horários de início e fim da pausa.'); return }
    if (!encerrarDia && inicio >= fim) { alert('O horário de início deve ser antes do fim.'); return }

    btnConfirmar.disabled = true; btnConfirmar.textContent = 'SALVANDO...'
    const todayKey = getAgendaDayKey(new Date())
    const tipo = encerrarDia ? 'fechado_resto_do_dia' : 'pausa'

    const { error } = await supabase.from('excecoes_agenda').insert({
      estabelecimento_id: appState.user.id,
      data_excecao: todayKey,
      tipo,
      inicio: inicio || null,
      fim: encerrarDia ? null : fim
    })
    btnConfirmar.disabled = false; btnConfirmar.textContent = 'CONFIRMAR PAUSA'

    if (error) { alert('Erro ao salvar pausa: ' + error.message); return }

    // Reload today's exceptions
    const { data } = await supabase.from('excecoes_agenda').select('*')
      .eq('estabelecimento_id', appState.user.id).eq('data_excecao', todayKey)
    if (data) appState.excecoesDia = data

    appState.showModal = null
    render()
    alert('Pausa configurada com sucesso!')
  })
}

// ─── Popup: Gerenciar pausa existente ─────────────────────────────────────────
function renderGerenciarPausaModal() {
  const pausaAtiva   = appState.excecoesDia.find(e => e.tipo === 'pausa')
  const encerradoHoje = appState.excecoesDia.find(e => e.tipo === 'fechado_resto_do_dia')
  const excecao = pausaAtiva || encerradoHoje
  if (!excecao) return '<div></div>'

  const isPausa = excecao.tipo === 'pausa'
  const labelTitulo = isPausa
    ? `PAUSA: ${excecao.inicio?.slice(0,5)} – ${excecao.fim?.slice(0,5)}`
    : 'DIA ENCERRADO ANTECIPADAMENTE'
  const inp = `width:100%;padding:0.8rem;border-radius:0.75rem;border:1.5px solid var(--border);background:var(--surface);color:var(--text-main);font-family:inherit;font-size:1rem;`

  return `
    <div class="card animate-fade-in custom-scroll" style="max-width:380px;width:92%;padding:2rem;border-radius:1.5rem;max-height:90vh;overflow-y:auto;">
      <button id="btn-close-gerenciar-pausa-x" style="position:absolute;top:1rem;right:1rem;background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-secondary);line-height:1;padding:0.5rem;z-index:99;">✕</button>
      <h2 style="font-family:var(--font-alt);font-size:1.2rem;font-weight:900;line-height:1.2;margin-bottom:1.25rem;">GERENCIAR PAUSA</h2>
      <p style="font-size:0.85rem;font-weight:700;color:var(--text-secondary);margin-bottom:1.25rem;">${labelTitulo}</p>

      <span style="font-size:0.7rem;font-weight:800;letter-spacing:1.5px;color:var(--text-secondary);display:block;margin-bottom:0.6rem;">EDITAR HORÁRIO</span>
      <div style="display:flex;gap:0.75rem;margin-bottom:1.25rem;align-items:flex-end;">
        <div style="flex:1;">
          <label style="font-size:0.72rem;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:0.3rem;">Início</label>
          <input type="time" id="edit-pausa-inicio" value="${excecao.inicio?.slice(0,5)||''}" style="${inp}">
        </div>
        <span style="color:var(--text-secondary);font-weight:700;padding-bottom:0.85rem;">–</span>
        <div style="flex:1;">
          <label style="font-size:0.72rem;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:0.3rem;">Fim</label>
          <input type="time" id="edit-pausa-fim" value="${excecao.fim?.slice(0,5)||''}" ${excecao.tipo === 'fechado_resto_do_dia' ? 'disabled' : ''} style="${inp}${excecao.tipo === 'fechado_resto_do_dia' ? 'opacity:0.5;' : ''}">
        </div>
      </div>

      <label style="display:flex;align-items:flex-start;gap:0.75rem;padding:1rem;border-radius:0.85rem;border:1.5px solid var(--border);cursor:pointer;margin-bottom:1.25rem;">
        <input type="checkbox" id="edit-encerrar-dia" ${excecao.tipo === 'fechado_resto_do_dia' ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--primary);margin-top:2px;flex-shrink:0;">
        <span style="font-size:0.875rem;font-weight:600;color:var(--text-main);">Encerrar o dia a partir deste horário<br><span style="color:var(--text-secondary);font-size:0.78rem;">Nenhum agendamento será aceito pelo restante do dia</span></span>
      </label>

      <button id="btn-salvar-edicao-pausa" data-excecao-id="${excecao.id}" style="width:100%;padding:1rem;border-radius:1rem;background:var(--primary);color:var(--on-primary);font-weight:900;font-size:0.88rem;letter-spacing:1.5px;border:none;cursor:pointer;margin-bottom:0.375rem;">SALVAR ALTERAÇÃO</button>
      <button id="btn-excluir-pausa" data-excecao-id="${excecao.id}" style="width:100%;padding:1rem;border-radius:1rem;background:transparent;color:var(--red);font-weight:800;font-size:0.88rem;letter-spacing:1px;border:1.5px solid var(--red);cursor:pointer;">EXCLUIR PAUSA</button>
    </div>`
}

function attachGerenciarPausaEvents() {
  const overlay = document.querySelector('.overlay')
  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) { appState.showModal = null; render() } })

  const btnClose = document.getElementById('btn-close-gerenciar-pausa-x')
  if (btnClose) btnClose.addEventListener('click', () => { appState.showModal = null; render() })

  const excecao = appState.excecoesDia.find(e => e.tipo === 'pausa') ||
                  appState.excecoesDia.find(e => e.tipo === 'fechado_resto_do_dia')
  if (!excecao) return

  // Toggle fim input when "encerrar dia" checkbox changes
  const chkEncerrar = document.getElementById('edit-encerrar-dia')
  const inputFim    = document.getElementById('edit-pausa-fim')
  if (chkEncerrar && inputFim) {
    chkEncerrar.addEventListener('change', () => {
      inputFim.disabled = chkEncerrar.checked
      inputFim.style.opacity = chkEncerrar.checked ? '0.5' : '1'
    })
  }

  const reloadExcecoes = async () => {
    const todayKey = getAgendaDayKey(new Date())
    const { data } = await supabase.from('excecoes_agenda').select('*')
      .eq('estabelecimento_id', appState.user.id).eq('data_excecao', todayKey)
    if (data) appState.excecoesDia = data
  }

  const btnSalvar = document.getElementById('btn-salvar-edicao-pausa')
  if (btnSalvar) {
    btnSalvar.addEventListener('click', async () => {
      const inicio      = document.getElementById('edit-pausa-inicio')?.value
      const fim         = document.getElementById('edit-pausa-fim')?.value
      const encerrarDia = document.getElementById('edit-encerrar-dia')?.checked

      if (!inicio) { alert('Informe o horário de início.'); return }
      if (!encerrarDia && !fim) { alert('Informe o horário de fim ou marque "Encerrar o dia".'); return }
      if (!encerrarDia && inicio >= fim) { alert('O início deve ser antes do fim.'); return }

      const tipo = encerrarDia ? 'fechado_resto_do_dia' : 'pausa'
      btnSalvar.disabled = true; btnSalvar.textContent = 'SALVANDO...'
      const { error } = await supabase.from('excecoes_agenda')
        .update({ inicio, fim: encerrarDia ? null : fim, tipo })
        .eq('id', excecao.id)
      btnSalvar.disabled = false; btnSalvar.textContent = 'SALVAR ALTERAÇÃO'
      if (error) { alert('Erro: ' + error.message); return }
      await reloadExcecoes()
      appState.showModal = null
      render()
    })
  }

  const btnExcluir = document.getElementById('btn-excluir-pausa')
  if (btnExcluir) {
    btnExcluir.addEventListener('click', async () => {
      btnExcluir.disabled = true; btnExcluir.textContent = 'EXCLUINDO...'
      const { error } = await supabase.from('excecoes_agenda').delete().eq('id', excecao.id)
      if (error) { alert('Erro: ' + error.message); btnExcluir.disabled = false; btnExcluir.textContent = 'EXCLUIR PAUSA'; return }
      await reloadExcecoes()
      appState.showModal = null
      render()
    })
  }
}

function attachQuickBookEvents() {
  const overlay = document.querySelector('.overlay')
  const btnCloseX = document.getElementById('btn-close-quick-x')
  const btnClose = document.getElementById('btn-close-quick')
  const btnConfirm = document.getElementById('btn-confirm-quick')

  const close = () => { appState.showModal = null; render() }

  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  if (btnCloseX) btnCloseX.addEventListener('click', close)
  if (btnClose) btnClose.addEventListener('click', close)

  const quickNameInput = document.getElementById('quick-client-name')
  const checkQuickValidity = () => {
    const name = quickNameInput ? quickNameInput.value.trim() : ''
    const serviceHidden = document.getElementById('quick-service-search-selected')
    let selectedCount = 0
    try { selectedCount = JSON.parse(serviceHidden ? serviceHidden.value : '[]').length } catch(e) {}

    const isValid = name !== '' && selectedCount > 0
    if (btnConfirm) {
      btnConfirm.disabled = !isValid
      btnConfirm.style.opacity = isValid ? '1' : '0.5'
      btnConfirm.style.cursor = isValid ? 'pointer' : 'not-allowed'
    }
  }

  // Initial
  checkQuickValidity()
  if (quickNameInput) quickNameInput.addEventListener('input', checkQuickValidity)

  attachServiceSearchSelect('quick-service-search', 'quick-service-list', () => {
    checkQuickValidity()
  })

  const phoneInputQuick = document.getElementById('quick-client-phone')
  if (phoneInputQuick) {
    phoneInputQuick.addEventListener('input', (e) => {
      e.target.value = formatPhone(e.target.value)
    })
  }

  if (btnConfirm) btnConfirm.addEventListener('click', async () => {
    btnConfirm.disabled = true;
    const name = document.getElementById('quick-client-name').value
    const phone = document.getElementById('quick-client-phone').value || ''
    const serviceHidden = document.getElementById('quick-service-search-selected')
    let selectedNames = []
    try { selectedNames = JSON.parse(serviceHidden ? serviceHidden.value : '[]') } catch(e) {}

    if (!name || selectedNames.length === 0) {
      alert('Informe o nome e selecione ao menos um serviço!')
      btnConfirm.disabled = false;
      return
    }

    const serviceNome = selectedNames.join(', ')
    let valorTotal = 0
    let taxaTotalReserva = 0
    let cobraReserva = false
    let firstServiceId = null

    selectedNames.forEach(sn => {
      const servico = appState.servicosAtivos.find(s => s.nome === sn)
      if (servico) {
         valorTotal += Number(servico.preco || 0)
         if (!firstServiceId) firstServiceId = servico.id
         if (servico.cobra_reserva) {
           cobraReserva = true
           taxaTotalReserva += Number(servico.taxa_reserva || 0)
         }
      }
    })

    const dayKey = getAgendaDayKey(appState.selectedDate)
    const item = appState.activeAgendaItem

    const newEntry = { 
      time: item.time, 
      client: name, 
      service: serviceNome, 
      status: cobraReserva ? 'pendente' : 'confirmado',
      cobraReserva,
      taxaReserva: taxaTotalReserva,
      valorTotal: valorTotal
    }

    const idx = appState.agendaData[dayKey].indexOf(item)
    if (idx > -1) {
      appState.agendaData[dayKey][idx] = newEntry
    } else {
      appState.agendaData[dayKey].push(newEntry)
    }
    appState.agendaData[dayKey].sort((a,b) => a.time.localeCompare(b.time))

    const { data: dbData, error } = await supabase.from('agendamentos').insert([{
      estabelecimento_id: appState.user?.id,
      cliente_nome: name,
      cliente_telefone: phone,
      servico_nome: serviceNome,
      servico_id: firstServiceId,
      data_agendamento: dayKey,
      hora_agendamento: item.time,
      agendamento_status: cobraReserva ? 'Pendente' : 'Confirmado',
      pagamento_status: !cobraReserva,
      taxa_reserva: taxaTotalReserva,
      valor_total: valorTotal
    }]).select().single()

    if (error) {
      console.error('Erro no quick book:', error)
    } else if (dbData) {
      newEntry.id = dbData.id
    }

    close()
  })
}

function attachFinancasEvents() {
  attachGenericBack()

  const trigger = document.getElementById('btn-calendar-trigger')
  if (trigger) {
    trigger.addEventListener('click', () => {
      appState.showModal = 'calendar'
      appState.viewingDate = new Date()
      render()
    })
  }

  const btnPrint = document.getElementById('btn-print')
  if (btnPrint) {
    btnPrint.addEventListener('click', () => {
      appState.showModal = 'print-options'
      render()
    })
  }

  const btnClear = document.getElementById('btn-clear-filter')
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      appState.financasData.filterByDay = false
      render()
    })
  }

  const btnAddTrans = document.getElementById('btn-add-trans')
  if (btnAddTrans) {
    btnAddTrans.addEventListener('click', () => {
      appState.showModal = 'new-transaction'
      render()
    })
  }

  const btnPrev = document.getElementById('btn-month-prev')
  const btnNext = document.getElementById('btn-month-next')

  if (btnPrev) {
    btnPrev.addEventListener('click', async () => {
      if (appState.financasData.month === 0) {
        appState.financasData.month = 11
        appState.financasData.year -= 1
      } else {
        appState.financasData.month -= 1
      }
      // Reload all transactions from DB (we keep the full array and filter by month in render)
      if (appState.user) {
        const { data } = await supabase.from('transacoes_financeiras').select('*').eq('estabelecimento_id', appState.user.id).order('data_transacao', { ascending: false })
        if (data) appState.financasData.transactions = data.map(dbTransToLocal)
      }
      render()
    })
  }

  if (btnNext) {
    btnNext.addEventListener('click', async () => {
      if (appState.financasData.month === 11) {
        bg1024.scan(0, 0, 1024, 1024, function(px, py, idx) {
          const dx = px - centerX; const dy = py - centerY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          // Preenche o círculo INTEIRO de preto para garantir que o ícone seja redondo
          if (distance <= radius) {
            this.bitmap.data[idx + 0] = 0;
            this.bitmap.data[idx + 1] = 0;
            this.bitmap.data[idx + 2] = 0;
            this.bitmap.data[idx + 3] = 255;
          }
        });
        appState.financasData.month = 0
        appState.financasData.year += 1
      } else {
        appState.financasData.month += 1
      }
      if (appState.user) {
        const { data } = await supabase.from('transacoes_financeiras').select('*').eq('estabelecimento_id', appState.user.id).order('data_transacao', { ascending: false })
        if (data) appState.financasData.transactions = data.map(dbTransToLocal)
      }
      render()
    })
  }

  // Edit/Delete events
  const editBtns = document.querySelectorAll('.btn-edit-trans')
  const deleteBtns = document.querySelectorAll('.btn-delete-trans')

  editBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const dbId = btn.dataset.dbid
      const trans = appState.financasData.transactions.find(t => t.id === dbId)
      if (trans) {
        appState.financasData.activeTransaction = { ...trans }
        appState.showModal = 'edit-transaction'
        render()
      }
    })
  })

  deleteBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const dbId = btn.dataset.dbid

      // Custom popup
      appState.showModal = 'confirm-delete-trans'
      appState.financasData.pendingDeleteId = dbId
      render()
    })
  })

  // Pay Fixed Helper
  document.querySelectorAll('.btn-pay-fixed').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const desc = btn.dataset.desc
      const val = Number(btn.dataset.val)
      
      // Feedback visual imediato
      btn.textContent = '...'
      btn.disabled = true
      
      const monthViewed = appState.financasData.month + 1;
      const yearViewed = appState.financasData.year;
      const today = new Date();
      const isDifferentMonth = (yearViewed !== today.getFullYear()) || ((monthViewed - 1) !== today.getMonth());
      
      let txDate = `${yearViewed}-${String(monthViewed).padStart(2,'0')}-01`;
      let finalDesc = desc;

      if (isDifferentMonth) {
         txDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
         finalDesc = `${desc} [REF:${String(monthViewed).padStart(2, '0')}/${yearViewed}]`;
      }
      
      const payload = {
        estabelecimento_id: appState.user.id,
        descricao: finalDesc,
        valor: val,
        tipo: 'saida',
        categoria: 'Fixo',
        data_transacao: txDate
      }

      const { data, error } = await supabase.from('transacoes_financeiras').insert([payload]).select().single()
      if (error) {
        alert('Erro ao pagar: ' + error.message)
        btn.textContent = 'PAGAR AGORA'
        btn.disabled = false
      } else {
        // Atualização instantânea na tela
        if (data) {
          appState.financasData.transactions.unshift(dbTransToLocal(data))
        }
        render()
      }
    })
  })


  document.querySelectorAll('.btn-reverse-trans').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const dbId = btn.dataset.dbid
      const agendaId = btn.dataset.agendaid

      // Custom popup
      appState.showModal = 'confirm-reverse-trans'
      appState.financasData.pendingReverseDbId = dbId
      appState.financasData.pendingReverseAgendaId = agendaId
      render()
    })
  })

  document.querySelectorAll('.btn-reverse-fixed-payment').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      appState.showModal = 'confirm-reverse-fixed'
      appState.financasData.pendingReverseFixedId = btn.dataset.dbid
      render()
    })
  })

  document.querySelectorAll('.btn-delete-trans-all').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      appState.showModal = 'confirm-delete-all-fixed'
      appState.financasData.pendingDeleteAllFixedDesc = btn.dataset.desc
      render()
    })
  })

  const filters = document.querySelectorAll('.filter-chip')
  filters.forEach(f => {
    f.addEventListener('click', () => {
      appState.financasData.categoryFilter = f.dataset.filter
      render()
    })
  })
}

function attachNewTransactionEvents() {
  const overlay = document.querySelector('.overlay')
  const btnClose = document.getElementById('btn-close-trans-x')
  const btnConfirm = document.getElementById('btn-confirm-trans')
  const selectType = document.getElementById('trans-type')

  const btnDate = document.getElementById('btn-new-trans-date')

  const close = () => { appState.showModal = null; render() }

  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  if (btnClose) btnClose.addEventListener('click', close)

  if (btnDate) btnDate.addEventListener('click', () => {
    const d = new Date(appState.financasData.tempDate + 'T00:00:00')
    appState.viewingDate = new Date(d.getFullYear(), d.getMonth(), 1)
    appState.showModal = 'calendar'
    appState.calendarContext = 'new-transaction'
    render()
  })

  if (selectType) selectType.addEventListener('change', () => {
    selectType.style.color = selectType.value === 'in' ? '#16a34a' : '#dc2626'
  })

  // Currency mask for value input
  const valInput = document.getElementById('trans-val')
  if (valInput) {
    valInput.addEventListener('input', () => {
      let v = valInput.value.replace(/\D/g, '')
      v = (Number(v) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      valInput.value = v
    })
  }

  // Capitalize description
  const descInput = document.getElementById('trans-desc')
  if (descInput) {
    descInput.addEventListener('input', () => {
      const pos = descInput.selectionStart
      descInput.value = descInput.value.replace(/(?:^|\\s)\\S/g, c => c.toUpperCase())
      descInput.setSelectionRange(pos, pos)
    })
  }

  if (btnConfirm) btnConfirm.addEventListener('click', async () => {
    const desc = document.getElementById('trans-desc').value.trim()
    const rawVal = document.getElementById('trans-val').value
    const val = Number(rawVal.replace(/[^0-9,]+/g, '').replace(',', '.'))
    const dateInput = appState.financasData.tempDate
    const typeFull = document.getElementById('trans-type').value

    if (!desc || isNaN(val) || val <= 0 || !dateInput) {
      alert('Por favor, preencha todos os campos.')
      return
    }

    // Optimistic Save
    appState.financasData.transactions.unshift(dbTransToLocal(payload)) // Use payload as temporary visual data
    close()
    alert('Transação lançada com sucesso!')

    // Background DB Sync
    supabase.from('transacoes_financeiras').insert([payload]).select().then(({ data: dbData, error }) => {
      if (error) {
        alert('Erro ao sincronizar transação: ' + error.message)
        console.error('Sync Error:', error)
      } else if (dbData) {
        // Replace temp with real db data if needed for IDs
        const idx = appState.financasData.transactions.findIndex(t => t.desc === payload.descricao && t.val === payload.valor)
        if (idx > -1) appState.financasData.transactions[idx] = dbTransToLocal(dbData[0])
      }
    })
  })
}

function attachPrintOptionsEvents() {
  const overlay = document.querySelector('.overlay')
  const btnCloseX = document.getElementById('btn-close-print-modal-x')
  const btnClose = document.getElementById('btn-close-print-modal')
  const btnMonthly = document.getElementById('btn-report-monthly')
  const btnAnnual = document.getElementById('btn-report-annual')

  const close = () => { appState.showModal = null; render() }

  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  if (btnCloseX) btnCloseX.addEventListener('click', close)
  if (btnClose) btnClose.addEventListener('click', close)

  if (btnMonthly) btnMonthly.addEventListener('click', () => {
    appState.showModal = 'report-view'
    appState.reportType = 'monthly'
    render()
  })
  if (btnAnnual) btnAnnual.addEventListener('click', () => {
    appState.showModal = 'report-view'
    appState.reportType = 'annual'
    render()
  })
}

function attachReportViewEvents() {
  const btnClose = document.getElementById('btn-close-report')
  if (btnClose) btnClose.addEventListener('click', () => {
    appState.showModal = null
    render()
  })
}

function attachEditTransactionEvents() {
  const overlay = document.querySelector('.overlay')
  const btnCloseX = document.getElementById('btn-close-edit-trans-x')
  const btnClose = document.getElementById('btn-close-edit-trans')
  const btnSave = document.getElementById('btn-save-edit-trans')
  const btnDate = document.getElementById('btn-edit-trans-date')
  const selectType = document.getElementById('edit-trans-type')

  const close = () => { appState.showModal = null; render() }

  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  if (btnCloseX) btnCloseX.addEventListener('click', close)
  if (btnClose) btnClose.addEventListener('click', close)

  if (btnDate) btnDate.addEventListener('click', () => {
    const d = new Date(appState.financasData.activeTransaction.fullDate + 'T00:00:00')
    appState.viewingDate = new Date(d.getFullYear(), d.getMonth(), 1)
    appState.showModal = 'calendar'
    appState.calendarContext = 'edit-transaction'
    render()
  })

  if (selectType) selectType.addEventListener('change', () => {
    selectType.style.color = selectType.value === 'in' ? '#16a34a' : '#dc2626'
  })

  // Currency mask for value input
  const valInput = document.getElementById('edit-trans-val')
  if (valInput) {
    valInput.addEventListener('input', () => {
      let v = valInput.value.replace(/\D/g, '')
      v = (Number(v) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      valInput.value = v
    })
  }

  if (btnSave) btnSave.addEventListener('click', async () => {
    const desc = document.getElementById('edit-trans-desc').value.trim()
    const rawVal = document.getElementById('edit-trans-val').value
    const val = Number(rawVal.replace(/[^0-9,]+/g, '').replace(',', '.'))
    const dateInput = appState.financasData.activeTransaction.fullDate
    const typeFull = document.getElementById('edit-trans-type').value
    const dbId = appState.financasData.activeTransaction.id

    if (!desc || isNaN(val) || val <= 0 || !dateInput) {
      alert('Por favor, preencha todos os campos.')
      return
    }

    const payload = localTransToDb(desc, val, typeFull, dateInput, appState.user.id)

    // Optimistic Edit
    const idx = appState.financasData.transactions.findIndex(t => t.id === dbId)
    if (idx !== -1) {
      appState.financasData.transactions[idx] = dbTransToLocal(payload)
      appState.financasData.transactions[idx].id = dbId // Keep ID
    }
    close()
    
    // Background Sync
    supabase.from('transacoes_financeiras').update(payload).eq('id', dbId).select().then(({ data, error }) => {
      if (error) {
        alert('Erro ao sincronizar edição: ' + error.message)
      } else if (data) {
        const i = appState.financasData.transactions.findIndex(t => t.id === dbId)
        if (i !== -1) appState.financasData.transactions[i] = dbTransToLocal(data[0])
      }
    })
  })
}
function attachServicosEvents() {
  attachGenericBack()

  const toggle = document.getElementById('toggle-reserva')
  if (toggle) {
    toggle.addEventListener('click', () => {
      appState.servicosForm.chargeReserva = !appState.servicosForm.chargeReserva
      render()
    })
  }

  const nameInput = document.getElementById('input-nome-servico')
  if (nameInput) {
    nameInput.addEventListener('input', (e) => {
      const pos = e.target.selectionStart
      e.target.value = e.target.value.replace(/(?:^|\\s)\\S/g, c => c.toUpperCase())
      e.target.setSelectionRange(pos, pos)
      appState.servicosForm.name = e.target.value
    })
  }

  const priceInput = document.getElementById('input-preco-servico')
  if (priceInput) {
    priceInput.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '')
      v = (Number(v) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      appState.servicosForm.price = v
      e.target.value = v
    })
  }

  const durationInput = document.getElementById('input-duracao-servico')
  if (durationInput) {
    durationInput.addEventListener('input', (e) => {
      appState.servicosForm.duration = e.target.value
    })
  }

  const taxaInput = document.getElementById('input-taxa-reserva')
  if (taxaInput) {
    taxaInput.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '')
      v = (Number(v) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      appState.servicosForm.reservaValue = v
      e.target.value = v
    })
  }

  const pixInputEl = document.getElementById('input-chave-pix')
  if (pixInputEl) {
    pixInputEl.addEventListener('input', (e) => {
      appState.servicosForm.chavePix = e.target.value
    })
  }

  const parseCurrency = (str) => {
    if (!str) return 0
    return Number(str.replace(/[^0-9,-]+/g, "").replace(",", "."))
  }

  const btnSalvar = document.getElementById('btn-salvar-servico')
  if (btnSalvar) {
    btnSalvar.addEventListener('click', async () => {
      if (!appState.servicosForm.name || !appState.servicosForm.price || !appState.servicosForm.duration) {
        return alert('Por favor, preencha o nome, preço e duração do serviço!')
      }

      // Se cobra taxa de reserva, verificar se preencheu a chave PIX
      let chavePixValue = ''
      if (appState.servicosForm.chargeReserva) {
        const pixInput = document.getElementById('input-chave-pix')
        chavePixValue = pixInput ? pixInput.value.trim() : ''
        if (!chavePixValue) {
          return alert('Por favor, informe a sua Chave PIX para receber a taxa de reserva.')
        }
      }

      btnSalvar.textContent = 'SALVANDO...'
      btnSalvar.disabled = true

      const durationParts = appState.servicosForm.duration.split(':')
      const totalMinutes = (parseInt(durationParts[0]) * 60) + parseInt(durationParts[1])

      const payload = {
        estabelecimento_id: appState.user.id,
        nome: appState.servicosForm.name,
        preco: parseCurrency(appState.servicosForm.price),
        duracao_minutos: totalMinutes,
        cobra_reserva: appState.servicosForm.chargeReserva,
        taxa_reserva: appState.servicosForm.chargeReserva ? parseCurrency(appState.servicosForm.reservaValue) : 0
      }

      // Optimistic state cleanup
      appState.servicosForm = { name: '', price: '', duration: '00:00', chargeReserva: false, reservaValue: '', chavePix: '' }
      alert('Serviço sendo salvo em seu catálogo!')
      render()

      // Background DB operations
      supabase.from('servicos').insert([payload]).select().then(({ data: dbData, error }) => {
        if (error) {
           alert('Erro ao sincronizar novo serviço: ' + error.message)
           return
        }
        if (dbData) appState.servicosAtivos.unshift(dbData[0])
        
        // Update chave pix if needed
        if (payload.cobra_reserva && chavePixValue && chavePixValue !== appState.profile?.chave_pix) {
          supabase.from('estabelecimentos').update({ chave_pix: chavePixValue }).eq('id', appState.user.id).then(({ error: upErr }) => {
            if (!upErr) appState.profile.chave_pix = chavePixValue
          })
        }
        render()
      })
    })
  }

  // Edit buttons — capitaliza nome ao editar
  document.querySelectorAll('.btn-edit-servico').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id
      const s = appState.servicosAtivos.find(x => x.id === id)
      appState.editingServicoId = id
      appState.editingServicoForm = {
        nome: s.nome,
        preco_str: 'R$ ' + Number(s.preco).toFixed(2).replace('.', ','),
        duracao_minutos: s.duracao_minutos,
        chargeReserva: s.cobra_reserva || false,
        taxa_str: s.taxa_reserva ? 'R$ ' + Number(s.taxa_reserva).toFixed(2).replace('.', ',') : '',
        chave_pix: appState.profile?.chave_pix || ''
      }
      render()
    })
  })

  // Edit reserva toggle
  document.querySelectorAll('[id^="edit-toggle-reserva-"]').forEach(toggle => {
    toggle.addEventListener('click', () => {
      appState.editingServicoForm.chargeReserva = !appState.editingServicoForm.chargeReserva
      render()
    })
  })

  document.querySelectorAll('[id^="edit-chave-"]').forEach(input => {
    input.addEventListener('input', (e) => {
      appState.editingServicoForm.chave_pix = e.target.value
    })
  })

  document.querySelectorAll('.btn-cancel-edit-servico').forEach(btn => {
    btn.addEventListener('click', () => {
      appState.editingServicoId = null
      appState.editingServicoForm = {}
      render()
      // After render, attach capitalize to the nome field
      setTimeout(() => {
        const nomeInput = document.getElementById('edit-nome-' + id)
        if (nomeInput) {
          nomeInput.addEventListener('input', () => {
            const pos = nomeInput.selectionStart
            nomeInput.value = nomeInput.value.replace(/(?:^|\\s)\\S/g, c => c.toUpperCase())
            nomeInput.setSelectionRange(pos, pos)
          })
        }
      }, 0)
    })
  })

  const parseCurrencyEdit = (str) => {
    if (!str) return 0
    return Number(str.replace(/[^0-9,-]+/g, '').replace(',', '.'))
  }

  document.querySelectorAll('.btn-save-edit-servico').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id
      const nome = document.getElementById('edit-nome-' + id).value.trim()
      const precoStr = document.getElementById('edit-preco-' + id).value
      const timeVal = document.getElementById('edit-duracao-' + id).value // HH:MM
      const taxaInput = document.getElementById('edit-taxa-' + id)

      if (!nome || !precoStr || !timeVal) return alert('Preencha todos os campos!')

      const timeParts = timeVal.split(':')
      const duracao = (parseInt(timeParts[0]) * 60) + parseInt(timeParts[1])

      if (!duracao) return alert('Defina uma duração válida!')

      btn.textContent = 'SALVANDO...'
      btn.disabled = true

      const preco = parseCurrencyEdit(precoStr)
      const cobraReserva = appState.editingServicoForm.chargeReserva || false
      const taxaReserva = (cobraReserva && taxaInput) ? parseCurrencyEdit(taxaInput.value) : 0

      const chaveInput = document.getElementById('edit-chave-' + id)
      const chave_pix = (cobraReserva && chaveInput) ? chaveInput.value.trim() : null

      if (cobraReserva && !chave_pix) {
        btn.textContent = 'SALVAR'
        btn.disabled = false
        return alert('Por favor, informe a Chave PIX para receber a taxa de reserva.')
      }

      const payload = {
        nome, preco, duracao_minutos: duracao, cobra_reserva: cobraReserva, taxa_reserva: taxaReserva
      }

      // Optimistic Update
      const idx = appState.servicosAtivos.findIndex(x => x.id === id)
      if (idx !== -1) {
        appState.servicosAtivos[idx] = { ...appState.servicosAtivos[idx], ...payload }
      }
      appState.editingServicoId = null
      appState.editingServicoForm = {}
      render()

      // Background Sync
      supabase.from('servicos').update(payload).eq('id', id).select().then(({ data, error }) => {
        if (error) {
          alert('Erro ao sincronizar edição do serviço: ' + error.message)
        } else if (data) {
          const i = appState.servicosAtivos.findIndex(x => x.id === id)
          if (i !== -1) appState.servicosAtivos[i] = data[0]
        }
        render()
      })

      // Background Chave Pix update
      if (cobraReserva && chave_pix && chave_pix !== appState.profile?.chave_pix) {
        supabase.from('estabelecimentos').update({ chave_pix: chave_pix }).eq('id', appState.user.id).then(({ error: upErr }) => {
          if (!upErr) appState.profile.chave_pix = chave_pix
        })
      }
    })
  })

  document.querySelectorAll('.btn-delete-servico').forEach(btn => {
    btn.addEventListener('click', () => {
      appState.deletingServicoId = btn.dataset.id
      appState.showModal = 'delete-servico'
      render()
    })
  })
}
function attachAssinaturasEvents() {
  attachGenericBack()
  const cardMensal = document.getElementById('card-mensal')
  const cardAnual = document.getElementById('card-anual')

  if (cardMensal) {
    cardMensal.addEventListener('click', () => {
      appState.selectedAssinatura = 'mensal'
      render()
    })
  }

  if (cardAnual) {
    cardAnual.addEventListener('click', () => {
      appState.selectedAssinatura = 'anual'
      render()
    })
  }
}

// ─── Helper: Cria agendamento no banco e PIX se tiver taxa ─────────────────
async function criarAgendamentoComPix({ clienteNome, servicoId, servicoNome, data, horario, cobraReserva, taxaReserva }) {
  const userId = appState.user?.id
  if (!userId) return

  // 1. Salva o agendamento no banco
  const status = cobraReserva ? 'aguardando_pagamento' : 'confirmado'
  const { data: agendamento, error } = await supabase
    .from('agendamentos')
    .insert([{
      estabelecimento_id: userId,
      cliente_nome: clienteNome,
      servico_id: servicoId ?? null,
      servico_nome: servicoNome,
      data_agendamento: data,
      hora_agendamento: horario,  // usar nome real da coluna existente
      status,
      taxa_reserva: cobraReserva ? taxaReserva : 0,
    }])
    .select()
    .single()

  if (error) {
    alert('Erro ao salvar agendamento: ' + error.message)
    return
  }

  // Atualiza também o estado local da agenda para UI imediata
  const dayKey = data
  if (!appState.agendaData[dayKey]) appState.agendaData[dayKey] = getInitialDayData()

  // 2. Se não cobra, termina aqui
  if (!cobraReserva) {
    appState.showModal = null
    render()
    alert('Agendamento confirmado com sucesso!')
    return
  }

  // 3. Verifica se tem token MP
  const mpToken = appState.user?.user_metadata?.mp_access_token
  if (!mpToken) {
    appState.pendingAgendamento = { clienteNome, servicoId, servicoNome, data, horario, cobraReserva, taxaReserva }
    appState.showModal = 'mercadopago'
    render()
    return
  }

  // 4. Chama Edge Function para criar PIX
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(
    'https://fdoecadsyvbhjgasdbxk.supabase.co/functions/v1/mp-create-pix',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({
        agendamento_id: agendamento.id,
        estabelecimento_id: userId,
        servico_nome: servicoNome,
        taxa_reserva: taxaReserva,
      }),
    }
  )

  const result = await res.json()

  if (!result.success) {
    alert('Agendamento salvo, mas erro ao gerar PIX: ' + (result.error ?? 'desconhecido'))
    appState.showModal = null
    render()
    return
  }

  // 5. Abre modal do PIX com QR code
  appState.pixModal = {
    agendamento_id: agendamento.id,
    qr_code: result.qr_code,
    qr_code_b64: result.qr_code_b64,
    ticket_url: result.ticket_url,
    valor: taxaReserva,
  }
  appState.showModal = 'pix-aguardando'
  render()
}
// ──────────────────────────────────────────────────────────────────────────────

// Initial boot: splash screen logic
function showSplashScreen() {
  const splash = document.createElement('div');
  splash.id = 'pwa-splash-container';
  splash.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: white; z-index: 9999999; margin: 0; padding: 0; gap: 2rem;
  `;
  splash.innerHTML = `
    <img src="/logo_pegasus_full.png" alt="Pegasus" style="width: 75vw; max-width: 500px; height: auto;">
    <div class="pwa-spinner"></div>
    <style>
      .pwa-spinner {
        width: 40px; height: 40px;
        border: 4px solid #e5e7eb;
        border-top: 4px solid #000000;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
  `;
  document.body.appendChild(splash);
}

showSplashScreen()
handleMpCallback().then(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    appState.user = session.user;
    // Restore theme and full profile from DB on session resume
    try {
      const { data: profile } = await supabase
        .from('estabelecimentos')
        .select('*')
        .eq('id', session.user.id)
        .single()
      if (profile) {
        appState.theme = profile.tipo // 'barbearia' ou 'salao'
        appState.profile = profile
      }
    } catch(e) { console.warn('Could not restore theme from profile', e) }

    appState.screen = 'dashboard';
  }
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      appState.user = null;
      appState.screen = 'login';
      render();
    }
  });

  render();

  // --- Hardware Back Button (Android) ---
  // Push an initial state so popstate fires when user presses Back
  history.pushState({ screen: appState.screen }, '');

  window.addEventListener('popstate', (e) => {
    // If we're not on login, go back to previous screen instead of closing
    if (appState.screen !== 'login') {
      // Close any open modal first
      if (appState.showModal) {
        appState.showModal = null;
        render();
      } else if (appState.screen !== 'dashboard') {
        // Go back to dashboard from sub-screens
        appState.screen = 'dashboard';
        render();
      }
      // Push another state so the next back press also gets intercepted
      history.pushState({ screen: appState.screen }, '');
    } else {
      // On login screen, allow the browser to minimize/close naturally
      history.back();
    }
  });

  // --- Update Check & Splash (Auto-update like Spartan App) ---
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      reg.update()
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New version ready, force refresh
            window.location.reload()
          }
        })
      })
    })
  }

  setTimeout(() => {
    const splash = document.getElementById('pwa-splash-container');
    if (splash) {
      splash.style.transition = 'opacity 0.5s ease-out';
      splash.style.opacity = '0';
      setTimeout(() => splash.remove(), 500);
    }
  }, 1000);
})