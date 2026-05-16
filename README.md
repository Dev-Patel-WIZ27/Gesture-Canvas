# ✋ Gesture Canvas — Air Pen

> Draw in the air with your finger using AI-powered hand tracking. No stylus, no touch screen — just your hand and a camera.

![Air Pen Demo](https://img.shields.io/badge/MediaPipe-Hand%20Tracking-blue?style=flat-square) ![Python](https://img.shields.io/badge/Python-3.8%2B-yellow?style=flat-square) ![OpenCV](https://img.shields.io/badge/OpenCV-4.x-green?style=flat-square) ![JavaScript](https://img.shields.io/badge/Web-JavaScript-orange?style=flat-square)

---

## 🎯 What Is This?

**Gesture Canvas (Air Pen)** is a real-time gesture-controlled drawing application that uses your webcam and AI hand tracking to let you paint, write, and draw — purely by moving your finger in the air.

It comes in **two versions**:
- 🌐 **Web Version** — runs in the browser using JavaScript + MediaPipe Tasks Vision
- 🐍 **Python Version** — runs as a native desktop window using OpenCV + MediaPipe Tasks API

---

## ✨ Features

- 🖊️ **Neon Pen Effect** — 3-layer rendering: wide glow aura + bright colored tube + white hot core
- ✨ **Sparkle Particles** — Fairy dust particles scatter and fade in real-time as you draw
- 🤚 **AI Hand Tracking** — MediaPipe detects 21 hand landmarks at 60fps
- 🎨 **Color Palette** — 8 vibrant neon colors to choose from
- 📏 **Brush & Glow Sliders** — Adjust brush size and glow intensity on the fly
- ↩️ **Undo Stack** — Up to 20 levels of undo history
- 🗑️ **Eraser Mode** — Open your palm to erase with a large circular eraser
- 💾 **Save Drawing** — Export your artwork as a PNG file
- 📷 **Camera Toggle** — Hide the camera feed to draw on a pure black canvas

---

## 🤌 Gesture Controls

| Gesture | Action |
|---|---|
| ☝️ Index finger up | **Draw** — traces your fingertip in neon |
| ✋ Open palm (all 5 fingers) | **Erase** — palm becomes a circular eraser |
| 🤏 Pinch (thumb + index) | **Pause** — lifts the pen, no drawing |
| ✊ Fist | **Pause** — stops drawing |

---

## 🌐 Web Version

### Run Locally
```bash
# Navigate to the project folder
cd Gesture-Canvas

# Start a local HTTP server
python -m http.server 8000

# Open in browser
# http://localhost:8000
```

### Tech Stack
- **MediaPipe Tasks Vision** (CDN) — Hand landmark detection
- **HTML5 Canvas** — Drawing layer + overlay layer
- **Vanilla JavaScript** — No frameworks
- **CSS Glassmorphism** — Translucent left sidebar UI

---

## 🐍 Python Version

### Install Dependencies
```bash
pip install mediapipe opencv-python numpy
```

### Run
```bash
python air_pen.py
```

> The app will automatically download the MediaPipe hand landmarker model (~10MB) on first run.

### Mouse Controls (Sidebar)
| Button | Action |
|---|---|
| 🎨 Color Circles | Click to select drawing color |
| SIZE Slider | Drag to adjust brush thickness |
| GLOW Slider | Drag to adjust neon glow intensity |
| UNDO | Undo last stroke |
| CLEAR | Clear the entire canvas |
| SAVE | Save drawing as timestamped PNG |
| CAM | Toggle camera feed on/off |

### Tech Stack
- **MediaPipe Tasks API** — Hand landmark detection
- **OpenCV (cv2)** — Camera capture, canvas rendering, window display
- **NumPy** — Pixel-level canvas operations

---

## 📁 Project Structure

```
Gesture-Canvas/
├── index.html          # Web app entry point
├── style.css           # UI styling (glassmorphic sidebar, pill badge)
├── app.js              # Web app logic (MediaPipe, drawing, particles)
├── air_pen.py          # Python desktop app
├── requirements.txt    # Python dependencies
└── README.md
```

---

## 🚀 How the Neon Effect Works

The pen stroke is rendered in **3 layers** composited together:

1. **Outer Aura** — A wide, low-opacity colored stroke blurred with Gaussian blur
2. **Neon Tube** — A bright, full-opacity colored line at normal brush width
3. **White Core** — A thin pure-white line at the center for the "hot wire" look

The sparkle particles are **glowing orbs** using additive blending (`lighter` in Canvas / `cv2.add` in Python), which makes overlapping particles burn brighter — mimicking real light physics.

---

## 📸 Credits

Built with ❤️ using [MediaPipe](https://mediapipe.dev/) hand tracking and inspired by real-time gesture drawing demos.
