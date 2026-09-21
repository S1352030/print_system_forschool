import { apiPost } from './api.js';

let card = null;
let revision = 0;
let onChange = () => {};

export const getGiftCard = () => card;
export function giftCardReady() {
  return !document.getElementById('gift-card-code')?.value.trim() || card !== null;
}

export function clearGiftCard(message = '') {
  revision++;
  card = null;
  const input = document.getElementById('gift-card-code');
  if (input) input.value = '';
  setStatus(message);
  onChange();
}

function setStatus(message) {
  const status = document.getElementById('gift-card-status');
  if (status) status.textContent = message;
}

export function updateGiftCardBalance(balance) {
  if (!card) return;
  if (balance === 0) {
    clearGiftCard('這張禮物卡已使用完畢。');
  } else {
    card.balance = balance;
    setStatus(`可用餘額 NT$ ${balance} 元・無使用期限`);
    onChange();
  }
}

export function invalidateGiftCard() {
  card = null;
  revision++;
  setStatus('餘額可能已變動，請重新套用禮物卡並確認金額。');
  onChange();
}

export function bindGiftCardEvents(callback) {
  onChange = callback;
  const input = document.getElementById('gift-card-code');
  const apply = document.getElementById('gift-card-apply');
  input?.addEventListener('input', () => {
    revision++;
    card = null;
    setStatus(input.value.trim() ? '請按「套用」確認可用餘額。' : '有禮物卡可折抵列印費用，剩餘金額下次繼續用。');
    onChange();
  });
  document.getElementById('gift-card-remove')?.addEventListener('click', () => clearGiftCard());
  apply?.addEventListener('click', async () => {
    const code = input.value.trim();
    if (!code) return;
    const currentRevision = ++revision;
    card = null;
    apply.disabled = true;
    setStatus('正在確認餘額…');
    onChange();
    try {
      const result = await apiPost('/api/gift-cards/check', { code });
      if (currentRevision !== revision) return;
      if (result.balance <= 0) {
        setStatus('這張禮物卡已用完，請移除或改用其他代碼。');
      } else {
        card = { code, balance: result.balance };
        setStatus(`可用餘額 NT$ ${result.balance} 元・無使用期限`);
      }
    } catch (error) {
      if (currentRevision === revision) setStatus(error.message);
    } finally {
      apply.disabled = false;
      onChange();
    }
  });
}
