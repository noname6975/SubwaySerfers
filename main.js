/**
 * Subway Surfers — endless runner с GLB-моделями
 * Прелоад → выбор персонажа → бег по сегментам окружения, поезда как препятствия.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

/** Счётчик загрузки (доступен в консоли: window.loadedCount) */
let loadedCount = 0;

// =============================================================================
// ПУТИ К МОДЕЛЯМ
// =============================================================================

/** Все GLB для прелоада — пути строго как в папке models/ */
const PRELOAD_MANIFEST = [
  { key: 'rails', path: 'models/tram_rails.glb', kind: 'rails' },
  {
    key: 'train',
    path: 'models/train_-_british_rail_class_08_rail_blue_livery.glb',
    kind: 'train',
  },
  { key: 'jake', path: 'models/jake_subway_surfer.glb', kind: 'character' },
  { key: 'tricky', path: 'models/subway_surfers_tricky.glb', kind: 'character' },
  { key: 'missMaia', path: 'models/miss_maia_subway_surfer_city.glb', kind: 'character' },
  { key: 'yutani', path: 'models/yutani_subway_surfers_city_rigged.glb', kind: 'character' },
];

const TOTAL_MODEL_FILES = PRELOAD_MANIFEST.length;

/**
 * Настройки персонажей — подгоните scale / offset / rotation под ваши GLB.
 */
const CHARACTER_CONFIG = {
  jake: { displayName: 'Jake', scale: 1, rotationY: Math.PI },
  tricky: { displayName: 'Tricky', scale: 1, rotationY: Math.PI },
  missMaia: { displayName: 'Miss Maia', scale: 1, rotationY: Math.PI },
  yutani: { displayName: 'Yutani', scale: 1, rotationY: Math.PI },
};

// =============================================================================
// КОНФИГУРАЦИЯ ИГРЫ
// =============================================================================

const LANE_MIN = -1;
const LANE_MAX = 1;

const CONFIG = {
  laneCount: 3,
  laneOffset: 2.75,           // расстояние между центрами путей (под tram_rails)
  laneOffsetPreferred: 2.75,  // ← подстройка: ещё ближе к центру
  firstTrainSpawnZ: -100,     // первый поезд сразу при Start

  segmentCount: 10,
  segmentLength: 40,

  targetPlayerHeight: 1.4,
  playerScaleMul: 0.5,

  railsScale: 1,
  railsRotationY: Math.PI / 2, // рельсы вдоль оси Z (вглубь экрана)
  railsSurfaceOffset: 0,       // ← подстройка: ноги/колёса на металле

  trainScale: 1,
  trainLaneFill: 0.92,        // поезд ≈ одна полоса
  trainRotationY: Math.PI,    // разворот, если спавнится задом

  airLaneSwitchSpeed: 20,     // смена полосы в прыжке

  skyColor: 0x6ec8f0,
  laneSwitchSpeed: 24,          // резкая смена полосы
  speed: 18,

  cameraOffset: new THREE.Vector3(0, 5, 10),

  jumpHeight: 5.8,            // Super Jump — перепрыгнуть вагон
  gravity: 18,                // «затяжной» прыжок как в Subway Surfers

  spawnIntervalInitial: 3000,
  spawnIntervalMin: 1000,
  spawnIntervalDecreasePerSec: 50,
  spawnScoreStep: 500,
  spawnIntervalDecreasePerScore: 50,

  obstacleDespawnZMin: 50,
  obstacleDespawnCameraOffset: 28,
  roadDespawnZ: 20,

  distanceScale: 0.12,
  scorePerDistance: 8,

  playerHitboxShrink: 0.72,
  showHitboxHelpers: true,
};

/** X координаты трёх путей: [-offset, 0, offset] */
let LANE_POSITIONS = [];

/** Таймер спавна поездов (мс) */
let spawnInterval = 3000;
let lastSpawnTime = 0;

function getTargetXForLane(lane) {
  return lane * CONFIG.laneOffset;
}

function rebuildLanePositions() {
  const o = CONFIG.laneOffset;
  LANE_POSITIONS = [LANE_MIN, 0, LANE_MAX].map((lane) => getTargetXForLane(lane));
  console.log('[Lanes] laneOffset =', o, '→ X:', LANE_POSITIONS);
}

rebuildLanePositions();

function resetSpawnDifficulty() {
  spawnInterval = CONFIG.spawnIntervalInitial;
  lastSpawnTime = 0;
  state.difficultyTimer = 0;
  state.lastScoreMilestone = 0;
}

/** Первый поезд сразу при старте / рестарте. */
function spawnTrainsOnGameStart() {
  spawnTrain(CONFIG.firstTrainSpawnZ);
  lastSpawnTime = performance.now();
}

function getObstacleDespawnZ() {
  return Math.max(CONFIG.obstacleDespawnZMin, camera.position.z + CONFIG.obstacleDespawnCameraOffset);
}

function getJumpVelocity() {
  return Math.sqrt(2 * CONFIG.gravity * CONFIG.jumpHeight);
}

// =============================================================================
// ЗАГРУЖЕННЫЕ АССЕТЫ (прелоад)
// =============================================================================

/** @type {Record<string, import('three').GLTF>} */
const characterModels = {};

/** Шаблон tram_rails.glb */
let railsTemplate = null;

/** Шаблон British Rail Class 08 */
let trainTemplate = null;

/** @type {THREE.LineSegments[]} */
const hitboxHelpers = [];

// =============================================================================
// DOM
// =============================================================================

const ui = {
  loadingScreen: document.getElementById('loading-screen'),
  loadingText: document.getElementById('loading-text'),
  loadingProgress: document.getElementById('loading-progress'),
  characterSelection: document.getElementById('character-selection'),
  characterGrid: document.getElementById('character-grid'),
  selectedCharLabel: document.getElementById('selected-char-label'),
  startBtn: document.getElementById('start-btn'),
  gameUi: document.getElementById('game-ui'),
  score: document.getElementById('score-value'),
  distance: document.getElementById('distance-value'),
  gameOver: document.getElementById('game-over'),
  finalScore: document.getElementById('final-score'),
  restartBtn: document.getElementById('restart-btn'),
};

// =============================================================================
// СОСТОЯНИЕ
// =============================================================================

const state = {
  selectedCharacterId: 'jake',
  gameStarted: false,
  isPlaying: false,

  currentLane: 0,
  keys: { left: false, right: false, space: false },

  isJumping: false,
  velocityY: 0,
  groundY: 0,

  difficultyTimer: 0,
  lastScoreMilestone: 0,
  distance: 0,
  score: 0,
};

// =============================================================================
// THREE.JS
// =============================================================================

const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(CONFIG.skyColor);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.skyColor);
scene.fog = new THREE.Fog(CONFIG.skyColor, 35, 100);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  300
);

const playerBox = new THREE.Box3();
const obstacleBox = new THREE.Box3();
const tempBox = new THREE.Box3();
const tempBoxB = new THREE.Box3();
const tempCenter = new THREE.Vector3();
const tempSize = new THREE.Vector3();

/** Корневой объект игрока (позиция полос / прыжка) */
const playerRoot = new THREE.Group();

/** Текущая 3D-модель персонажа (дочерний объект playerRoot) */
let currentPlayerModel = null;

let playerMixer = null;
let runAction = null;
let jumpAction = null;
/** @type {THREE.AnimationClip[]} */
let playerAnimationClips = [];

/** @type {THREE.Group[]} */
const roadSegments = [];

/** @type {THREE.Group[]} */
const obstacles = [];

let animationId = null;
const clock = new THREE.Clock();

// =============================================================================
// УТИЛИТЫ ДЛЯ GLB
// =============================================================================

function enableShadows(object) {
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

function cloneCharacterModel(gltf) {
  const model = cloneSkeleton(gltf.scene);
  model.animations = gltf.animations;
  enableShadows(model);
  return model;
}

function findAnimationClip(clips, keywords) {
  if (!clips?.length) return null;
  const lower = keywords.map((k) => k.toLowerCase());
  return (
    clips.find((clip) => lower.some((kw) => clip.name.toLowerCase().includes(kw))) ??
    clips[0]
  );
}

/** Отладка: что авторы положили в GLB (смотреть в F12 при загрузке). */
function debugLogGltfAnimations(label, path, gltf) {
  console.log(`Проверка анимаций для модели (${label}):`, path);
  console.log('gltf.animations:', gltf.animations);

  if (!gltf.animations || gltf.animations.length === 0) {
    console.warn('В этой модели НЕТ встроенных анимаций!');
    return;
  }

  gltf.animations.forEach((clip) => {
    console.log('- Найдена анимация:', clip.name);
  });
}

/**
 * Запуск анимации по имени (частичное совпадение: "run", "jump", "Take 001").
 * @param {string} name
 * @param {{ fadeIn?: number, loopOnce?: boolean }} [options]
 * @returns {THREE.AnimationAction | null}
 */
function playAnimation(name, options = {}) {
  const { fadeIn = 0, loopOnce = false } = options;

  if (!playerMixer) {
    console.warn(`[Anim] playAnimation("${name}"): AnimationMixer не создан`);
    return null;
  }

  if (!playerAnimationClips.length) {
    console.warn(`[Anim] playAnimation("${name}"): нет загруженных клипов`);
    return null;
  }

  const search = name.toLowerCase();
  let clip = playerAnimationClips.find((c) => c.name.toLowerCase().includes(search));

  if (!clip) {
    clip = playerAnimationClips.find((c) => c.name.toLowerCase() === search);
  }

  if (!clip) {
    console.warn(
      `[Anim] playAnimation("${name}"): клип не найден. Доступно:`,
      playerAnimationClips.map((c) => c.name)
    );
    return null;
  }

  const action = playerMixer.clipAction(clip);

  if (loopOnce) {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  } else {
    action.setLoop(THREE.LoopRepeat, Infinity);
  }

  if (fadeIn > 0) {
    action.reset().fadeIn(fadeIn).play();
  } else {
    action.reset().play();
  }

  console.log(`[Anim] playAnimation → "${clip.name}"`);
  return action;
}

function setupCharacterAnimations(model, gltf) {
  playerMixer = null;
  runAction = null;
  jumpAction = null;
  playerAnimationClips = gltf?.animations?.length ? gltf.animations : model?.animations ?? [];

  if (!playerAnimationClips.length) {
    console.warn('[Anim] setupCharacterAnimations: нет клипов — T-поза');
    return;
  }

  playerMixer = new THREE.AnimationMixer(model);
  console.log(`[Anim] AnimationMixer создан, клипов: ${playerAnimationClips.length}`);

  runAction =
    playAnimation('run') ??
    playAnimation('running') ??
    playAnimation('jog') ??
    playAnimation('idle') ??
    playAnimation('Take 001') ??
    playAnimation(playerAnimationClips[0].name);

  const jumpClip = findAnimationClip(playerAnimationClips, ['jump', 'leap']);
  if (jumpClip) {
    jumpAction = playerMixer.clipAction(jumpClip);
    jumpAction.setLoop(THREE.LoopOnce, 1);
    jumpAction.clampWhenFinished = true;
  }
}

function disposeObject3D(object) {
  object.traverse((child) => {
    if (child.isMesh) {
      child.geometry?.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        child.material?.dispose();
      }
    }
  });
}

/** Помечает объект как не участвующий в столкновениях (дорога, рельсы). */
function markNonCollidable(object) {
  object.traverse((child) => {
    child.userData.collidable = false;
  });
  object.userData.isEnvironment = true;
}

/** Нижняя грань модели на y = 0 (локально). */
function snapBottomToY0(model) {
  model.updateMatrixWorld(true);
  tempBox.setFromObject(model);
  model.position.y -= tempBox.min.y;
}

/** Центр по X/Z в нуле (локально). */
function centerModelXZ(model) {
  model.updateMatrixWorld(true);
  tempBox.setFromObject(model);
  tempBox.getCenter(tempCenter);
  model.position.x -= tempCenter.x;
  model.position.z -= tempCenter.z;
}

function getObjectSize(object) {
  object.updateMatrixWorld(true);
  tempBox.setFromObject(object);
  tempBox.getSize(tempSize);
  return tempSize.clone();
}

function shrinkBox3(box, factor) {
  box.getSize(tempSize);
  box.getCenter(tempCenter);
  tempSize.multiplyScalar(factor);
  box.setFromCenterAndSize(tempCenter, tempSize);
  return box;
}

/** Красная рамка хитбокса (замена Box3Helper — нет в CDN для r170). */
function createHitboxWireframe(color = 0xff0000) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const edges = new THREE.EdgesGeometry(geo);
  geo.dispose();
  const lines = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color, linewidth: 2 })
  );
  return lines;
}

function syncHitboxWireframe(lines, box) {
  if (box.isEmpty()) return;
  box.getCenter(tempCenter);
  box.getSize(tempSize);
  lines.position.copy(tempCenter);
  lines.scale.set(
    Math.max(tempSize.x, 0.01),
    Math.max(tempSize.y, 0.01),
    Math.max(tempSize.z, 0.01)
  );
}

function fitScaleToHeight(object, targetHeight) {
  const size = getObjectSize(object);
  const h = Math.max(size.y, 0.001);
  return targetHeight / h;
}

function fitScaleToWidth(object, targetWidth) {
  const size = getObjectSize(object);
  const w = Math.max(size.x, size.z, 0.001);
  return targetWidth / w;
}

/** После перемещения поезда обновить хитбокс из реального mesh. */
function refreshObstacleHitbox(obstacle) {
  const mesh = obstacle.userData.collisionMesh;
  const box = obstacle.userData.hitbox;
  if (!mesh || !box) return;
  obstacle.updateMatrixWorld(true);
  computeHierarchyBox(mesh, box);
}

/** Ноги/колёса на уровне металла рельс (y = 0). */
function snapToRailsSurface(model) {
  snapBottomToY0(model);
  model.position.y += CONFIG.railsSurfaceOffset;
}

/**
 * Подготовка tram_rails: поворот вдоль Z, центр колеи на x=0, y=0, стыковка по Z.
 * @returns {number} segmentLength — длина сегмента вдоль оси бега (Z)
 */
function prepareRailsMesh(rails) {
  rails.scale.setScalar(CONFIG.railsScale);
  rails.rotation.y = CONFIG.railsRotationY;
  rails.position.set(0, 0, 0);
  rails.updateMatrixWorld(true);

  tempBox.setFromObject(rails);
  const centerX = (tempBox.max.x + tempBox.min.x) * 0.5;
  rails.position.x = -centerX;

  rails.updateMatrixWorld(true);
  tempBox.setFromObject(rails);

  rails.position.y = -tempBox.min.y + CONFIG.railsSurfaceOffset;
  rails.position.z = -tempBox.min.z;

  rails.updateMatrixWorld(true);
  tempBox.setFromObject(rails);

  const segmentLength = Math.max(tempBox.max.z - tempBox.min.z, 1);
  return segmentLength;
}

/** Ширина полос и X-позиции из повёрнутой модели рельс (центр на x=0). */
function calibrateLanesFromRails(rails) {
  rails.updateMatrixWorld(true);
  tempBox.setFromObject(rails);
  const railSpanX = tempBox.max.x - tempBox.min.x;

  const autoOffset =
    CONFIG.laneCount > 1 ? railSpanX / (CONFIG.laneCount - 1) : CONFIG.laneOffsetPreferred;

  CONFIG.laneOffset = THREE.MathUtils.clamp(
    CONFIG.laneOffsetPreferred,
    2.5,
    3.0
  );

  console.log(
    `[Lanes] autoOffset=${autoOffset.toFixed(3)} → используем laneOffset=${CONFIG.laneOffset}`
  );

  rebuildLanePositions();
}

/** Box3 по всей иерархии mesh (для детального поезда). */
function computeHierarchyBox(root, targetBox) {
  root.updateMatrixWorld(true);
  targetBox.makeEmpty();
  root.traverse((child) => {
    if (!child.isMesh) return;
    tempBoxB.setFromObject(child);
    if (targetBox.isEmpty()) targetBox.copy(tempBoxB);
    else targetBox.union(tempBoxB);
  });
  return targetBox;
}

function calibrateWorldMetrics() {
  if (railsTemplate) {
    const scaleProbe = cloneSkeleton(railsTemplate.scene);
    scaleProbe.rotation.y = CONFIG.railsRotationY;
    scaleProbe.updateMatrixWorld(true);
    tempBox.setFromObject(scaleProbe);
    const widthAcrossLanes = Math.max(tempBox.max.x - tempBox.min.x, 0.001);

    const targetSpan =
      CONFIG.laneOffset * (CONFIG.laneCount - 1) || CONFIG.laneOffset;
    CONFIG.railsScale = targetSpan / widthAcrossLanes;
    disposeObject3D(scaleProbe);

    const measure = cloneSkeleton(railsTemplate.scene);
    CONFIG.segmentLength = prepareRailsMesh(measure);
    calibrateLanesFromRails(measure);
    disposeObject3D(measure);

    console.log(
      `[World] railsRotationY=90°, railsScale=${CONFIG.railsScale.toFixed(4)}, ` +
        `segmentLength=${CONFIG.segmentLength.toFixed(3)}, laneOffset=${CONFIG.laneOffset.toFixed(3)}, ` +
        `lanes X = [${LANE_POSITIONS.map((v) => v.toFixed(2)).join(', ')}]`
    );
  } else {
    rebuildLanePositions();
  }

  if (trainTemplate) {
    const probeTrain = cloneSkeleton(trainTemplate.scene);
    probeTrain.rotation.y = CONFIG.trainRotationY;
    centerModelXZ(probeTrain);
    CONFIG.trainScale = fitScaleToWidth(
      probeTrain,
      CONFIG.laneOffset * CONFIG.trainLaneFill
    );
    disposeObject3D(probeTrain);
    console.log(`[World] trainScale=${CONFIG.trainScale.toFixed(4)} (полоса ${CONFIG.laneOffset.toFixed(2)})`);
  }

  for (const [id, gltf] of Object.entries(characterModels)) {
    const probeChar = cloneSkeleton(gltf.scene);
    CHARACTER_CONFIG[id].scale =
      fitScaleToHeight(probeChar, CONFIG.targetPlayerHeight) * CONFIG.playerScaleMul;
    disposeObject3D(probeChar);
    console.log(`[World] ${id} scale=${CHARACTER_CONFIG[id].scale.toFixed(4)}`);
  }
}

// =============================================================================
// ПРЕЛОАД (устойчивый к ошибкам)
// =============================================================================

function updateLoadingProgress(loadedCount, total = TOTAL_MODEL_FILES) {
  const ratio = Math.min(loadedCount / total, 1);
  const pct = Math.round(ratio * 100);
  ui.loadingProgress.style.width = `${pct}%`;
  ui.loadingText.textContent = `Загрузка моделей… ${loadedCount}/${total} (${pct}%)`;
}

/**
 * Загружает один GLB. При ошибке resolve с ok:false (не reject), чтобы не блокировать очередь.
 */
const MODEL_LOAD_TIMEOUT_MS = 60000;

function loadModelFile(loader, path, label) {
  return new Promise((resolve) => {
    console.log(`[Preload] Старт загрузки: "${label}" → ${path}`);

    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };

    const timeoutId = setTimeout(() => {
      console.error(
        `[Preload] Таймаут (${MODEL_LOAD_TIMEOUT_MS}ms): "${label}" (${path})`
      );
      finish({ ok: false, gltf: null, path, label, error: new Error('Load timeout') });
    }, MODEL_LOAD_TIMEOUT_MS);

    loader.load(
      path,
      (gltf) => {
        console.log(`[Preload] Успех: "${label}" (${path})`);
        debugLogGltfAnimations(label, path, gltf);
        finish({ ok: true, gltf, path, label });
      },
      (xhr) => {
        if (xhr.lengthComputable && xhr.total > 0) {
          const filePct = Math.round((xhr.loaded / xhr.total) * 100);
          console.debug(`[Preload] "${label}": ${filePct}% байт`);
        }
      },
      (error) => {
        console.error(`[Preload] Ошибка загрузки модели "${label}" (${path}):`, error);
        finish({ ok: false, gltf: null, path, label, error });
      }
    );
  });
}

function applyRailsGltf(gltf) {
  railsTemplate = gltf;
  enableShadows(railsTemplate.scene);
  markNonCollidable(railsTemplate.scene);
  console.log('[Preload] Рельсы tram_rails.glb готовы');
}

function applyTrainGltf(gltf) {
  trainTemplate = gltf;
  enableShadows(trainTemplate.scene);
  console.log('[Preload] Поезд British Rail Class 08 готов');
}

function applyPreloadResults(results) {
  let successCount = 0;

  for (const entry of results) {
    if (!entry.ok || !entry.gltf) {
      console.warn(
        `[Preload] Файл не загружен, пропуск: key="${entry.key}", path="${entry.path}"`
      );
      continue;
    }

    successCount++;
    const { gltf, kind, key } = entry;

    if (kind === 'rails') {
      applyRailsGltf(gltf);
    } else if (kind === 'train') {
      applyTrainGltf(gltf);
    } else if (kind === 'character') {
      characterModels[key] = gltf;
      enableShadows(gltf.scene);
      console.log(`[Preload] Персонаж "${key}" готов`);
    }
  }

  return successCount;
}

/**
 * Загружает все 6 файлов по очереди. Счётчик loadedCount++ всегда (в finally).
 * Меню выбора показывается после обработки всех файлов, даже при частичных ошибках.
 */
async function preloadAssets() {
  const loader = new GLTFLoader();
  loadedCount = 0;
  window.loadedCount = loadedCount;
  const results = [];

  console.log(`[Preload] Начало. Всего файлов: ${TOTAL_MODEL_FILES}`);
  updateLoadingProgress(0);

  for (const item of PRELOAD_MANIFEST) {
    const label = `${item.key} (${item.kind})`;

    try {
      const result = await loadModelFile(loader, item.path, label);
      results.push({ ...item, ...result });
    } catch (unexpected) {
      console.error(`[Preload] Неожиданное исключение для "${item.path}":`, unexpected);
      results.push({
        ...item,
        ok: false,
        gltf: null,
        label,
        error: unexpected,
      });
    } finally {
      loadedCount++;
      window.loadedCount = loadedCount;
      console.log(`[Preload] Обработано файлов: ${loadedCount}/${TOTAL_MODEL_FILES}`);
      updateLoadingProgress(loadedCount);
    }
  }

  const successCount = applyPreloadResults(results);
  calibrateWorldMetrics();
  const failCount = TOTAL_MODEL_FILES - successCount;

  console.log(
    `[Preload] Завершено. Успешно: ${successCount}/${TOTAL_MODEL_FILES}, ошибок: ${failCount}`
  );
  if (failCount > 0) {
    console.warn(
      '[Preload] Часть моделей отсутствует — игра откроет меню с запасными примитивами. См. ошибки выше (F12).'
    );
  }

  updateLoadingProgress(TOTAL_MODEL_FILES);
  return { successCount, failCount, results };
}

function hideLoadingScreen() {
  document.getElementById('loading-screen').classList.add('hidden');
  console.log('[UI] Экран загрузки скрыт (#loading-screen.hidden)');
}

function showCharacterSelectionMenu() {
  const menu = document.getElementById('character-selection');
  menu.classList.remove('hidden');
  console.log('[UI] Меню выбора персонажа показано (#character-selection)');
}

function finishLoadingAndShowCharacterSelect(summary) {
  if (railsTemplate) {
    initRoad();
  } else {
    console.warn('[Preload] tram_rails.glb не загружен — запасная дорога.');
    initFallbackRoad();
  }

  window.segmentLength = CONFIG.segmentLength;
  window.roadSegmentCount = roadSegments.length;

  hideLoadingScreen();
  state.currentLane = 0;
  showCharacterSelectionMenu();
  selectCharacter(state.selectedCharacterId);

  if (summary.failCount > 0) {
    console.warn(
      `[Preload] Меню выбора открыто с ${summary.failCount} недостающими файлами.`
    );
  } else {
    console.log('[Preload] Все модели на месте — меню выбора персонажа.');
  }
}

// =============================================================================
// ОСВЕЩЕНИЕ
// =============================================================================

function initLights() {
  scene.add(new THREE.AmbientLight(0xfff5e6, 0.65));

  const sun = new THREE.DirectionalLight(0xffffff, 1.15);
  sun.position.set(8, 18, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  sun.shadow.camera.left = -16;
  sun.shadow.camera.right = 16;
  sun.shadow.camera.top = 16;
  sun.shadow.camera.bottom = -16;
  scene.add(sun);

  scene.add(new THREE.HemisphereLight(0x87ceeb, 0xc4a574, 0.35));
}

// =============================================================================
// ОКРУЖЕНИЕ (сегменты дороги)
// =============================================================================

function createFallbackRoadSegment() {
  const segment = new THREE.Group();
  const roadW = CONFIG.laneOffset * CONFIG.laneCount;
  const roadGeo = new THREE.BoxGeometry(roadW, 0.2, CONFIG.segmentLength);
  const roadMat = new THREE.MeshStandardMaterial({ color: 0xd4b896, roughness: 0.85 });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = true;
  road.position.y = -0.1;
  segment.add(road);
  return segment;
}

function createRailsSegment() {
  if (!railsTemplate) {
    return createFallbackRoadSegment();
  }

  const rails = cloneSkeleton(railsTemplate.scene);
  prepareRailsMesh(rails);
  enableShadows(rails);
  markNonCollidable(rails);

  const segment = new THREE.Group();
  segment.add(rails);
  segment.userData.isEnvironment = true;
  return segment;
}

function initFallbackRoad() {
  clearRoad();
  const len = CONFIG.segmentLength;
  for (let i = 0; i < CONFIG.segmentCount; i++) {
    const segment = createFallbackRoadSegment();
    segment.position.z = i * -len;
    scene.add(segment);
    roadSegments.push(segment);
  }
}

/** Бесшовная дорога: N сегментов вплотную вдоль -Z. */
function initRoad() {
  clearRoad();

  const len = CONFIG.segmentLength;
  console.log(`[Road] Старт: ${CONFIG.segmentCount} сегментов, длина=${len.toFixed(3)}`);

  for (let i = 0; i < CONFIG.segmentCount; i++) {
    const segment = createRailsSegment();
    segment.position.z = i * -len;
    scene.add(segment);
    roadSegments.push(segment);
  }
}

function resetRoadPositions() {
  clearRoad();
  if (railsTemplate) initRoad();
  else initFallbackRoad();
}

function clearRoad() {
  for (const segment of roadSegments) {
    scene.remove(segment);
    disposeObject3D(segment);
  }
  roadSegments.length = 0;
}

/**
 * Бесконечное полотно: сегменты движутся к игроку, ушедший вперёд ставится в хвост очереди.
 */
function updateRoad(delta) {
  if (!state.isPlaying || roadSegments.length === 0) return;

  const move = CONFIG.speed * delta;
  const len = CONFIG.segmentLength;
  const total = roadSegments.length;

  for (const segment of roadSegments) {
    segment.position.z += move;
  }

  for (const segment of roadSegments) {
    if (segment.position.z > len) {
      segment.position.z -= len * total;
    }
  }
}

// =============================================================================
// ИГРОК
// =============================================================================

/**
 * Создаёт/обновляет currentPlayerModel внутри playerRoot.
 */
function createFallbackPlayerMesh() {
  const geo = new THREE.BoxGeometry(0.9, 1.6, 0.7);
  const mat = new THREE.MeshStandardMaterial({ color: 0x32cd32, roughness: 0.4 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

function mountPlayerModel(characterId) {
  if (currentPlayerModel) {
    playerRoot.remove(currentPlayerModel);
    disposeObject3D(currentPlayerModel);
    currentPlayerModel = null;
  }

  const gltf = characterModels[characterId];
  const cfg = CHARACTER_CONFIG[characterId];

  if (!gltf) {
    console.warn(
      `[Player] GLB для "${characterId}" не загружен — показан запасной куб.`
    );
    currentPlayerModel = createFallbackPlayerMesh();
    snapToRailsSurface(currentPlayerModel);
    playerRoot.add(currentPlayerModel);
    playerRoot.position.set(0, 0, 0);
    playerMixer = null;
    playerAnimationClips = [];
    state.groundY = 0;
    return;
  }

  currentPlayerModel = cloneCharacterModel(gltf);
  currentPlayerModel.scale.setScalar(cfg.scale);
  currentPlayerModel.rotation.y = cfg.rotationY;
  centerModelXZ(currentPlayerModel);
  snapToRailsSurface(currentPlayerModel);

  playerRoot.add(currentPlayerModel);
  playerRoot.position.set(0, 0, 0);
  setupCharacterAnimations(currentPlayerModel, gltf);

  state.groundY = 0;
}

function addPlayerToScene() {
  if (!playerRoot.parent) scene.add(playerRoot);
  resetPlayerTransform();
}

function removePlayerFromScene() {
  if (playerRoot.parent) scene.remove(playerRoot);
  if (currentPlayerModel) {
    playerRoot.remove(currentPlayerModel);
    disposeObject3D(currentPlayerModel);
    currentPlayerModel = null;
  }
  playerMixer = null;
  playerAnimationClips = [];
}

function resetPlayerTransform() {
  state.currentLane = 0;
  state.isJumping = false;
  state.velocityY = 0;

  const targetX = getTargetXForLane(state.currentLane);
  playerRoot.position.set(targetX, state.groundY, 0);
  playerRoot.rotation.set(0, 0, 0);
}

function updatePlayer(delta) {
  if (!state.isPlaying || !currentPlayerModel) return;

  if (state.keys.left && state.currentLane > LANE_MIN) {
    state.currentLane--;
    state.keys.left = false;
  }
  if (state.keys.right && state.currentLane < LANE_MAX) {
    state.currentLane++;
    state.keys.right = false;
  }

  const targetX = getTargetXForLane(state.currentLane);
  const minX = getTargetXForLane(LANE_MIN);
  const maxX = getTargetXForLane(LANE_MAX);

  const laneSpeed = state.isJumping ? CONFIG.airLaneSwitchSpeed : CONFIG.laneSwitchSpeed;
  const newX = THREE.MathUtils.lerp(
    playerRoot.position.x,
    targetX,
    1 - Math.exp(-laneSpeed * delta)
  );
  playerRoot.position.x = THREE.MathUtils.clamp(newX, minX, maxX);

  if (state.keys.space && !state.isJumping) {
    state.isJumping = true;
    state.velocityY = getJumpVelocity();
    state.keys.space = false;

    if (playerMixer) {
      if (runAction) runAction.fadeOut(0.1);
      jumpAction =
        playAnimation('jump', { fadeIn: 0.1, loopOnce: true }) ??
        playAnimation('leap', { fadeIn: 0.1, loopOnce: true });
    }
  }

  if (state.isJumping) {
    state.velocityY -= CONFIG.gravity * delta;
    playerRoot.position.y += state.velocityY * delta;

    if (playerRoot.position.y <= state.groundY) {
      playerRoot.position.y = state.groundY;
      state.velocityY = 0;
      state.isJumping = false;

      if (playerMixer) {
        if (jumpAction) jumpAction.fadeOut(0.1);
        runAction =
          playAnimation('run', { fadeIn: 0.1 }) ??
          playAnimation('idle', { fadeIn: 0.1 }) ??
          playAnimation('running', { fadeIn: 0.1 });
      }
    }
  }

  if (playerMixer) playerMixer.update(delta);
}

// =============================================================================
// ПОЕЗДА (препятствия)
// =============================================================================

function attachTrainHitbox(obstacle, trainMesh) {
  obstacle.userData.collisionMesh = trainMesh;
  obstacle.userData.hitbox = new THREE.Box3();
  computeHierarchyBox(trainMesh, obstacle.userData.hitbox);

  if (!CONFIG.showHitboxHelpers) return;

  const helper = createHitboxWireframe(0xff0000);
  syncHitboxWireframe(helper, obstacle.userData.hitbox);
  helper.userData.obstacle = obstacle;
  scene.add(helper);
  hitboxHelpers.push(helper);
  obstacle.userData.boxHelper = helper;
}

function removeObstacle(obstacle, index) {
  if (obstacle.userData.boxHelper) {
    scene.remove(obstacle.userData.boxHelper);
    const hi = hitboxHelpers.indexOf(obstacle.userData.boxHelper);
    if (hi >= 0) hitboxHelpers.splice(hi, 1);
  }
  scene.remove(obstacle);
  disposeObject3D(obstacle);
  obstacles.splice(index, 1);
}

/**
 * @param {number} [spawnZ] — позиция по Z (по умолчанию впереди по ходу движения)
 */
function spawnTrain(spawnZ) {
  const randomLane = Math.floor(Math.random() * 3) - 1;
  const laneX = getTargetXForLane(randomLane);

  const obstacle = new THREE.Group();
  obstacle.userData.isObstacle = true;
  obstacle.userData.lane = randomLane;

  let collisionMesh;

  if (trainTemplate) {
    const train = cloneSkeleton(trainTemplate.scene);
    train.scale.setScalar(CONFIG.trainScale);
    train.rotation.y = CONFIG.trainRotationY;
    enableShadows(train);
    train.traverse((child) => {
      if (child.isMesh) child.userData.collidable = true;
    });
    centerModelXZ(train);
    obstacle.add(train);
    collisionMesh = train;
  } else {
    const w = CONFIG.laneOffset * CONFIG.trainLaneFill;
    const geo = new THREE.BoxGeometry(w, 1.4, w * 0.9);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff3300 });
    const box = new THREE.Mesh(geo, mat);
    box.castShadow = true;
    box.position.y = 0.7;
    obstacle.add(box);
    collisionMesh = box;
  }

  const zPos =
    spawnZ ??
    -CONFIG.segmentLength * 2 - Math.random() * CONFIG.segmentLength;

  obstacle.position.set(laneX, 0, zPos);

  obstacle.updateMatrixWorld(true);
  if (collisionMesh) {
    snapToRailsSurface(collisionMesh);
    collisionMesh.updateMatrixWorld(true);
  }
  attachTrainHitbox(obstacle, collisionMesh);

  scene.add(obstacle);
  obstacles.push(obstacle);
}

function clearObstacles() {
  while (obstacles.length > 0) {
    removeObstacle(obstacles[0], 0);
  }
  hitboxHelpers.length = 0;
}

function syncObstacleHitboxes() {
  for (const obstacle of obstacles) {
    refreshObstacleHitbox(obstacle);
    if (obstacle.userData.boxHelper) {
      syncHitboxWireframe(obstacle.userData.boxHelper, obstacle.userData.hitbox);
    }
  }
}

function updateSpawnDifficulty(delta) {
  state.difficultyTimer += delta;
  if (state.difficultyTimer >= 1) {
    state.difficultyTimer = 0;
    spawnInterval = Math.max(
      CONFIG.spawnIntervalMin,
      spawnInterval - CONFIG.spawnIntervalDecreasePerSec
    );
  }

  const scoreStep = Math.floor(state.score / CONFIG.spawnScoreStep);
  if (scoreStep > state.lastScoreMilestone) {
    state.lastScoreMilestone = scoreStep;
    spawnInterval = Math.max(
      CONFIG.spawnIntervalMin,
      spawnInterval - CONFIG.spawnIntervalDecreasePerScore
    );
  }
}

function updateObstacles(delta) {
  if (!state.isPlaying) return;

  updateSpawnDifficulty(delta);

  const now = performance.now();
  if (lastSpawnTime === 0 || now - lastSpawnTime >= spawnInterval) {
    lastSpawnTime = now;
    spawnTrain();
  }

  const move = CONFIG.speed * delta;
  const despawnZ = getObstacleDespawnZ();

  for (let i = obstacles.length - 1; i >= 0; i--) {
    obstacles[i].position.z += move;
    refreshObstacleHitbox(obstacles[i]);

    if (obstacles[i].position.z > despawnZ) {
      removeObstacle(obstacles[i], i);
    }
  }
}

// =============================================================================
// СЧЁТ
// =============================================================================

function updateScore(delta) {
  if (!state.isPlaying) return;

  const traveled = CONFIG.speed * delta;
  state.distance += traveled * CONFIG.distanceScale;
  state.score += traveled * CONFIG.scorePerDistance * CONFIG.distanceScale;

  ui.distance.textContent = Math.floor(state.distance);
  ui.score.textContent = Math.floor(state.score);
}

// =============================================================================
// СТОЛКНОВЕНИЯ (Box3 вокруг currentPlayerModel)
// =============================================================================

function getPlayerHitbox(targetBox) {
  if (!currentPlayerModel) return targetBox.makeEmpty();

  currentPlayerModel.updateMatrixWorld(true);
  targetBox.setFromObject(currentPlayerModel);
  return shrinkBox3(targetBox, CONFIG.playerHitboxShrink);
}

function checkCollisions() {
  if (!currentPlayerModel) return;

  syncObstacleHitboxes();
  getPlayerHitbox(playerBox);

  for (const obstacle of obstacles) {
    const box = obstacle.userData.hitbox;
    if (!box || box.isEmpty()) continue;

    if (playerBox.intersectsBox(box)) {
      triggerGameOver();
      return;
    }
  }
}

function triggerGameOver() {
  state.isPlaying = false;

  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  ui.finalScore.textContent = Math.floor(state.score);
  ui.gameOver.classList.remove('hidden');
}

// =============================================================================
// КАМЕРА
// =============================================================================

function updateCamera() {
  if (!currentPlayerModel) return;

  const desired = playerRoot.position.clone().add(CONFIG.cameraOffset);
  camera.position.lerp(desired, 0.14);
  camera.lookAt(playerRoot.position);
}

// =============================================================================
// UI: ВЫБОР ПЕРСОНАЖА И СТАРТ
// =============================================================================


function selectCharacter(characterId) {
  state.selectedCharacterId = characterId;
  const cfg = CHARACTER_CONFIG[characterId];

  ui.characterGrid.querySelectorAll('.char-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.character === characterId);
  });

  ui.selectedCharLabel.innerHTML = `Выбран: <strong>${cfg.displayName}</strong>`;

  // Назначаем currentPlayerModel и показываем предпросмотр на сцене
  mountPlayerModel(characterId);
  if (!playerRoot.parent) scene.add(playerRoot);
  playerRoot.position.set(0, 0, -3);
}

function startGame() {
  document.getElementById('character-selection').classList.add('hidden');
  ui.gameUi.classList.remove('hidden');

  state.gameStarted = true;
  state.isPlaying = true;

  resetSpawnDifficulty();
  addPlayerToScene();
  spawnTrainsOnGameStart();

  clock.getDelta();
}

// =============================================================================
// ПЕРЕЗАПУСК
// =============================================================================

function resetGameState() {
  state.isPlaying = true;
  state.distance = 0;
  state.score = 0;
  state.keys.left = false;
  state.keys.right = false;
  state.keys.space = false;

  ui.score.textContent = '0';
  ui.distance.textContent = '0';
  ui.gameOver.classList.add('hidden');

  clearObstacles();
  resetRoadPositions();
  mountPlayerModel(state.selectedCharacterId);
  resetPlayerTransform();
  resetSpawnDifficulty();
  spawnTrainsOnGameStart();

  clock.getDelta();
}

function restartGame() {
  resetGameState();

  if (animationId !== null) cancelAnimationFrame(animationId);
  animate();
}

// =============================================================================
// ВВОД
// =============================================================================

function initInput() {
  window.addEventListener('keydown', (e) => {
    if (!state.isPlaying) return;

    if (e.key === 'ArrowLeft') state.keys.left = true;
    if (e.key === 'ArrowRight') state.keys.right = true;

    if (e.code === 'Space') {
      e.preventDefault();
      state.keys.space = true;
    }
  });

  ui.characterGrid.querySelectorAll('.char-btn').forEach((btn) => {
    btn.addEventListener('click', () => selectCharacter(btn.dataset.character));
  });

  ui.startBtn.addEventListener('click', startGame);
  ui.restartBtn.addEventListener('click', restartGame);
  window.addEventListener('resize', onResize);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// =============================================================================
// ИГРОВОЙ ЦИКЛ
// =============================================================================

function animate() {
  animationId = requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);

  // Меню выбора: лёгкий предпросмотр сцены (вращение камеры)
  if (!state.gameStarted) {
    if (playerMixer) playerMixer.update(delta);
    camera.position.set(0, 5, 10);
    camera.lookAt(playerRoot.position);
    renderer.render(scene, camera);
    return;
  }

  if (!state.isPlaying) return;

  updatePlayer(delta);
  updateRoad(delta);
  updateObstacles(delta);
  updateScore(delta);
  checkCollisions();
  updateCamera();

  renderer.render(scene, camera);
}

// =============================================================================
// СТАРТ ПРИЛОЖЕНИЯ
// =============================================================================

async function init() {
  initLights();
  initInput();
  onResize();
  animate();

  let summary = { successCount: 0, failCount: TOTAL_MODEL_FILES };

  try {
    summary = await preloadAssets();
  } catch (err) {
    console.error('[Init] Ошибка предзагрузки:', err);
  } finally {
    // Меню показываем всегда — даже если preload упал или завис
    finishLoadingAndShowCharacterSelect(summary);
  }
}

window.playAnimation = playAnimation;

init();
