import cv2
import numpy as np
import mediapipe as mp
import math
import datetime
import os
import urllib.request
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python.vision import HandLandmarkerOptions, HandLandmarker

# ─── Download Model ────────────────────────────────────────────────────────────
MODEL_PATH = 'hand_landmarker.task'
if not os.path.exists(MODEL_PATH):
    print('[Air Pen] Downloading hand landmarker model...')
    urllib.request.urlretrieve(
        'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        MODEL_PATH
    )
    print('[Air Pen] Model downloaded!')

# ─── MediaPipe Setup ──────────────────────────────────────────────────────────
base_options  = mp_python.BaseOptions(model_asset_path=MODEL_PATH)
hand_options  = HandLandmarkerOptions(
    base_options=base_options,
    num_hands=1,
    min_hand_detection_confidence=0.7,
    min_tracking_confidence=0.6
)
hand_detector = HandLandmarker.create_from_options(hand_options)

# ─── Constants ────────────────────────────────────────────────────────────────
COLORS = [
    (60,  20,  220),   # Red     (BGR)
    (20, 150, 255),    # Orange
    (20, 230, 255),    # Yellow
    (80, 200,  80),    # Green
    (255, 200,  0),    # Teal/Cyan (default)
    (255, 100, 40),    # Blue
    (200,  50, 160),   # Purple
    (255, 255, 255),   # White
]
COLOR_NAMES = ['Red','Orange','Yellow','Green','Cyan','Blue','Purple','White']
SIDEBAR_W   = 90
PILL_H      = 36
CAM_W, CAM_H = 1280, 720

# ─── State ────────────────────────────────────────────────────────────────────
selected_color_idx = 4           # Cyan default
brush_size         = 8
glow_size          = 20
current_gesture    = 'SHOW HAND'
is_drawing         = False
last_x = last_y    = None
smooth_x = smooth_y = None
prev_mid_x = prev_mid_y = None
SMOOTH             = 0.25

undo_history       = []
particles          = []
show_camera        = True

# Slider drag state
dragging_slider    = None   # 'size' or 'glow'

# ─── Particle System ──────────────────────────────────────────────────────────
class Particle:
    def __init__(self, x, y, color):
        angle = np.random.uniform(0, 2 * math.pi)
        speed = np.random.uniform(0.3, 1.8)
        self.x     = x + np.random.uniform(-6, 6)
        self.y     = y + np.random.uniform(-6, 6)
        self.vx    = math.cos(angle) * speed
        self.vy    = math.sin(angle) * speed - 0.3
        self.alpha = 0.8
        self.decay = np.random.uniform(0.015, 0.04)
        self.size  = np.random.uniform(1.5, 4.5)
        self.color = (255, 255, 255) if np.random.random() > 0.4 else color

    def update(self):
        self.x     += self.vx
        self.y     += self.vy
        self.alpha -= self.decay
        self.size  *= 0.96

    @property
    def alive(self):
        return self.alpha > 0 and self.size > 0.3


def spawn_particles(x, y, px, py, color):
    steps = 4
    count = max(2, int(brush_size * 0.5))
    for s in range(steps):
        t  = s / steps
        sx = int(px + (x - px) * t)
        sy = int(py + (y - py) * t)
        for _ in range(count):
            if len(particles) < 500:
                particles.append(Particle(sx, sy, color))


def draw_particles(overlay):
    """Draw all particles onto a blank overlay using additive blending."""
    for p in particles:
        if not p.alive:
            continue
        r = max(1, int(p.size))
        cx, cy = int(p.x), int(p.y)
        if 0 <= cx < overlay.shape[1] and 0 <= cy < overlay.shape[0]:
            alpha = min(1.0, p.alpha)
            col   = tuple(int(c * alpha) for c in p.color)
            cv2.circle(overlay, (cx, cy), r, col, -1, cv2.LINE_AA)


# ─── Neon Stroke ──────────────────────────────────────────────────────────────
def draw_neon_stroke(canvas, x1, y1, x2, y2, color, bsize, gsize):
    """3-layer neon: outer glow + colored tube + white core using blur."""
    # We draw onto a temp black layer then add to canvas
    h, w = canvas.shape[:2]
    stroke_layer = np.zeros((h, w, 3), dtype=np.uint8)

    # Outer wide colored line
    cv2.line(stroke_layer, (x1,y1), (x2,y2), color, max(1, bsize*3), cv2.LINE_AA)
    # Blur it heavily for glow
    blurred = cv2.GaussianBlur(stroke_layer, (0, 0), gsize * 0.6)

    # Medium neon tube
    cv2.line(stroke_layer, (x1,y1), (x2,y2), color, max(1, bsize), cv2.LINE_AA)
    # Thin white hot core
    white_core = np.zeros((h, w, 3), dtype=np.uint8)
    cv2.line(white_core, (x1,y1), (x2,y2), (255,255,255), max(1, max(1, bsize//5)), cv2.LINE_AA)

    # Composite: canvas + glow + tube + core
    cv2.add(canvas, blurred, canvas)
    cv2.add(canvas, stroke_layer, canvas)
    cv2.add(canvas, white_core, canvas)


# ─── Undo Stack ───────────────────────────────────────────────────────────────
draw_canvas = np.zeros((CAM_H, CAM_W, 3), dtype=np.uint8)

def save_state():
    if len(undo_history) >= 20:
        undo_history.pop(0)
    undo_history.append(draw_canvas.copy())

save_state()


# ─── Sidebar Layout ──────────────────────────────────────────────────────────
SIDEBAR_COLOR_Y0   = 120
SIDEBAR_COLOR_STEP = 44
SLIDER_SIZE_Y      = 490
SLIDER_GLOW_Y      = 560
BTN_UNDO_Y         = 610
BTN_CLEAR_Y        = 642
BTN_SAVE_Y         = 674
BTN_CAM_Y          = 706
BTN_QUIT_Y         = 738
SLIDER_X0          = 18   # left x of slider bar
SLIDER_X1          = 72   # right x of slider bar


def get_color_circle_center(idx):
    return (SIDEBAR_W // 2, SIDEBAR_COLOR_Y0 + idx * SIDEBAR_COLOR_STEP)


def draw_sidebar(frame, gesture):
    h, w = frame.shape[:2]
    # Dark translucent sidebar background
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (SIDEBAR_W, h), (12, 12, 20), -1)
    cv2.addWeighted(overlay, 0.82, frame, 0.18, 0, frame)
    # Sidebar border line
    cv2.line(frame, (SIDEBAR_W, 0), (SIDEBAR_W, h), (50, 50, 60), 1)

    # Brand icon text
    cv2.putText(frame, "AIR", (14, 32), cv2.FONT_HERSHEY_DUPLEX, 0.6, (0, 200, 255), 1, cv2.LINE_AA)
    cv2.putText(frame, "PEN", (14, 52), cv2.FONT_HERSHEY_DUPLEX, 0.6, (0, 200, 255), 1, cv2.LINE_AA)
    cv2.line(frame, (10, 62), (SIDEBAR_W-10, 62), (50,50,60), 1)

    # Label
    cv2.putText(frame, "COLOR", (8, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.28, (120,120,140), 1, cv2.LINE_AA)

    # Color circles
    for i, col in enumerate(COLORS):
        cx, cy = get_color_circle_center(i)
        r = 13 if i != selected_color_idx else 15
        # Draw circle filled
        cv2.circle(frame, (cx, cy), r, col, -1, cv2.LINE_AA)
        if i == selected_color_idx:
            # White ring for active
            cv2.circle(frame, (cx, cy), r + 3, (255, 255, 255), 2, cv2.LINE_AA)
            # Glow ring
            glow_layer = frame.copy()
            cv2.circle(glow_layer, (cx, cy), r + 6, col, 3, cv2.LINE_AA)
            cv2.addWeighted(glow_layer, 0.5, frame, 0.5, 0, frame)

    cv2.line(frame, (10, 460), (SIDEBAR_W-10, 460), (50,50,60), 1)

    # Sliders
    def draw_slider(label, y, val, vmin, vmax):
        cv2.putText(frame, label, (8, y - 22), cv2.FONT_HERSHEY_SIMPLEX, 0.28, (120,120,140), 1, cv2.LINE_AA)
        cv2.putText(frame, str(val), (8, y - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.3, (200,200,220), 1, cv2.LINE_AA)
        # Track
        cv2.line(frame, (SLIDER_X0, y), (SLIDER_X1, y), (60,60,70), 3, cv2.LINE_AA)
        # Fill
        fill_x = int(SLIDER_X0 + (val - vmin) / (vmax - vmin) * (SLIDER_X1 - SLIDER_X0))
        cv2.line(frame, (SLIDER_X0, y), (fill_x, y), (0, 200, 255), 3, cv2.LINE_AA)
        # Thumb
        cv2.circle(frame, (fill_x, y), 6, (0, 200, 255), -1, cv2.LINE_AA)
        cv2.circle(frame, (fill_x, y), 6, (255, 255, 255), 2, cv2.LINE_AA)

    draw_slider("SIZE", SLIDER_SIZE_Y, brush_size, 2, 40)
    draw_slider("GLOW", SLIDER_GLOW_Y, glow_size, 5, 80)

    cv2.line(frame, (10, 600), (SIDEBAR_W-10, 600), (50,50,60), 1)

    # Action buttons
    def draw_btn(label, y, icon=""):
        bx0, bx1 = 8, SIDEBAR_W - 8
        by0, by1 = y, y + 28
        cv2.rectangle(frame, (bx0, by0), (bx1, by1), (35, 35, 50), -1, cv2.LINE_AA)
        cv2.rectangle(frame, (bx0, by0), (bx1, by1), (70, 70, 90), 1, cv2.LINE_AA)
        cv2.putText(frame, label, (bx0 + 5, by0 + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.33, (200,200,220), 1, cv2.LINE_AA)

    draw_btn("UNDO",  BTN_UNDO_Y)
    draw_btn("CLEAR", BTN_CLEAR_Y)
    draw_btn("SAVE",  BTN_SAVE_Y)
    draw_btn("CAM",   BTN_CAM_Y)
    # Quit button — slightly red tint
    bx0, bx1 = 8, SIDEBAR_W - 8
    cv2.rectangle(frame, (bx0, BTN_QUIT_Y), (bx1, BTN_QUIT_Y + 28), (40, 30, 80), -1, cv2.LINE_AA)
    cv2.rectangle(frame, (bx0, BTN_QUIT_Y), (bx1, BTN_QUIT_Y + 28), (80, 60, 160), 1, cv2.LINE_AA)
    cv2.putText(frame, "QUIT", (bx0 + 8, BTN_QUIT_Y + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.33, (140, 100, 255), 1, cv2.LINE_AA)

    # Gesture pill at bottom center
    pill_text_map = {
        'SHOW HAND': ('SHOW HAND', (40,  180, 220)),
        'DRAW':      ('DRAWING',   (40,  200,  80)),
        'ERASE':     ('ERASING',   (60,  80,  220)),
        'PAUSE':     ('PAUSED',    (80,  100, 100)),
        'FIST':      ('PAUSED',    (80,  100, 100)),
    }
    label, pill_col = pill_text_map.get(gesture, ('...', (60,60,60)))
    text_size, _ = cv2.getTextSize(f"  {label}  ", cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
    pill_w = text_size[0] + 20
    px = w // 2 - pill_w // 2
    py = h - 20 - PILL_H
    cv2.rectangle(frame, (px, py), (px + pill_w, py + PILL_H), pill_col, -1, cv2.LINE_AA)
    cv2.rectangle(frame, (px, py), (px + pill_w, py + PILL_H), (255,255,255), 1, cv2.LINE_AA)
    cv2.putText(frame, label, (px + 10, py + 24), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (20,20,20), 2, cv2.LINE_AA)


# ─── Landmark Helpers ──────────────────────────────────────────────────────────
def lm_dist(a, b):
    return math.hypot(a.x - b.x, a.y - b.y)

def is_extended(tip, mid, wrist):
    return lm_dist(tip, wrist) > lm_dist(mid, wrist) * 1.2

def recognize_gesture(lm):
    wrist  = lm[0]
    pinch_d = lm_dist(lm[4], lm[8])
    ext = [
        is_extended(lm[8],  lm[6],  wrist),
        is_extended(lm[12], lm[10], wrist),
        is_extended(lm[16], lm[14], wrist),
        is_extended(lm[20], lm[18], wrist),
    ]
    ext_count = sum(ext)
    if pinch_d < 0.07:   return 'PAUSE'
    if ext_count == 4:   return 'ERASE'
    if ext[0] and ext_count == 1: return 'DRAW'
    if ext_count == 0:   return 'FIST'
    return 'PAUSE'


# ─── Mouse Callback ────────────────────────────────────────────────────────────
app_running = True   # Controlled only by mouse QUIT button

def on_mouse(event, x, y, flags, param):
    global selected_color_idx, brush_size, glow_size, dragging_slider, show_camera, app_running

    if x > SIDEBAR_W:
        return   # Only care about sidebar clicks

    # Color circles
    if event == cv2.EVENT_LBUTTONDOWN:
        for i in range(len(COLORS)):
            cx, cy = get_color_circle_center(i)
            if math.hypot(x - cx, y - cy) < 18:
                selected_color_idx = i
                return

        # Slider interaction
        if abs(y - SLIDER_SIZE_Y) < 15:
            dragging_slider = 'size'
        elif abs(y - SLIDER_GLOW_Y) < 15:
            dragging_slider = 'glow'

        # Buttons
        def in_btn(by):
            return by <= y <= by + 28 and 8 <= x <= SIDEBAR_W - 8

        if in_btn(BTN_UNDO_Y):
            if len(undo_history) > 1:
                undo_history.pop()
                draw_canvas[:] = undo_history[-1]
            else:
                draw_canvas[:] = 0
        elif in_btn(BTN_CLEAR_Y):
            draw_canvas[:] = 0
            particles.clear()
            save_state()
        elif in_btn(BTN_SAVE_Y):
            fname = f"air_pen_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
            cv2.imwrite(fname, draw_canvas)
            print(f"[Air Pen] Saved: {fname}")
        elif in_btn(BTN_CAM_Y):
            show_camera = not show_camera
        elif in_btn(BTN_QUIT_Y):
            app_running = False

    elif event == cv2.EVENT_MOUSEMOVE and dragging_slider:
        ratio = max(0.0, min(1.0, (x - SLIDER_X0) / (SLIDER_X1 - SLIDER_X0)))
        if dragging_slider == 'size':
            brush_size = int(2 + ratio * 38)
        elif dragging_slider == 'glow':
            glow_size = int(5 + ratio * 75)

    elif event == cv2.EVENT_LBUTTONUP:
        dragging_slider = None


# ─── Main Loop ────────────────────────────────────────────────────────────────
def main():
    global current_gesture, is_drawing, last_x, last_y
    global smooth_x, smooth_y, prev_mid_x, prev_mid_y

    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAM_W)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAM_H)

    win = "Air Pen"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    cv2.setMouseCallback(win, on_mouse)

    print("[Air Pen] Starting... Use the sidebar to control everything.")

    while app_running:
        ret, frame = cap.read()
        if not ret:
            break

        frame = cv2.flip(frame, 1)   # Mirror camera
        h, w = frame.shape[:2]

        # Resize draw canvas if needed
        if draw_canvas.shape[:2] != (h, w):
            draw_canvas.resize((h, w, 3), refcheck=False)

        # ── Hand Detection ───────────────────────────────────────────────────
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        det_result = hand_detector.detect(mp_image)

        tip_x = tip_y = None
        gesture = 'SHOW HAND'

        if det_result.hand_landmarks:
            lm = det_result.hand_landmarks[0]
            gesture = recognize_gesture(lm)

            # Tip landmark: index tip (8) for draw/pause, palm base (9) for erase
            tip_lm = lm[9] if gesture == 'ERASE' else lm[8]
            raw_x  = int(tip_lm.x * w)
            raw_y  = int(tip_lm.y * h)

            # Exponential smoothing
            if smooth_x is None:
                smooth_x, smooth_y = raw_x, raw_y
            smooth_x += (raw_x - smooth_x) * SMOOTH
            smooth_y += (raw_y - smooth_y) * SMOOTH
            tip_x, tip_y = int(smooth_x), int(smooth_y)

        else:
            smooth_x = smooth_y = None
            is_drawing = False
            last_x = last_y = None
            prev_mid_x = prev_mid_y = None

        # ── Gesture state transitions ─────────────────────────────────────────
        if gesture != current_gesture:
            if current_gesture == 'DRAW' and gesture != 'DRAW':
                save_state()
            if gesture != 'DRAW':
                is_drawing = False
                last_x = last_y = None
                prev_mid_x = prev_mid_y = None
            current_gesture = gesture

        # ── Drawing ───────────────────────────────────────────────────────────
        col = COLORS[selected_color_idx]

        if gesture == 'DRAW' and tip_x is not None:
            if not is_drawing:
                last_x, last_y = tip_x, tip_y
                prev_mid_x = prev_mid_y = None
                is_drawing = True

            # Midpoint Bézier smoothing
            mid_x = (last_x + tip_x) // 2
            mid_y = (last_y + tip_y) // 2

            if prev_mid_x is not None:
                draw_neon_stroke(draw_canvas, prev_mid_x, prev_mid_y, mid_x, mid_y, col, brush_size, glow_size)
                spawn_particles(mid_x, mid_y, prev_mid_x, prev_mid_y, col)

            prev_mid_x, prev_mid_y = mid_x, mid_y
            last_x, last_y = tip_x, tip_y

        elif gesture == 'ERASE' and tip_x is not None:
            is_drawing = False
            last_x = last_y = None
            prev_mid_x = prev_mid_y = None
            cv2.circle(draw_canvas, (tip_x, tip_y), brush_size * 6, (0,0,0), -1, cv2.LINE_AA)

        else:
            if gesture not in ('DRAW', 'ERASE'):
                is_drawing = False
                last_x = last_y = None
                prev_mid_x = prev_mid_y = None

        # ── Update Particles ─────────────────────────────────────────────────
        particle_overlay = np.zeros_like(frame)
        to_remove = []
        for i, p in enumerate(particles):
            p.update()
            if not p.alive:
                to_remove.append(i)
            else:
                draw_particles(particle_overlay)
                break   # drawn below

        # Redraw after removing dead
        for i in reversed(to_remove):
            particles.pop(i)

        particle_layer = np.zeros((h, w, 3), dtype=np.uint8)
        for p in particles:
            if p.alive:
                r  = max(1, int(p.size))
                cx = int(p.x); cy = int(p.y)
                if 0 <= cx < w and 0 <= cy < h:
                    a  = min(1.0, p.alpha)
                    fc = tuple(int(c * a) for c in p.color)
                    cv2.circle(particle_layer, (cx, cy), r, fc, -1, cv2.LINE_AA)

        # ── Composite Final Frame ─────────────────────────────────────────────
        # Base: camera or black
        if show_camera:
            output = frame.copy()
        else:
            output = np.zeros_like(frame)

        # Add drawing layer
        cv2.add(output, draw_canvas, output)

        # Add particles (additive blend)
        cv2.add(output, particle_layer, output)

        # ── Overlay: Yellow tracker circle ────────────────────────────────────
        if tip_x is not None and gesture != 'ERASE':
            # Outer glow ring
            cv2.circle(output, (tip_x, tip_y), 12, (0, 220, 255), 2, cv2.LINE_AA)
            # Inner white dot
            cv2.circle(output, (tip_x, tip_y), 4, (255, 255, 255), -1, cv2.LINE_AA)
        elif tip_x is not None and gesture == 'ERASE':
            cv2.circle(output, (tip_x, tip_y), brush_size * 6, (0, 220, 255), 2, cv2.LINE_AA)

        # ── Sidebar ────────────────────────────────────────────────────────────
        draw_sidebar(output, gesture)

        # ── Show ───────────────────────────────────────────────────────────────
        cv2.imshow(win, output)

        cv2.waitKey(1)  # Keep window responsive — no keyboard shortcuts

    cap.release()
    cv2.destroyAllWindows()


if __name__ == '__main__':
    main()
