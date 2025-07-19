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
function log(msg) {
  const line = `[${new Date().toISOString()}] [activation] ${msg}\n`;
  fs.appendFileSync(getLogFile(), line, 'utf8');
  console.log(line);
}

async function checkActivation() {
  const file = getActivationFile();
  if (!fs.existsSync(file)) { log('activation file not found'); return false; }
  try {
    const content = fs.readFileSync(file, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      log('activation file corrupted: ' + e.message);
      return 'corrupted';
    }
    const { code, deviceId } = parsed;
    if (!code || !deviceId) { log('activation file missing code or deviceId'); return false; }
    log(`checkActivation: code=${code}, deviceId=${deviceId}`);
    const { data, error } = await supabase
      .from('activation_codes')
      .select('*')
      .eq('code', code)
      .single();
    log(`Supabase response: ${JSON.stringify({data, error})}`);
    if (error || !data) { log('activation code not found in supabase'); return false; }
    if (data.device_id !== deviceId) { log('deviceId mismatch'); return 'mismatch'; }
    log('activation OK');
    return true;
  } catch (e) {
    log('checkActivation error: ' + e.message);
    return false;
  }
}

async function activateWithCode(code) {
  const deviceId = getDeviceId();
  log(`activateWithCode: code=${code}, deviceId=${deviceId}`);
  const { data, error } = await supabase
    .from('activation_codes')
    .select('*')
    .eq('code', code)
    .single();
  log(`Supabase response: ${JSON.stringify({data, error})}`);
  if (error || !data) { log('Код не найден'); return { ok: false, message: 'Код не найден' }; }
  if (data.device_id && data.device_id !== deviceId) {
    log('Код уже активирован на другом устройстве');
    return { ok: false, message: 'Код уже активирован на другом устройстве' };
  }
  const { error: updateError } = await supabase
    .from('activation_codes')
    .update({ device_id: deviceId, activated_at: new Date().toISOString() })
    .eq('code', code);
  log(`Supabase update: ${JSON.stringify({updateError})}`);
  if (updateError) { log('Ошибка активации'); return { ok: false, message: 'Ошибка активации' }; }
  const file = getActivationFile();
  fs.writeFileSync(file, JSON.stringify({ code, deviceId }), 'utf8');
  log('Активация успешна, данные сохранены');
  return { ok: true };
}

module.exports = { checkActivation, activateWithCode }; 