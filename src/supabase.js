import { createClient } from '@supabase/supabase-js'

// Variáveis do Projeto Pegasus no Supabase
const supabaseUrl = 'https://fdoecadsyvbhjgasdbxk.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkb2VjYWRzeXZiaGpnYXNkYnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMzgyNDMsImV4cCI6MjA4ODgxNDI0M30.2XcUlosPv-j1JfTC7OjN7gt5zjd5jlq0p7-cpDujTZ8'

export const supabase = createClient(supabaseUrl, supabaseKey)
