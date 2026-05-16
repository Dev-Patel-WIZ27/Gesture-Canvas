import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.js";

// ─── DOM References ──────────────────────────────────────────────────────────
const video         = document.getElementById('webcam');
const drawCanvas    = document.getElementById('output_canvas');
const drawCtx       = drawCanvas.getContext('2d', { willReadFrequently: true });
const overlayCanvas = document.getElementById('overlay_canvas');
const overlayCtx    = overlayCanvas.getContext('2d');
const startScreen   = document.getElementById('start-screen');
const startBtn      = document.getElementById('start-btn');
const undoBtn       = document.getElementById('undo-btn');
const clearBtn      = document.getElementById('clear-btn');
const saveBtn       = document.getElementById('save-btn');
const cameraBtn     = document.getElementById('camera-btn');
const thicknessSlider = document.getElementById('thickness-slider');
const thicknessVal    = document.getElementById('thickness-val');
const glowSlider      = document.getElementById('glow-slider');
const glowVal         = document.getElementById('glow-val');
const gesturePill     = document.getElementById('gesture-pill');
const gestureIcon     = document.getElementById('gesture-icon');
const gestureText     = document.getElementById('gesture-text');
const camDot          = document.getElementById('cam-dot');
const camState        = document.getElementById('cam-state');
const colorGrid       = document.getElementById('color-grid');

// ─── Colors — matching the video palette ─────────────────────────────────────
const COLORS = [
    '#ff3d3d',   // Red
    '#ff9800',   // Orange
    '#ffeb3b',   // Yellow
    '#4caf50',   // Green
    '#00e5ff',   // Teal (default, matches video)
    '#2979ff',   // Blue
    '#aa00ff',   // Purple
    '#ffffff',   // White
];

let selectedColor = COLORS[4]; // Teal default
let brushSize     = parseInt(thicknessSlider.value);
let glowSize      = parseInt(glowSlider.value);

// ─── State ───────────────────────────────────────────────────────────────────
let handLandmarker  = null;
let webcamRunning   = false;
let lastVideoTime   = -1;
let currentGesture  = 'NONE';
let isDrawing       = false;
let lastX = null, lastY = null;
let smoothX = null, smoothY = null;

const SMOOTH = 0.45; // Exponential smoothing factor

let undoHistory = [];

// ─── Sparkle / Fairy-dust Particle System ────────────────────────────────────
const particles = [];
const MAX_PARTICLES = 600;

// Pre-render a soft glowing orb into an off-screen canvas for performance
function makeGlowOrb(color, radius = 10) {
    const c = document.createElement('canvas');
    c.width = c.height = radius * 2;
    const cx = c.getContext('2d');
    const g = cx.createRadialGradient(radius, radius, 0, radius, radius, radius);
    const hex = color;
    let r = parseInt(hex.slice(1,3), 16);
    let g2 = parseInt(hex.slice(3,5), 16);
    let b = parseInt(hex.slice(5,7), 16);
    g.addColorStop(0,   `rgba(255,255,255,1)`);
    g.addColorStop(0.15,`rgba(${r},${g2},${b},0.95)`);
    g.addColorStop(0.5, `rgba(${r},${g2},${b},0.5)`);
    g.addColorStop(1,   `rgba(${r},${g2},${b},0)`);
    cx.fillStyle = g;
    cx.beginPath();
    cx.arc(radius, radius, radius, 0, Math.PI * 2);
    cx.fill();
    return c;
}

// Build particle templates for every color
const orbCache = {};
COLORS.forEach(c => { orbCache[c] = makeGlowOrb(c); });
orbCache['#ffffff'] = makeGlowOrb('#ffffff');

class Particle {
    constructor(x, y, color) {
        this.x  = x;
        this.y  = y;
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 2.5 + 0.5;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed - 0.5;  // slight upward drift
        this.alpha   = 1;
        this.decay   = Math.random() * 0.035 + 0.015;
        this.scale   = Math.random() * 0.9 + 0.3;
        // Alternate between pure white and the selected color for a sparkle feel
        this.orb = Math.random() > 0.35 ? orbCache['#ffffff'] : (orbCache[color] || orbCache['#ffffff']);
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.alpha  -= this.decay;
        this.scale  *= 0.97;
    }
    draw(ctx) {
        if (this.alpha <= 0) return;
        const s = this.scale * 10; // draw radius in pixels
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.alpha);
        ctx.translate(this.x, this.y);
        ctx.drawImage(this.orb, -s, -s, s * 2, s * 2);
        ctx.restore();
    }
}

function spawnParticles(x, y, prevX, prevY) {
    const steps  = 6;  // interpolate along stroke
    const count  = Math.max(4, Math.floor(brushSize * 1.2));
    for (let s = 0; s < steps; s++) {
        const t  = s / steps;
        const px = prevX + (x - prevX) * t;
        const py = prevY + (y - prevY) * t;
        for (let i = 0; i < count; i++) {
            if (particles.length >= MAX_PARTICLES) break;
            particles.push(new Particle(px, py, selectedColor));
        }
    }
}

function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update();
        if (particles[i].alpha <= 0) particles.splice(i, 1);
    }
}

function drawParticles() {
    overlayCtx.save();
    overlayCtx.globalCompositeOperation = 'lighter';  // additive blending = glowing
    for (const p of particles) p.draw(overlayCtx);
    overlayCtx.restore();
}

// ─── Color Palette Buttons ────────────────────────────────────────────────────
COLORS.forEach((hex, i) => {
    const btn = document.createElement('div');
    btn.className = 'color-btn' + (i === 4 ? ' active' : '');
    btn.style.backgroundColor = hex;
    btn.style.setProperty('--btn-color', hex);
    btn.addEventListener('click', () => {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedColor = hex;
    });
    colorGrid.appendChild(btn);
});

// ─── Slider Controls ──────────────────────────────────────────────────────────
thicknessSlider.addEventListener('input', e => {
    brushSize = parseInt(e.target.value);
    thicknessVal.textContent = brushSize;
});
glowSlider.addEventListener('input', e => {
    glowSize = parseInt(e.target.value);
    glowVal.textContent = glowSize;
});

// ─── Canvas Resize ────────────────────────────────────────────────────────────
function resizeCanvases() {
    const w = window.innerWidth, h = window.innerHeight;
    drawCanvas.width    = w; drawCanvas.height    = h;
    overlayCanvas.width = w; overlayCanvas.height = h;
    if (undoHistory.length === 0) saveState();
}
window.addEventListener('resize', resizeCanvases);
resizeCanvases();

// ─── Undo History ────────────────────────────────────────────────────────────
function saveState() {
    if (undoHistory.length >= 20) undoHistory.shift();
    undoHistory.push(drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height));
}

undoBtn.addEventListener('click', () => {
    if (undoHistory.length > 1) {
        undoHistory.pop();
        drawCtx.putImageData(undoHistory[undoHistory.length - 1], 0, 0);
    } else {
        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    }
});
clearBtn.addEventListener('click', () => {
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    saveState();
    particles.length = 0;
});

cameraBtn.addEventListener('click', () => {
    video.classList.toggle('hidden');
    const hidden = video.classList.contains('hidden');
    cameraBtn.innerHTML = hidden
        ? '<i class="fa-solid fa-video"></i>'
        : '<i class="fa-solid fa-video-slash"></i>';
    cameraBtn.title = hidden ? 'Show Camera' : 'Hide Camera';
});

saveBtn.addEventListener('click', () => {
    const exp = document.createElement('canvas');
    exp.width  = drawCanvas.width;
    exp.height = drawCanvas.height;
    const ec   = exp.getContext('2d');
    ec.fillStyle = '#000';
    ec.fillRect(0, 0, exp.width, exp.height);
    ec.drawImage(drawCanvas, 0, 0);
    const a    = document.createElement('a');
    a.download = 'air-pen.png';
    a.href     = exp.toDataURL('image/png');
    a.click();
});

// ─── Gesture UI Pill ─────────────────────────────────────────────────────────
const GESTURE_CONFIG = {
    'SHOW HAND': { icon: '👋', text: 'SHOW HAND',  cls: 'show'  },
    'DRAW':      { icon: '☝️',  text: 'DRAWING',    cls: 'draw'  },
    'ERASE':     { icon: '✋',  text: 'ERASING',    cls: 'erase' },
    'PAUSE':     { icon: '🤏',  text: 'GRAB',       cls: 'pause' },
    'FIST':      { icon: '✊',  text: 'PAUSED',     cls: 'pause' },
};

function updatePill(gesture) {
    if (gesture === currentGesture) return;

    // Save undo snapshot when leaving draw mode
    if (currentGesture === 'DRAW' && gesture !== 'DRAW') saveState();

    currentGesture = gesture;
    const cfg = GESTURE_CONFIG[gesture] || GESTURE_CONFIG['SHOW HAND'];

    gestureIcon.textContent = cfg.icon;
    gestureText.textContent = cfg.text;
    gesturePill.className   = `gesture-pill ${cfg.cls}`;
}

// ─── Landmark Helpers ─────────────────────────────────────────────────────────
function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function isExtended(tip, mid, wrist) {
    return dist(tip, wrist) > dist(mid, wrist) * 1.2;
}

function recognizeGesture(lm) {
    const wrist = lm[0];
    const thumb = { tip: lm[4],  mid: lm[3]  };
    const index = { tip: lm[8],  mid: lm[6]  };
    const middle= { tip: lm[12], mid: lm[10] };
    const ring  = { tip: lm[16], mid: lm[14] };
    const pinky = { tip: lm[20], mid: lm[18] };

    const ext = [
        isExtended(index.tip,  index.mid,  wrist),
        isExtended(middle.tip, middle.mid, wrist),
        isExtended(ring.tip,   ring.mid,   wrist),
        isExtended(pinky.tip,  pinky.mid,  wrist),
    ];
    const pinchDist = dist(lm[4], lm[8]);

    const extCount = ext.filter(Boolean).length;

    if (pinchDist < 0.07)   return 'PAUSE';
    if (extCount === 4)      return 'ERASE';
    if (ext[0] && extCount === 1) return 'DRAW';
    if (extCount === 0)      return 'FIST';
    return 'PAUSE';
}

// ─── Drawing Logic ────────────────────────────────────────────────────────────
function drawNeonStroke(x1, y1, x2, y2) {
    drawCtx.save();
    drawCtx.lineCap  = 'round';
    drawCtx.lineJoin = 'round';

    // Layer 1 — Wide soft outer glow
    drawCtx.lineWidth   = brushSize * 3;
    drawCtx.strokeStyle = selectedColor;
    drawCtx.globalAlpha = 0.12;
    drawCtx.shadowBlur  = glowSize * 2;
    drawCtx.shadowColor = selectedColor;
    drawCtx.beginPath(); drawCtx.moveTo(x1, y1); drawCtx.lineTo(x2, y2); drawCtx.stroke();

    // Layer 2 — Bright neon tube
    drawCtx.lineWidth   = brushSize;
    drawCtx.globalAlpha = 1;
    drawCtx.shadowBlur  = glowSize;
    drawCtx.shadowColor = selectedColor;
    drawCtx.strokeStyle = selectedColor;
    drawCtx.beginPath(); drawCtx.moveTo(x1, y1); drawCtx.lineTo(x2, y2); drawCtx.stroke();

    // Layer 3 — Pure white hot core
    drawCtx.lineWidth   = brushSize * 0.25;
    drawCtx.globalAlpha = 1;
    drawCtx.shadowBlur  = 0;
    drawCtx.strokeStyle = '#ffffff';
    drawCtx.beginPath(); drawCtx.moveTo(x1, y1); drawCtx.lineTo(x2, y2); drawCtx.stroke();

    drawCtx.restore();
}

// ─── Overlay: Tracker circle + eraser ring ────────────────────────────────────
function drawTracker(x, y, gesture) {
    overlayCtx.save();

    if (gesture === 'ERASE') {
        // Big yellow eraser ring
        const r = brushSize * 6;
        overlayCtx.strokeStyle = 'rgba(255, 230, 0, 0.8)';
        overlayCtx.lineWidth   = 2;
        overlayCtx.shadowBlur  = 10;
        overlayCtx.shadowColor = '#ffe600';
        overlayCtx.beginPath();
        overlayCtx.arc(x, y, r, 0, Math.PI * 2);
        overlayCtx.stroke();
    } else {
        // Small yellow glowing circle at fingertip
        overlayCtx.shadowBlur  = 16;
        overlayCtx.shadowColor = '#ffe600';
        overlayCtx.fillStyle   = 'rgba(255, 230, 0, 0.9)';
        overlayCtx.beginPath();
        overlayCtx.arc(x, y, 7, 0, Math.PI * 2);
        overlayCtx.fill();

        // Inner white dot
        overlayCtx.shadowBlur  = 0;
        overlayCtx.fillStyle   = '#ffffff';
        overlayCtx.beginPath();
        overlayCtx.arc(x, y, 3, 0, Math.PI * 2);
        overlayCtx.fill();
    }
    overlayCtx.restore();
}

// ─── MediaPipe Setup ──────────────────────────────────────────────────────────
async function initMediaPipe() {
    const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm'
    );
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numHands: 1
    });
    // Enable start button
    startBtn.disabled = false;
    startBtn.innerHTML = '<i class="fa-solid fa-camera"></i> Start Camera';
}

initMediaPipe();

// ─── Start Button ────────────────────────────────────────────────────────────
startBtn.addEventListener('click', async () => {
    if (!handLandmarker) return;
    startScreen.classList.add('hidden');

    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } });
    video.srcObject = stream;
    await new Promise(r => video.addEventListener('loadeddata', r, { once: true }));

    webcamRunning = true;
    camDot.classList.add('active');
    camState.textContent = 'ON';

    resizeCanvases();
    requestAnimationFrame(loop);
});

// ─── Main Loop ────────────────────────────────────────────────────────────────
async function loop() {
    if (!webcamRunning) return;

    const now = performance.now();

    if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;

        const results = handLandmarker.detectForVideo(video, now);

        // Clear overlay each frame
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

        // Draw existing particles
        updateParticles();
        drawParticles();

        if (results.landmarks && results.landmarks.length > 0) {
            const lm      = results.landmarks[0];
            const gesture = recognizeGesture(lm);
            updatePill(gesture);

            // Map landmark coords to canvas (landmarks are 0-1 normalized; video is mirrored)
            const tipLM  = (gesture === 'ERASE') ? lm[9] : lm[8]; // Palm center for eraser
            const rawX   = tipLM.x * overlayCanvas.width;
            const rawY   = tipLM.y * overlayCanvas.height;

            // Smooth position
            if (smoothX === null) { smoothX = rawX; smoothY = rawY; }
            smoothX += (rawX - smoothX) * SMOOTH;
            smoothY += (rawY - smoothY) * SMOOTH;

            const x = smoothX;
            const y = smoothY;

            // Draw yellow tracker circle / eraser ring
            drawTracker(x, y, gesture);

            if (gesture === 'DRAW') {
                if (!isDrawing) {
                    // Start new stroke
                    lastX = x; lastY = y;
                    isDrawing = true;
                }

                // Draw neon stroke segment
                drawNeonStroke(lastX, lastY, x, y);

                // Spawn sparkle particles along the stroke
                spawnParticles(x, y, lastX, lastY);

                lastX = x; lastY = y;

            } else if (gesture === 'ERASE') {
                isDrawing = false; lastX = null; lastY = null;
                // Erase under the palm circle
                drawCtx.save();
                drawCtx.globalCompositeOperation = 'destination-out';
                drawCtx.beginPath();
                drawCtx.arc(x, y, brushSize * 6, 0, Math.PI * 2);
                drawCtx.fill();
                drawCtx.restore();

            } else {
                isDrawing = false; lastX = null; lastY = null;
            }

        } else {
            // No hand detected
            updatePill('SHOW HAND');
            isDrawing = false; lastX = null; lastY = null;
            smoothX = null; smoothY = null;
        }
    }

    requestAnimationFrame(loop);
}
