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
  console.log('Проверка активации. Файл:', file);
  console.log('Файл существует:', fs.existsSync(file));
  
  if (!fs.existsSync(file)) { 
    console.log('Файл активации не найден');
    return false; 
  }
  
  try {
    const content = fs.readFileSync(file, 'utf8');
    console.log('Содержимое файла активации:', content);
    
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.log('Ошибка парсинга JSON:', e.message);
      return 'corrupted';
    }
    
    const { code, deviceId } = parsed;
    console.log('Код из файла:', code);
    console.log('DeviceId из файла:', deviceId);
    
    if (!code || !deviceId) { 
      console.log('Код или deviceId отсутствуют');
      return false; 
    }
    
    // Сначала ищем в activation_codes
    console.log('=== ПРОВЕРКА АКТИВАЦИИ ===');
    console.log('Поиск кода в activation_codes...');
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
    }
    
    if (error || !data) { 
      console.log('Код не найден в базе данных. Удаляем локальный файл активации...');
      // Код не найден в базе - удаляем локальный файл активации
      try {
        fs.unlinkSync(file);
        console.log('Локальный файл активации удален');
      } catch (e) {
        console.log('Ошибка при удалении файла активации:', e.message);
        // Игнорируем ошибки удаления файла
      }
      return false; 
    }
    
    // Проверяем, привязан ли код к текущему устройству
    console.log('Проверка device_id. В базе:', data.device_id, 'Текущий:', deviceId);
    if (data.device_id && data.device_id !== deviceId) { 
      console.log('Код привязан к другому устройству. Удаляем локальный файл...');
      // Код привязан к другому устройству - удаляем локальный файл
      try {
        fs.unlinkSync(file);
        console.log('Локальный файл активации удален (mismatch)');
      } catch (e) {
        console.log('Ошибка при удалении файла активации (mismatch):', e.message);
        // Игнорируем ошибки удаления файла
      }
      return 'mismatch'; 
    }
    
    // Для ограниченных кодов проверяем срок действия
    if (table === 'limited_activation_codes') {
      console.log('Проверка срока действия для ограниченного кода:', data.expires_at);
      if (data.expires_at && new Date(data.expires_at) < new Date()) { 
        console.log('Срок действия истек. Удаляем локальный файл...');
        // Срок истек - удаляем локальный файл
        try {
          fs.unlinkSync(file);
          console.log('Локальный файл активации удален (expired)');
        } catch (e) {
          console.log('Ошибка при удалении файла активации (expired):', e.message);
          // Игнорируем ошибки удаления файла
        }
        return 'expired'; 
      }
    }
    
    console.log('Активация успешна!');
    return true;
  } catch (e) {
    return false;
  }
}

async function activateWithCode(code) {
  const deviceId = getDeviceId();
  console.log('Активация кода:', code, 'для устройства:', deviceId);
  
  // Сначала ищем в activation_codes
  let { data, error } = await supabase
    .from('activation_codes')
    .select('*')
    .eq('code', code)
    .single();
  let table = 'activation_codes';
  
  console.log('Поиск в activation_codes:', { data, error });
  
  if (!data || error) {
    // Если не найдено — ищем в limited_activation_codes
    console.log('Поиск в limited_activation_codes...');
    const res = await supabase
      .from('limited_activation_codes')
      .select('*')
      .eq('code', code)
      .single();
    data = res.data;
    error = res.error;
    table = 'limited_activation_codes';
    console.log('Результат поиска в limited_activation_codes:', { data, error });
  }
  
  if (error || !data) { 
    console.log('Код не найден в обеих таблицах');
    return { ok: false, message: 'Код не найден' }; 
  }
  
  console.log('Код найден в таблице:', table);
  
  if (table === 'limited_activation_codes') {
    // Обработка ограниченного кода
    if (data.device_id && data.device_id !== deviceId) {
      console.log('Код уже активирован на другом устройстве (limited)');
      return { ok: false, message: 'Код уже активирован на другом устройстве (limited)' };
    }
    
    // Проверка срока действия (если уже активирован)
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      console.log('Срок действия кода истёк (limited)');
      return { ok: false, message: 'Срок действия кода истёк (limited)' };
    }
    
    // Если код ещё не активирован — активируем и выставляем expires_at
    let expires_at = data.expires_at;
    if (!data.activated_at) {
      if (data.type === '1month') {
        expires_at = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
      } else if (data.type === '3month') {
        expires_at = new Date(Date.now() + 93 * 24 * 60 * 60 * 1000).toISOString();
      }
    }
    
    console.log('Активация ограниченного кода...');
    const { error: updateError } = await supabase
      .from('limited_activation_codes')
      .update({ device_id: deviceId, activated_at: new Date().toISOString(), expires_at })
      .eq('code', code);
    
    if (updateError) { 
      console.log('Ошибка активации ограниченного кода:', updateError);
      return { ok: false, message: 'Ошибка активации' }; 
    }
    
    const file = getActivationFile();
    fs.writeFileSync(file, JSON.stringify({ code, deviceId }), 'utf8');
    console.log('Ограниченный код успешно активирован');
    return { ok: true };
  } else {
    // Обработка безлимитного кода
    if (data.device_id && data.device_id !== deviceId) {
      console.log('Код уже активирован на другом устройстве (unlimited)');
      return { ok: false, message: 'Код уже активирован на другом устройстве' };
    }
    
    console.log('Активация безлимитного кода...');
    const { error: updateError } = await supabase
      .from('activation_codes')
      .update({ device_id: deviceId, activated_at: new Date().toISOString() })
      .eq('code', code);
    
    if (updateError) { 
      console.log('Ошибка активации безлимитного кода:', updateError);
      return { ok: false, message: 'Ошибка активации' }; 
    }
    
    const file = getActivationFile();
    fs.writeFileSync(file, JSON.stringify({ code, deviceId }), 'utf8');
    console.log('Безлимитный код успешно активирован');
    return { ok: true };
  }
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
    }
    
    if (error || !data) {
      // Код не найден в базе - удаляем локальный файл активации
      try {
        fs.unlinkSync(file);
      } catch (e) {
        // Игнорируем ошибки удаления файла
      }
      return null;
    }
    
    // Проверяем, привязан ли код к текущему устройству
    if (data.device_id && data.device_id !== deviceId) {
      // Код привязан к другому устройству - удаляем локальный файл
      try {
        fs.unlinkSync(file);
      } catch (e) {
        // Игнорируем ошибки удаления файла
      }
      return null;
    }
    
    // Для ограниченных кодов возвращаем срок действия и тип
    if (table === 'limited_activation_codes') {
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