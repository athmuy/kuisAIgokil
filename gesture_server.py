"""
gesture_server.py
─────────────────────────────────────────
Deteksi gestur tangan via MediaPipe Pose,
lalu stream hasilnya ke browser lewat WebSocket.

Install dulu:
  pip install opencv-python mediapipe websockets

Jalankan:
  python gesture_server.py

Biarkan jendela cv2 terbuka selama main kuis.
"""

import asyncio
import json
import time
import cv2
import mediapipe as mp
import websockets

# ── Konfigurasi ──────────────────────────────────────────────────
HOST = "localhost"
PORT = 8765
HOLD_SECONDS = 1.5          # harus sama dengan HOLD_DURATION di JS (1500 ms)
VISIBILITY_THRESHOLD = 0.5  # seberapa yakin MediaPipe melihat titik tubuh
RAISE_THRESHOLD = 0.10      # seberapa jauh pergelangan harus di atas bahu (satuan: rasio tinggi frame)

# ── MediaPipe ────────────────────────────────────────────────────
mp_pose = mp.solutions.pose
mp_draw = mp.solutions.drawing_utils
pose    = mp_pose.Pose(min_detection_confidence=0.7, min_tracking_confidence=0.7)

# ── State kamera ─────────────────────────────────────────────────
cap = cv2.VideoCapture(0)

# ── Daftar client WebSocket yang sedang terhubung ────────────────
clients: set = set()


def detect_gesture(landmarks) -> tuple[str, float, float, float]:
    """
    Kembalikan (gesture, conf_left, conf_right, conf_neutral).
    gesture = 'left' | 'right' | 'neutral'

    Logika:
      • Tangan KIRI dianggap diangkat jika LEFT_WRIST lebih tinggi
        (y lebih kecil) dari LEFT_SHOULDER sebesar >= RAISE_THRESHOLD.
      • Begitu pula untuk tangan KANAN.
      • Jika keduanya diangkat, pilih yang lebih tinggi.
    """
    lm = landmarks.landmark

    # Ambil landmark yang dibutuhkan
    l_shoulder = lm[mp_pose.PoseLandmark.LEFT_SHOULDER]
    r_shoulder = lm[mp_pose.PoseLandmark.RIGHT_SHOULDER]
    l_wrist    = lm[mp_pose.PoseLandmark.LEFT_WRIST]
    r_wrist    = lm[mp_pose.PoseLandmark.RIGHT_WRIST]

    # Hitung seberapa jauh pergelangan di atas bahu (negatif = lebih tinggi di frame)
    left_raise  = (l_shoulder.y - l_wrist.y) if l_wrist.visibility  > VISIBILITY_THRESHOLD else -999
    right_raise = (r_shoulder.y - r_wrist.y) if r_wrist.visibility > VISIBILITY_THRESHOLD else -999

    left_detected  = left_raise  >= RAISE_THRESHOLD
    right_detected = right_raise >= RAISE_THRESHOLD

    # Confidence dikira dari seberapa jauh tangan terangkat (di-clamp 0–1)
    conf_left  = min(max(left_raise  / 0.5, 0.0), 1.0) if left_detected  else 0.0
    conf_right = min(max(right_raise / 0.5, 0.0), 1.0) if right_detected else 0.0

    if left_detected and right_detected:
        # Ambil yang lebih tinggi
        if left_raise >= right_raise:
            conf_right = 0.0
            return "left", conf_left, 0.0, 0.0
        else:
            conf_left = 0.0
            return "right", 0.0, conf_right, 0.0

    if left_detected:
        return "left", conf_left, 0.0, 0.0

    if right_detected:
        return "right", 0.0, conf_right, 0.0

    return "neutral", 0.0, 0.0, 1.0


async def broadcast(message: str):
    """Kirim pesan ke semua client yang terhubung."""
    if clients:
        await asyncio.gather(*(c.send(message) for c in clients), return_exceptions=True)


async def websocket_handler(ws):
    """Tangani koneksi WebSocket baru."""
    clients.add(ws)
    print(f"[WS] Client terhubung. Total: {len(clients)}")
    try:
        await ws.wait_closed()
    finally:
        clients.discard(ws)
        print(f"[WS] Client terputus. Total: {len(clients)}")


async def camera_loop():
    """Loop utama: baca kamera, deteksi pose, broadcast ke browser."""
    prev_gesture   = "neutral"
    gesture_text   = "Standby"

    while True:
        success, frame = cap.read()
        if not success:
            await asyncio.sleep(0.01)
            continue

        frame     = cv2.flip(frame, 1)
        h, w, _   = frame.shape
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result    = pose.process(rgb_frame)

        gesture    = "neutral"
        conf_left  = 0.0
        conf_right = 0.0
        conf_neut  = 1.0

        if result.pose_landmarks:
            mp_draw.draw_landmarks(frame, result.pose_landmarks, mp_pose.POSE_CONNECTIONS)
            gesture, conf_left, conf_right, conf_neut = detect_gesture(result.pose_landmarks)

        # Kirim ke browser
        payload = json.dumps({
            "gesture":      gesture,
            "conf_left":    round(conf_left,  3),
            "conf_right":   round(conf_right, 3),
            "conf_neutral": round(conf_neut,  3),
        })
        await broadcast(payload)

        # ── Overlay teks di jendela cv2 ──────────────────────────
        if gesture == "left":
            gesture_text = "<- KIRI"
            color = (255, 120, 0)
        elif gesture == "right":
            gesture_text = "KANAN ->"
            color = (0, 100, 255)
        else:
            gesture_text = "Standby"
            color = (180, 180, 180)

        cv2.putText(frame, gesture_text,
                    (30, 60), cv2.FONT_HERSHEY_DUPLEX, 1.2, color, 2, cv2.LINE_AA)
        cv2.putText(frame, f"Clients: {len(clients)}",
                    (30, h - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)
        cv2.putText(frame, f"WS: ws://{HOST}:{PORT}",
                    (30, h - 45), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)

        cv2.imshow("HandStrike - Gesture Server", frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

        # ~30 fps
        await asyncio.sleep(0.033)

    cap.release()
    cv2.destroyAllWindows()


async def main():
    print(f"[SERVER] WebSocket berjalan di ws://{HOST}:{PORT}")
    print("[SERVER] Tekan 'q' di jendela kamera untuk berhenti.\n")

    async with websockets.serve(websocket_handler, HOST, PORT):
        await camera_loop()


if __name__ == "__main__":
    asyncio.run(main())
