const HOLD_DURATION      = 1500;   // ms — tahan sebelum jawab
const RAISE_THRESHOLD    = 0.10;   // seberapa jauh pergelangan di atas bahu (0–1)
const VISIBILITY_MIN     = 0.5;    // minimum visibility landmark MediaPipe

let poseDetector  = null;
let camera        = null;
let isCameraMode  = false;
let currentQ      = 0;
let score         = 0;
let correctCount  = 0;
let gameStartTime = null;
let currentGesture  = null;
let holdStartTime   = null;
let isAnswering     = false;

// ── Navigasi layar ───────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
}

// ── Mulai setup: langsung ke game + init MediaPipe ───────────────
function startSetup() {
  showScreen('game');
  initMediaPipe();
}

// ── Keyboard fallback ─────────────────────────────────────────────
function skipToGame() {
  isCameraMode = false;
  document.querySelector('.cam-panel').style.opacity       = '0.5';
  document.querySelector('.cam-panel').style.pointerEvents = 'none';
  showScreen('game');
  document.getElementById('loading-overlay').style.display = 'none';
  loadQuestion(0);
  gameStartTime = Date.now();
  document.addEventListener('keydown', keyboardFallback);
}

function keyboardFallback(e) {
  if (isAnswering) return;
  if (e.key === 'ArrowLeft')  submitAnswer('left');
  if (e.key === 'ArrowRight') submitAnswer('right');
}

// ── Inisialisasi MediaPipe Pose ──────────────────────────────────
function initMediaPipe() {
  setLoadingText('Memuat MediaPipe...');

  const canvas = document.getElementById('webcam-canvas');
  const ctx    = canvas.getContext('2d');
  const video  = document.getElementById('input-video');

  // Buat instance Pose
  poseDetector = new Pose({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
  });

  poseDetector.setOptions({
    modelComplexity:        1,
    smoothLandmarks:        true,
    enableSegmentation:     false,
    minDetectionConfidence: 0.7,
    minTrackingConfidence:  0.7,
  });

  // Callback tiap frame selesai diproses
  poseDetector.onResults((results) => {
    onPoseResults(results, canvas, ctx);
  });

  // Inisialisasi kamera
  setLoadingText('Membuka kamera...');

  camera = new Camera(video, {
    onFrame: async () => {
      await poseDetector.send({ image: video });
    },
    width:  300,
    height: 300,
  });

  camera.start()
    .then(() => {
      isCameraMode = true;
      setLoadingText('Siap! 3 detik lagi...');
      setTimeout(startCountdown, 600);
    })
    .catch((err) => {
      setLoadingText('❌ Kamera gagal: ' + err.message);
      console.error(err);
    });
}

function setLoadingText(txt) {
  const el = document.getElementById('loading-text');
  if (el) el.textContent = txt;
}

function hideLoadingOverlay() {
  const el = document.getElementById('loading-overlay');
  if (el) el.style.display = 'none';
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
      hideLoadingOverlay();
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

// ── Proses hasil MediaPipe per frame ─────────────────────────────
function onPoseResults(results, canvas, ctx) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Gambar frame video (mirror horizontal)
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  if (!results.poseLandmarks) {
    // Tidak ada orang terdeteksi
    updateBars(0, 0, 1);
    processGesture(0, 0);
    return;
  }

  // Gambar skeleton pose
  drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS,
    { color: 'rgba(255,255,255,0.5)', lineWidth: 2 });
  drawLandmarks(ctx, results.poseLandmarks,
    { color: '#a855f7', lineWidth: 1, radius: 3 });

  // ── Deteksi gestur (logika sama dengan kode Python) ───────────
  const lm = results.poseLandmarks;

  // Landmark indices (sama dengan Python mp_pose.PoseLandmark)
  const L_SHOULDER = lm[11];
  const R_SHOULDER = lm[12];
  const L_WRIST    = lm[15];
  const R_WRIST    = lm[16];

  // Seberapa jauh pergelangan di atas bahu (y lebih kecil = lebih tinggi di layar)
  // Karena mirror, kiri/kanan tampak terbalik di layer — tapi landmark tetap sesuai tubuh nyata
  const leftRaise  = (L_WRIST.visibility  > VISIBILITY_MIN)
    ? (L_SHOULDER.y - L_WRIST.y)  : -1;
  const rightRaise = (R_WRIST.visibility > VISIBILITY_MIN)
    ? (R_SHOULDER.y - R_WRIST.y) : -1;

  const leftDetected  = leftRaise  >= RAISE_THRESHOLD;
  const rightDetected = rightRaise >= RAISE_THRESHOLD;

  // Confidence: makin tinggi tangan, makin tinggi conf (clamp 0–1)
  let confLeft    = leftDetected  ? Math.min(leftRaise  / 0.5, 1.0) : 0.0;
  let confRight   = rightDetected ? Math.min(rightRaise / 0.5, 1.0) : 0.0;
  let confNeutral = 1.0;

  if (leftDetected || rightDetected) {
    confNeutral = 0.0;
    // Jika keduanya terangkat, menangkan yang lebih tinggi
    if (leftDetected && rightDetected) {
      if (leftRaise >= rightRaise) confRight = 0;
      else                         confLeft  = 0;
    }
  }

  updateBars(confLeft, confRight, confNeutral);
  processGesture(confLeft, confRight);
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

// ── Hold logic ────────────────────────────────────────────────────
function processGesture(leftConf, rightConf) {
  if (isAnswering) return;

  // Confidence threshold: 0.75 (sama dengan versi Teachable Machine)
  let detected = null;
  if      (leftConf  >= 0.75 && leftConf  > rightConf) detected = 'left';
  else if (rightConf >= 0.75 && rightConf > leftConf)  detected = 'right';

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

// ── Quiz ──────────────────────────────────────────────────────────
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
  if (camera) camera.stop();
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
  // Tampilkan loading overlay lagi
  const lo = document.getElementById('loading-overlay');
  if (lo) { lo.style.display = 'flex'; setLoadingText('Memuat ulang...'); }
  showScreen('game');
  if (isCameraMode && camera) {
    loadQuestion(0);
    gameStartTime = Date.now();
  } else {
    startSetup();
  }
}
