// Минимальный общий слой для тестового фронта. Без зависимостей.
// API на том же origin (фронт раздаётся тем же Nest по /test).
const API_BASE = '';

function getToken() { return localStorage.getItem('token'); }
function setToken(t) { localStorage.setItem('token', t); }
function clearToken() { localStorage.removeItem('token'); }
function getUser() { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } }
function setUser(u) { localStorage.setItem('user', JSON.stringify(u || null)); }

async function api(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  const t = getToken();
  if (t) headers['Authorization'] = 'Bearer ' + t;
  const res = await fetch(API_BASE + path, Object.assign({}, opts, { headers }));
  let body = null;
  try { body = await res.json(); } catch { /* пустой ответ */ }
  if (res.status === 401) {
    clearToken();
    if (!location.pathname.endsWith('login.html')) location.href = 'login.html';
  }
  if (!res.ok) {
    const msg = (body && (body.message || JSON.stringify(body))) || res.statusText;
    const err = new Error(Array.isArray(msg) ? msg.join(', ') : msg);
    err.status = res.status; err.body = body;
    throw err;
  }
  return body;
}

function requireAuth() { if (!getToken()) location.href = 'login.html'; }
function logout() { clearToken(); setUser(null); location.href = 'login.html'; }

function renderNav() {
  const u = getUser();
  const el = document.getElementById('nav');
  if (!el) return;
  if (getToken()) {
    el.innerHTML =
      '<a href="index.html">Поиск</a> · ' +
      '<a href="cart.html">Корзина</a> · ' +
      '<a href="orders.html">Заказы</a> · ' +
      '<span class="muted">' + (u ? (u.email || '') : '') + '</span> · ' +
      '<a href="#" onclick="logout();return false">Выйти</a>';
  } else {
    el.innerHTML = '<a href="login.html">Вход</a> · <a href="register.html">Регистрация</a>';
  }
}

function showMsg(id, text, kind) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || '';
  el.className = 'msg ' + (kind || '');
}

function money(n) { return (Number(n) || 0).toLocaleString('ru-RU') + ' ₸'; }

document.addEventListener('DOMContentLoaded', renderNav);
