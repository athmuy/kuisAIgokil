/* ═══════════════════════════════════════
   app.js — MODE PYTHON (WebSocket)
   Gestur dideteksi oleh gesture_server.py
   Browser hanya terima hasil via WebSocket
═══════════════════════════════════════ */

const HOLD_DURATION        = 1500;
const CONFIDENCE_THRESHOLD = 0.75;
const WS_URL               = "ws://localhost:8765";

let ws             = null;
let isCameraMode   = false;
let currentQ       = 0;
let score          = 0;
let correctCount   = 0;
let gameStartTime  = null;
let currentGesture = null;
let holdStartTime  = null;
let isAnswering    = false;

// ── Navigasi layar ───────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
}

// ── Keyboard fallback ────────────────────────────────────────────
function skipToGame() {
  isCameraMode = false;
  document.querySelector('.cam-panel').style.opacity       = '0.5';
  document.querySelector('.cam-panel').style.pointerEvents = 'none';
  showScreen('game');
  loadQuestion(0);
  gameStartTime = Date.now();
  document.addEventListener('keydown', keyboardFallback);
}

function keyboardFallback(e) {
  if (isAnswering) return;
  if (e.key === 'ArrowLeft')  submitAnswer('left');
  if (e.key === 'ArrowRight') submitAnswer('right');
}

// ── Setup: koneksi WebSocket ke gesture_server.py ────────────────
function loadModel() {
  setStatus('loading', '<span class="spinner"></span> Menghubungkan ke Python server...');

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    isCameraMode = true;
    setStatus('success', '✅ Terhubung! Kamera dikelola Python. 3 detik lagi...');
    setTimeout(() => startCountdown(), 800);
  };

  ws.onerror = () => {
    setStatus('error',
      '❌ Tidak bisa terhubung ke <b>ws://localhost:8765</b>.<br>' +
      'Jalankan dulu di terminal:<br>' +
      '<code style="background:#fee2e2;padding:2px 8px;border-radius:4px;">' +
      'python gesture_server.py</code>'
    );
  };

  ws.onclose = () => {
    console.warn("WebSocket tertutup.");
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      // { gesture, conf_left, conf_right, conf_neutral }
      updateBars(data.conf_left, data.conf_right, data.conf_neutral);
      processGesture(data.conf_left, data.conf_right);
    } catch(e) {
      console.error("WS parse error:", e);
    }
  };
}

function setStatus(type, html) {
  const el = document.getElementById('setup-status');
  el.className = 'setup-status ' + type;
  el.innerHTML = html;
}

// ── Countdown ────────────────────────────────────────────────────
function startCountdown() {
  const overlay = document.getElementById('countdown-overlay');
  const numEl   = document.getElementById('countdown-num');
  overlay.style.display = 'flex';
  let count = 3;
  numEl.textContent = count;
  const iv = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(iv);
      overlay.style.display = 'none';
      showScreen('game');
      loadQuestion(0);
      gameStartTime = Date.now();
    } else {
      numEl.style.animation = 'none';
      void numEl.offsetWidth;
      numEl.style.animation = 'countPop 0.5s cubic-bezier(0.34,1.56,0.64,1)';
      numEl.textContent = count;
    }
  }, 1000);
}

// ── Bar confidence ────────────────────────────────────────────────
function updateBars(l, r, n) {
  document.getElementById('bar-left').style.width    = (l * 100) + '%';
  document.getElementById('bar-right').style.width   = (r * 100) + '%';
  document.getElementById('bar-neutral').style.width = (n * 100) + '%';
  document.getElementById('pct-left').textContent    = Math.round(l * 100) + '%';
  document.getElementById('pct-right').textContent   = Math.round(r * 100) + '%';
  document.getElementById('pct-neutral').textContent = Math.round(n * 100) + '%';
}

// ── Proses gestur dari data WebSocket ────────────────────────────
function processGesture(leftConf, rightConf) {
  if (isAnswering) return;

  let detected = null;
  if      (leftConf  > CONFIDENCE_THRESHOLD && leftConf  > rightConf) detected = 'left';
  else if (rightConf > CONFIDENCE_THRESHOLD && rightConf > leftConf)  detected = 'right';

  const gestureEl = document.getElementById('gesture-value');
  const holdBar   = document.getElementById('hold-bar');

  if (detected) {
    gestureEl.textContent = detected === 'left' ? '← Kiri' : 'Kanan →';
    gestureEl.className   = 'gesture-value ' + detected;
    document.getElementById('choice-left').classList.toggle('active',  detected === 'left');
    document.getElementById('choice-right').classList.toggle('active', detected === 'right');

    if (detected !== currentGesture) {
      currentGesture = detected;
      holdStartTime  = Date.now();
    } else {
      const progress = Math.min((Date.now() - holdStartTime) / HOLD_DURATION, 1);
      holdBar.style.width = (progress * 100) + '%';
      if (progress >= 1) {
        holdBar.style.width = '0%';
        submitAnswer(detected);
      }
    }
  } else {
    gestureEl.textContent = '—';
    gestureEl.className   = 'gesture-value neutral';
    currentGesture  = null;
    holdStartTime   = null;
    holdBar.style.width = '0%';
    document.getElementById('choice-left').classList.remove('active');
    document.getElementById('choice-right').classList.remove('active');
  }
}

// ── Quiz logic ────────────────────────────────────────────────────
function loadQuestion(index) {
  if (index >= QUIZ_DATA.length) return endGame();
  currentQ       = index;
  isAnswering    = false;
  currentGesture = null;
  holdStartTime  = null;
  document.getElementById('hold-bar').style.width   = '0%';
  document.getElementById('choice-left').className  = 'choice-card left';
  document.getElementById('choice-right').className = 'choice-card right';
  const q = QUIZ_DATA[index];
  document.getElementById('q-number').textContent          = 'Pertanyaan ' + (index + 1);
  document.getElementById('q-text').textContent            = q.question;
  document.getElementById('choice-left-text').textContent  = q.left;
  document.getElementById('choice-right-text').textContent = q.right;
  const pct = ((index + 1) / QUIZ_DATA.length) * 100;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-text').textContent = (index + 1) + ' / ' + QUIZ_DATA.length;
}

function submitAnswer(side) {
  if (isAnswering) return;
  isAnswering = true;
  const q         = QUIZ_DATA[currentQ];
  const isCorrect = side === q.correct;
  if (isCorrect) {
    score += 10;
    correctCount++;
    document.getElementById('score-display').textContent = score;
  }
  document.getElementById('choice-' + q.correct).classList.add('correct');
  if (!isCorrect) {
    document.getElementById('choice-' + (q.correct === 'left' ? 'right' : 'left')).classList.add('wrong');
  }
  showFeedback(isCorrect);
  setTimeout(() => {
    hideFeedback();
    loadQuestion(currentQ + 1);
  }, 1500);
}

function showFeedback(isCorrect) {
  const bubble = document.getElementById('feedback-bubble');
  bubble.textContent = isCorrect ? '✓' : '✗';
  bubble.className   = 'feedback-bubble ' + (isCorrect ? 'correct' : 'wrong');
  document.getElementById('feedback-overlay').classList.add('show');
}
function hideFeedback() {
  document.getElementById('feedback-overlay').classList.remove('show');
}

function endGame() {
  if (ws) ws.close();
  document.removeEventListener('keydown', keyboardFallback);
  const total   = QUIZ_DATA.length;
  const pct     = Math.round((correctCount / total) * 100);
  const elapsed = Math.round((Date.now() - gameStartTime) / 1000);
  document.getElementById('result-trophy').textContent = pct >= 80 ? '🏆' : pct >= 50 ? '🥈' : '🥉';
  document.getElementById('result-pct').textContent    = pct + '%';
  document.getElementById('result-label').textContent  = `Benar ${correctCount} dari ${total}`;
  document.getElementById('stat-correct').textContent  = correctCount;
  document.getElementById('stat-wrong').textContent    = total - correctCount;
  document.getElementById('stat-time').textContent     =
    `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  showScreen('result');
}

function restartGame() {
  currentQ = 0; score = 0; correctCount = 0; gameStartTime = null;
  currentGesture = null; holdStartTime = null; isAnswering = false;
  document.getElementById('score-display').textContent = '0';
  document.getElementById('hold-bar').style.width = '0%';
  updateBars(0, 0, 0);
  document.getElementById('gesture-value').textContent = '—';
  showScreen('setup');
}
