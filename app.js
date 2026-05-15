import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.js";

const video = document.getElementById('webcam');
const canvas = document.getElementById('output_canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const overlayCanvas = document.getElementById('overlay_canvas');
const overlayCtx = overlayCanvas.getContext('2d');

const startBtn = document.getElementById('start-btn');
const undoBtn = document.getElementById('undo-btn');
const clearBtn = document.getElementById('clear-btn');
const cameraBtn = document.getElementById('camera-btn');
const saveBtn = document.getElementById('save-btn');

const thicknessSlider = document.getElementById('thickness-slider');
const thicknessVal = document.getElementById('thickness-val');
const glowSlider = document.getElementById('glow-slider');
const glowVal = document.getElementById('glow-val');

const gestureGuide = document.getElementById('gesture-guide');
const gestureIcon = document.getElementById('gesture-icon');
const gestureText = document.getElementById('gesture-text');
const camState = document.getElementById('cam-state');
const camDot = document.getElementById('cam-dot');
const colorGrid = document.getElementById('color-grid');

const COLORS = [
    { id: 'cyan', hex: '#06b6d4' },
    { id: 'magenta', hex: '#d946ef' },
    { id: 'lime', hex: '#84cc16' },
    { id: 'electric', hex: '#3b82f6' },
    { id: 'hotpink', hex: '#f43f5e' },
    { id: 'gold', hex: '#eab308' },
    { id: 'purple', hex: '#8b5cf6' },
    { id: 'white', hex: '#ffffff' }
];

let selectedColor = COLORS[0].hex;
let thickness = parseInt(thicknessSlider.value);
let glow = parseInt(glowSlider.value);

let handLandmarker = undefined;
let webcamRunning = false;
let lastVideoTime = -1;

let lastX = null;
let lastY = null;
let currentGesture = 'SHOW HAND'; // SHOW HAND, DRAW, GRAB, ERASE, PAUSED

let undoHistory = [];

// Initialize Colors
COLORS.forEach((color, index) => {
    const btn = document.createElement('div');
    btn.className = `color-btn ${index === 0 ? 'active' : ''}`;
    btn.style.backgroundColor = color.hex;
    btn.style.color = color.hex;
    btn.dataset.color = color.hex;
    btn.addEventListener('click', () => {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedColor = color.hex;
    });
    colorGrid.appendChild(btn);
});

thicknessSlider.addEventListener('input', (e) => {
    thickness = parseInt(e.target.value);
    thicknessVal.innerText = thickness;
});
glowSlider.addEventListener('input', (e) => {
    glow = parseInt(e.target.value);
    glowVal.innerText = glow;
});

window.addEventListener('resize', resizeCanvas);
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    overlayCanvas.width = window.innerWidth;
    overlayCanvas.height = window.innerHeight;
    saveState(); // initial state
}
resizeCanvas();

function saveState() {
    if (undoHistory.length > 20) undoHistory.shift();
    undoHistory.push(ctx.getImageData(0, 0, canvas.width || 1, canvas.height || 1));
}

undoBtn.addEventListener('click', () => {
    if (undoHistory.length > 1) {
        undoHistory.pop(); // remove current state
        ctx.putImageData(undoHistory[undoHistory.length - 1], 0, 0);
    } else if (undoHistory.length === 1) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        undoHistory = [];
        saveState();
    }
});

clearBtn.addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    saveState();
});

cameraBtn.addEventListener('click', () => {
    video.classList.toggle('hidden');
    if (video.classList.contains('hidden')) {
        cameraBtn.innerHTML = '<i class="fa-solid fa-video"></i> Show Cam';
    } else {
        cameraBtn.innerHTML = '<i class="fa-solid fa-video-slash"></i> Hide Cam';
    }
});

saveBtn.addEventListener('click', saveCanvas);

async function createHandLandmarker() {
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 1
    });
    startBtn.innerHTML = '<i class="fa-solid fa-camera"></i> Start Camera';
    startBtn.disabled = false;
}
createHandLandmarker();

async function enableCam() {
    if (!handLandmarker) return;

    if (webcamRunning) {
        webcamRunning = false;
        startBtn.innerHTML = '<i class="fa-solid fa-camera"></i> Start Camera';
        video.srcObject.getTracks().forEach(track => track.stop());
        camDot.className = 'dot red';
        camState.innerText = 'OFF';
        return;
    }

    webcamRunning = true;
    startBtn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop Camera';
    camDot.className = 'dot green';
    camState.innerText = 'ON';

    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } }).then((stream) => {
        video.srcObject = stream;
        video.addEventListener("loadeddata", predictWebcam);
    });
}
startBtn.addEventListener("click", enableCam);

function dist(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function updateGestureUI(gesture) {
    if (currentGesture === gesture) return;
    
    // If we transition out of DRAW or ERASE, save the undo state
    if ((currentGesture === 'DRAW' || currentGesture === 'ERASE') && (gesture !== 'DRAW' && gesture !== 'ERASE')) {
        saveState();
    }

    currentGesture = gesture;
    
    if (gesture === 'SHOW HAND') {
        gestureGuide.classList.add('hidden');
        return;
    }
    
    gestureGuide.classList.remove('hidden');

    switch (gesture) {
        case 'DRAW':
            gestureIcon.innerText = '☝️';
            gestureText.innerText = 'Drawing';
            gestureGuide.style.background = 'rgba(34, 197, 94, 0.8)'; // Green
            break;
        case 'GRAB':
            gestureIcon.innerText = '🤏';
            gestureText.innerText = 'Grab / Move';
            gestureGuide.style.background = 'rgba(59, 130, 246, 0.8)'; // Blue
            break;
        case 'ERASE':
            gestureIcon.innerText = '✋';
            gestureText.innerText = 'Erasing';
            gestureGuide.style.background = 'rgba(239, 68, 68, 0.8)'; // Red
            break;
        case 'PAUSED':
            gestureIcon.innerText = '✊';
            gestureText.innerText = 'Paused';
            gestureGuide.style.background = 'rgba(100, 116, 139, 0.8)'; // Gray
            break;
    }
}

function drawSkeleton(landmarks) {
    const CONNECTIONS = [
        [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
        [0, 5], [5, 6], [6, 7], [7, 8], // Index
        [5, 9], [9, 10], [10, 11], [11, 12], // Middle
        [9, 13], [13, 14], [14, 15], [15, 16], // Ring
        [13, 17], [0, 17], [17, 18], [18, 19], [19, 20] // Pinky & Palm
    ];

    overlayCtx.save();
    overlayCtx.lineWidth = 2;
    overlayCtx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    overlayCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';

    // Lines
    CONNECTIONS.forEach(([i, j]) => {
        const p1 = landmarks[i], p2 = landmarks[j];
        overlayCtx.beginPath();
        overlayCtx.moveTo(p1.x * overlayCanvas.width, p1.y * overlayCanvas.height);
        overlayCtx.lineTo(p2.x * overlayCanvas.width, p2.y * overlayCanvas.height);
        overlayCtx.stroke();
    });

    // Nodes
    landmarks.forEach((p, idx) => {
        overlayCtx.beginPath();
        overlayCtx.arc(p.x * overlayCanvas.width, p.y * overlayCanvas.height, 4, 0, 2 * Math.PI);
        overlayCtx.fill();
    });
    
    // Highlight tips
    [4,8,12,16,20].forEach(tip => {
        overlayCtx.fillStyle = selectedColor;
        overlayCtx.shadowBlur = glow;
        overlayCtx.shadowColor = selectedColor;
        overlayCtx.beginPath();
        overlayCtx.arc(landmarks[tip].x * overlayCanvas.width, landmarks[tip].y * overlayCanvas.height, 6, 0, 2 * Math.PI);
        overlayCtx.fill();
    });

    overlayCtx.restore();
}

function processHand(landmarks) {
    const wrist = landmarks[0];
    const tips = [
        { name: 'thumb', tip: landmarks[4], mcp: landmarks[2] },
        { name: 'index', tip: landmarks[8], mcp: landmarks[5] },
        { name: 'middle', tip: landmarks[12], mcp: landmarks[9] },
        { name: 'ring', tip: landmarks[16], mcp: landmarks[13] },
        { name: 'pinky', tip: landmarks[20], mcp: landmarks[17] }
    ];

    let extended = [];
    tips.forEach(finger => {
        if (finger.name === 'thumb') {
             if (dist(finger.tip, landmarks[17]) > dist(finger.mcp, landmarks[17]) * 1.1) {
                 extended.push(finger.name);
             }
        } else {
            if (dist(finger.tip, wrist) > dist(finger.mcp, wrist) * 1.25) {
                extended.push(finger.name);
            }
        }
    });

    const pinchDist = dist(landmarks[4], landmarks[8]);
    const isPinching = pinchDist < 0.05;

    let gesture = 'IDLE';
    let activePointer = null;

    if (extended.length === 5) {
        gesture = 'ERASE';
        activePointer = landmarks[9]; // Palm center
    } else if (extended.length === 0) {
        gesture = 'PAUSED';
    } else if (isPinching) {
        gesture = 'GRAB';
        activePointer = landmarks[8];
    } else if (extended.length === 1 && extended.includes('index')) {
        gesture = 'DRAW';
        activePointer = landmarks[8];
    } else if (extended.length > 0) {
        gesture = 'GRAB'; // Default
        activePointer = landmarks[8];
    }

    updateGestureUI(gesture);

    if (activePointer) {
        const x = activePointer.x * canvas.width;
        const y = activePointer.y * canvas.height;

        if (gesture === 'DRAW') {
            if (lastX === null) { lastX = x; lastY = y; }
            
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = thickness;
            ctx.strokeStyle = selectedColor;
            ctx.shadowBlur = glow;
            ctx.shadowColor = selectedColor;

            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(x, y);
            ctx.stroke();

            // Reset shadow to not mess up other things
            ctx.shadowBlur = 0;
            lastX = x; lastY = y;
        } else if (gesture === 'ERASE') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.beginPath();
            ctx.arc(x, y, thickness * 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
            lastX = null; lastY = null;
            
            // Draw eraser cursor on overlay
            overlayCtx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
            overlayCtx.lineWidth = 2;
            overlayCtx.beginPath();
            overlayCtx.arc(x, y, thickness * 5, 0, Math.PI * 2);
            overlayCtx.stroke();
        } else {
            lastX = null; lastY = null;
        }
    } else {
        lastX = null; lastY = null;
    }
}

function saveCanvas() {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const exCtx = exportCanvas.getContext('2d');
    
    // Fill dark background
    exCtx.fillStyle = '#0f172a';
    exCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    
    // Flip and draw
    exCtx.translate(exportCanvas.width, 0);
    exCtx.scale(-1, 1);
    exCtx.drawImage(canvas, 0, 0);

    const link = document.createElement('a');
    link.download = 'air-pen-masterpiece.png';
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
}

async function predictWebcam() {
    if (canvas.width !== video.videoWidth && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        overlayCanvas.width = video.videoWidth;
        overlayCanvas.height = video.videoHeight;
        saveState(); // Ensure undo state size matches
    }
    
    let startTimeMs = performance.now();
    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        const results = handLandmarker.detectForVideo(video, startTimeMs);

        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

        if (results.landmarks && results.landmarks.length > 0) {
            drawSkeleton(results.landmarks[0]);
            processHand(results.landmarks[0]);
        } else {
            updateGestureUI('SHOW HAND');
            lastX = null;
            lastY = null;
        }
    }

    if (webcamRunning === true) {
        window.requestAnimationFrame(predictWebcam);
    }
}
