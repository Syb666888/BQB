import {
  FilesetResolver,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

const ACTIONS = {
  hands_on_head: "双手抱头",
  both_hands_up: "举双手",
  single_hand_up: "举单手",
  arms_open: "摊手 / 张开双臂",
  leaning: "身体倾斜",
  neutral: "普通站立",
  unknown: "未识别",
};

const CONNECTORS = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];

const video = document.querySelector("#cameraVideo");
const canvas = document.querySelector("#poseCanvas");
const ctx = canvas.getContext("2d");
const videoFrame = document.querySelector("#videoFrame");
const cameraButton = document.querySelector("#cameraButton");
const statusPill = document.querySelector("#statusPill");
const actionLabel = document.querySelector("#actionLabel");
const heroMemeImage = document.querySelector("#heroMemeImage");
const heroTitle = document.querySelector("#heroTitle");
const heroAction = document.querySelector("#heroAction");
const memeTitle = document.querySelector("#memeTitle");
const memeMeta = document.querySelector("#memeMeta");

let poseLandmarker;
let memes = [];
let stream;
let detectionTimerId;
let watchdogTimerId;
let lastVideoTime = -1;
let stableAction = "unknown";
let selectedMeme;
let actionHistory = [];
let lastRecommendationAt = 0;
let detectionInFlight = false;
const DETECTION_INTERVAL_MS = 300;

init();

async function init() {
  setStatus("加载表情包素材");
  await loadMemes();
  renderRecommendation("unknown", true);

  setStatus("加载动作识别模型");
  try {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "CPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.55,
      minPosePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
    });
    setStatus("模型已就绪");
    cameraButton.disabled = false;
  } catch (error) {
    console.error(error);
    setStatus("模型加载失败，请检查网络");
    cameraButton.disabled = true;
  }
}

cameraButton.addEventListener("click", async () => {
  if (stream) {
    stopCamera();
    return;
  }

  cameraButton.disabled = true;
  setStatus("检查摄像头权限");

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("MediaDevicesUnavailable");
    }

    const permission = await getCameraPermissionState();
    setStatus(permission === "denied" ? "浏览器报告权限被禁用，正在直接尝试打开" : "请求摄像头权限");
    stream = await requestCameraStream();

    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    await waitForVideoMetadata();
    await video.play();
    resizeCanvas();
    videoFrame.classList.add("is-streaming");
    cameraButton.innerHTML = '<span class="button-icon" aria-hidden="true">■</span>关闭摄像头';
    cameraButton.disabled = false;
    setStatus(`实时画面中 · ${getTrackSummary()}`);
    startRealtimeLoops();
  } catch (error) {
    console.error(error);
    cameraButton.disabled = false;
    setStatus(getCameraErrorMessage(error));
  }
});

window.addEventListener("resize", resizeCanvas);

async function loadMemes() {
  try {
    const sourceUrl = "assets/user-memes/manifest.json";
    const response = await fetch(sourceUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Manifest request failed: ${response.status}`);
    }

    const data = await response.json();
    memes = Array.isArray(data) ? data : [];
  } catch (error) {
    console.error(error);
    memes = [];
    setStatus("表情包清单读取失败");
  }
}

function waitForVideoMetadata() {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    video.addEventListener("loadedmetadata", resolve, { once: true });
  });
}

async function getCameraPermissionState() {
  try {
    if (!navigator.permissions?.query) {
      return "unknown";
    }

    const status = await navigator.permissions.query({ name: "camera" });
    return status.state;
  } catch (error) {
    return "unknown";
  }
}

async function requestCameraStream() {
  const preferredConstraints = {
    video: {
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30 },
      facingMode: "user",
    },
    audio: false,
  };

  try {
    return await navigator.mediaDevices.getUserMedia(preferredConstraints);
  } catch (error) {
    if (error?.name === "OverconstrainedError" || error?.name === "ConstraintNotSatisfiedError") {
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    throw error;
  }
}

function getTrackSummary() {
  const [track] = stream?.getVideoTracks?.() || [];
  const settings = track?.getSettings?.() || {};
  const width = settings.width || video.videoWidth || "?";
  const height = settings.height || video.videoHeight || "?";
  const frameRate = settings.frameRate ? `${Math.round(settings.frameRate)}fps` : "fps未知";
  return `${width}×${height} ${frameRate}`;
}

function startRealtimeLoops() {
  stopRealtimeLoops();
  detectionTimerId = window.setInterval(runPoseDetectionTick, DETECTION_INTERVAL_MS);
  watchdogTimerId = window.setInterval(keepVideoPlaying, 1000);
  runPoseDetectionTick();
}

function stopRealtimeLoops() {
  window.clearInterval(detectionTimerId);
  window.clearInterval(watchdogTimerId);
  detectionTimerId = undefined;
  watchdogTimerId = undefined;
}

async function keepVideoPlaying() {
  if (!stream || !video.srcObject) {
    return;
  }

  if (video.paused || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    try {
      await video.play();
    } catch (error) {
      console.warn("Video playback watchdog could not resume playback", error);
    }
  }
}

function runPoseDetectionTick() {
  if (!stream || !poseLandmarker) {
    return;
  }

  const shouldDetect = video.currentTime !== lastVideoTime && !detectionInFlight;

  if (shouldDetect) {
    detectionInFlight = true;
    const now = performance.now();
    lastVideoTime = video.currentTime;

    try {
      const result = poseLandmarker.detectForVideo(video, now);
      const landmarks = result.landmarks?.[0];
      drawPose(landmarks);
      const action = classifyPose(landmarks);
      updateStableAction(action);
      setStatus(`实时画面中 · ${getTrackSummary()}`);
    } catch (error) {
      console.warn("Pose detection skipped this tick", error);
      setStatus(`实时画面中 · ${getTrackSummary()} · 识别降频`);
    } finally {
      detectionInFlight = false;
    }
  }
}

function classifyPose(landmarks) {
  if (!landmarks || landmarks.length < 29) {
    return "unknown";
  }

  const leftShoulder = point(landmarks, 11);
  const rightShoulder = point(landmarks, 12);
  const leftElbow = point(landmarks, 13);
  const rightElbow = point(landmarks, 14);
  const leftWrist = point(landmarks, 15);
  const rightWrist = point(landmarks, 16);
  const leftHip = point(landmarks, 23);
  const rightHip = point(landmarks, 24);
  const nose = point(landmarks, 0);

  const needed = [
    leftShoulder,
    rightShoulder,
    leftElbow,
    rightElbow,
    leftWrist,
    rightWrist,
    leftHip,
    rightHip,
  ];

  if (needed.some((item) => !isVisible(item))) {
    return "unknown";
  }

  const shoulderWidth = Math.max(distance(leftShoulder, rightShoulder), 0.08);
  const torsoHeight = Math.max(
    Math.abs(mid(leftShoulder, rightShoulder).y - mid(leftHip, rightHip).y),
    0.16,
  );
  const leftHandUp = leftWrist.y < leftShoulder.y - torsoHeight * 0.18;
  const rightHandUp = rightWrist.y < rightShoulder.y - torsoHeight * 0.18;
  const head = isVisible(nose) ? nose : mid(leftShoulder, rightShoulder);
  const leftNearHead = distance(leftWrist, head) < shoulderWidth * 0.95;
  const rightNearHead = distance(rightWrist, head) < shoulderWidth * 0.95;
  const bothWristsHigh = leftWrist.y < leftShoulder.y && rightWrist.y < rightShoulder.y;
  const armsSpread =
    leftWrist.x > leftShoulder.x + shoulderWidth * 0.28 &&
    rightWrist.x < rightShoulder.x - shoulderWidth * 0.28 &&
    Math.abs(leftWrist.y - leftShoulder.y) < torsoHeight * 0.9 &&
    Math.abs(rightWrist.y - rightShoulder.y) < torsoHeight * 0.9;
  const shoulderMid = mid(leftShoulder, rightShoulder);
  const hipMid = mid(leftHip, rightHip);
  const bodyLean = Math.abs(shoulderMid.x - hipMid.x) > shoulderWidth * 0.28;
  const shoulderTilt = Math.abs(leftShoulder.y - rightShoulder.y) > torsoHeight * 0.18;

  if (bothWristsHigh && leftNearHead && rightNearHead) {
    return "hands_on_head";
  }

  if (leftHandUp && rightHandUp) {
    return "both_hands_up";
  }

  if (leftHandUp !== rightHandUp) {
    return "single_hand_up";
  }

  if (armsSpread) {
    return "arms_open";
  }

  if (bodyLean || shoulderTilt) {
    return "leaning";
  }

  return "neutral";
}

function updateStableAction(action) {
  actionHistory.push(action);
  actionHistory = actionHistory.slice(-7);
  const counts = actionHistory.reduce((result, item) => {
    result[item] = (result[item] || 0) + 1;
    return result;
  }, {});
  const nextAction = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";

  if (nextAction !== stableAction) {
    stableAction = nextAction;
    actionLabel.textContent = ACTIONS[stableAction];
  }

  const now = performance.now();
  if (now - lastRecommendationAt > 420) {
    lastRecommendationAt = now;
    renderRecommendation(stableAction);
  }
}

function renderRecommendation(action, force = false) {
  if (!memes.length) {
    heroMemeImage.removeAttribute("src");
    heroTitle.textContent = "还没有素材";
    heroAction.textContent = ACTIONS.unknown;
    memeTitle.textContent = "等待添加表情包";
    memeMeta.textContent = "把图片放进 assets/user-memes，并在 manifest.json 里登记。";
    return;
  }

  const matching = memes
    .filter((meme) => meme.actions?.includes(action))
    .sort((a, b) => (b.weight || 1) - (a.weight || 1));
  const fallback = memes
    .filter((meme) => meme.actions?.includes("neutral") || meme.actions?.includes("unknown"))
    .sort((a, b) => (b.weight || 1) - (a.weight || 1));
  const pool = matching.length ? matching : fallback.length ? fallback : memes;
  const nextMeme = pool[0];

  if (!force && selectedMeme?.src === nextMeme.src) {
    return;
  }

  selectedMeme = nextMeme;
  heroMemeImage.src = selectedMeme.src;
  heroMemeImage.alt = selectedMeme.title;
  heroTitle.textContent = selectedMeme.title;
  heroAction.textContent = ACTIONS[action] || ACTIONS.unknown;
  memeTitle.textContent = selectedMeme.title;
  memeMeta.textContent = buildMemeMeta(selectedMeme, action);
}

function buildMemeMeta(meme, action) {
  const tags = (meme.keywords || []).join(" / ");
  const actionText = ACTIONS[action] || ACTIONS.unknown;
  return tags ? `${actionText} · ${tags}` : `${actionText} · 本地素材匹配`;
}

function drawPose(landmarks) {
  resizeCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!landmarks) {
    return;
  }

  ctx.save();
  ctx.scale(-1, 1);
  ctx.translate(-canvas.width, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const [start, end] of CONNECTORS) {
    const a = point(landmarks, start);
    const b = point(landmarks, end);
    if (!isVisible(a) || !isVisible(b)) {
      continue;
    }
    ctx.strokeStyle = "rgba(216, 255, 63, 0.92)";
    ctx.lineWidth = Math.max(4, canvas.width * 0.006);
    ctx.beginPath();
    ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
    ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
    ctx.stroke();
  }

  for (const landmark of landmarks) {
    if (!isVisible(landmark)) {
      continue;
    }
    ctx.fillStyle = "#ff4c24";
    ctx.strokeStyle = "#fff5d6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(landmark.x * canvas.width, landmark.y * canvas.height, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function resizeCanvas() {
  const rect = videoFrame.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function stopCamera() {
  stopRealtimeLoops();
  stream.getTracks().forEach((track) => track.stop());
  stream = undefined;
  detectionInFlight = false;
  video.srcObject = null;
  videoFrame.classList.remove("is-streaming");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  cameraButton.innerHTML = '<span class="button-icon" aria-hidden="true">●</span>开启摄像头';
  setStatus("摄像头已关闭");
  stableAction = "unknown";
  actionHistory = [];
  actionLabel.textContent = ACTIONS.unknown;
  renderRecommendation("unknown", true);
}

function point(landmarks, index) {
  return landmarks[index];
}

function isVisible(pointValue) {
  return pointValue && (pointValue.visibility ?? 1) > 0.34;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mid(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function setStatus(message) {
  statusPill.textContent = message;
}

function getCameraErrorMessage(error) {
  if (error?.message === "MediaDevicesUnavailable") {
    return "当前浏览器不支持摄像头，请用 Chrome/Edge 打开本页";
  }

  if (error?.message === "CameraPermissionDeniedBeforePrompt") {
    return "浏览器已禁止此站点摄像头，请在地址栏左侧恢复权限";
  }

  if (error?.name === "NotAllowedError") {
    return "摄像头权限被拒绝，请在地址栏左侧改为允许";
  }

  if (error?.name === "NotFoundError") {
    return "没有找到摄像头";
  }

  if (error?.name === "NotReadableError") {
    return "摄像头被其他软件占用";
  }

  return `摄像头启动失败：${error?.name || "未知错误"}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}
