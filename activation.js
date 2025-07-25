const { machineIdSync } = require('node-machine-id');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://bcdahtsjocjyumzconzf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjZGFodHNqb2NqeXVtemNvbnpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI0OTU4NTMsImV4cCI6MjA2ODA3MTg1M30.Ofq3LDNBJ1F1-oYtG7mjXSXXvHZEha-3d2butir5gX4';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const getDeviceId = () => machineIdSync();
const getActivationFile = () => path.join(require('electron').app.getPath('userData'), 'activation.json');
const getLogFile = () => path.join(process.cwd(), 'log.txt');

async function checkActivation() {
  const file = getActivationFile();
  if (!fs.existsSync(file)) { return false; }
  try {
    const content = fs.readFileSync(file, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return 'corrupted';
    }
    const { code, deviceId } = parsed;
    if (!code || !deviceId) { return false; }
    // Сначала ищем в activation_codes
    let { data, error } = await supabase
      .from('activation_codes')
      .select('*')
      .eq('code', code)
      .single();
    if (!data || error) {
      // Если не найдено — ищем в limited_activation_codes
      const res = await supabase
        .from('limited_activation_codes')
        .select('*')
        .eq('code', code)
        .single();
      data = res.data;
      error = res.error;
      if (error || !data) { return false; }
      // Проверка deviceId и срока действия для ограниченных кодов
      if (data.device_id && data.device_id !== deviceId) { return 'mismatch'; }
      if (data.expires_at && new Date(data.expires_at) < new Date()) { return 'expired'; }
      return true;
    }
    // Проверка deviceId для безлимитных
    if (data.device_id && data.device_id !== deviceId) { return 'mismatch'; }
    return true;
  } catch (e) {
    return false;
  }
}

async function activateWithCode(code) {
  const deviceId = getDeviceId();
  // Сначала ищем в activation_codes
  let { data, error } = await supabase
    .from('activation_codes')
    .select('*')
    .eq('code', code)
    .single();
  let table = 'activation_codes';
  if (!data || error) {
    // Если не найдено — ищем в limited_activation_codes
    const res = await supabase
      .from('limited_activation_codes')
      .select('*')
      .eq('code', code)
      .single();
    data = res.data;
    error = res.error;
    table = 'limited_activation_codes';
  if (error || !data) { return { ok: false, message: 'Код не найден' }; }
    if (data.device_id && data.device_id !== deviceId) {
      return { ok: false, message: 'Код уже активирован на другом устройстве (limited)' };
    }
    // Проверка срока действия (если уже активирован)
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return { ok: false, message: 'Срок действия кода истёк (limited)' };
    }
    // Если код ещё не активирован — активируем и выставляем expires_at
    let expires_at = null;
    if (!data.activated_at) {
      if (data.type === '1month') {
        expires_at = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
      } else if (data.type === '3month') {
        expires_at = new Date(Date.now() + 93 * 24 * 60 * 60 * 1000).toISOString();
      }
    }
    const { error: updateError } = await supabase
      .from('limited_activation_codes')
      .update({ device_id: deviceId, activated_at: new Date().toISOString(), expires_at })
      .eq('code', code);
    if (updateError) { return { ok: false, message: 'Ошибка активации' }; }
    const file = getActivationFile();
    fs.writeFileSync(file, JSON.stringify({ code, deviceId }), 'utf8');
    return { ok: true };
  }
  // Безлимитный код
  if (data.device_id && data.device_id !== deviceId) {
    return { ok: false, message: 'Код уже активирован на другом устройстве' };
  }
  const { error: updateError } = await supabase
    .from('activation_codes')
    .update({ device_id: deviceId, activated_at: new Date().toISOString() })
    .eq('code', code);
  if (updateError) { return { ok: false, message: 'Ошибка активации' }; }
  const file = getActivationFile();
  fs.writeFileSync(file, JSON.stringify({ code, deviceId }), 'utf8');
  return { ok: true };
}

// Получить информацию о текущей активации (тип, срок действия)
async function getActivationInfo() {
  const file = getActivationFile();
  if (!fs.existsSync(file)) return null;
  try {
    const content = fs.readFileSync(file, 'utf8');
    let parsed = JSON.parse(content);
    const { code, deviceId } = parsed;
    if (!code || !deviceId) return null;
    // Сначала ищем в activation_codes
    let { data, error } = await supabase
      .from('activation_codes')
      .select('*')
      .eq('code', code)
      .single();
    if (!data || error) {
      // Если не найдено — ищем в limited_activation_codes
      const res = await supabase
        .from('limited_activation_codes')
        .select('*')
        .eq('code', code)
        .single();
      data = res.data;
      error = res.error;
      if (error || !data) return null;
      // Для ограниченных кодов возвращаем срок действия и тип
      return {
        type: data.type,
        expires_at: data.expires_at,
        activated_at: data.activated_at
      };
    }
    // Для безлимитных возвращаем только тип
    return {
      type: 'unlimited',
      expires_at: null,
      activated_at: data.activated_at
    };
  } catch (e) {
    return null;
  }
}

module.exports = { checkActivation, activateWithCode, getActivationInfo }; 