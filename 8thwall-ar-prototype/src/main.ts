import './styles.css'

import * as THREE from 'three'
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TorusKnotGeometry,
  Vector3,
} from 'three'

;(window as Window & {THREE?: typeof THREE}).THREE = THREE

type AnchorSample = {
  timestamp: number
  position: any
  rotation: any
  scale: number
}

type ImageTargetObservation = ImageTargetEventDetail & {
  timestamp: number
}

const config = {
  imageTargetUrl: './image-targets/marina-target/marina-target.json',
  imageTargetName: 'marina-target',
  targetPhysicalWidthMeters: 0.297,
  targetPhysicalHeightMeters: 0.42,
  sculptureScale: 0.45,
  sculptureYawOffsetDeg: 180,
  sculptureHeightOffsetMeters: 0.7,
  previewDistanceMeters: 0.02,
  previewHeightOffsetMeters: 0,
  stabilizationSamplesNeeded: 8,
  stabilizationWindowMs: 1800,
  stabilizationPositionToleranceMeters: 0.06,
  recalibrationAlpha: 0.08,
  forwardAxisFromTarget: new Vector3(0, 0, -1),
}
const debugMode = new URLSearchParams(window.location.search).get('debug') === '1'

const targetPosition = new Vector3()
const targetRotation = new Quaternion()
const worldCandidatePosition = new Vector3()
const worldCandidateRotation = new Quaternion()
const worldCandidateScale = new Vector3()
const helperVector = new Vector3()
const correctionPosition = new Vector3()
const projectedAnchor = new Vector3()

let camera: any = null
let worldAnchor: any = null
let targetGhost: any = null
let detectionBeacon: any = null
let currentDistanceMeters = 0.5
let lastObservation: ImageTargetObservation | null = null
let lastStableObservation: ImageTargetObservation | null = null
let anchorSamples: AnchorSample[] = []
let anchorLocked = false
let targetVisible = false
let trackingStatus = 'INITIALIZING'
let trackingReason = 'UNSPECIFIED'
let lastRecalibrationMeters = 0
let lastObservedTargetWidth = 0
let lastObservedTargetHeight = 0
let hasVideo = false

const statusText = must<HTMLParagraphElement>('#status-text')
const diagnostics = must<HTMLElement>('#diagnostics')
const resetButton = must<HTMLButtonElement>('#reset-button')
const directionIndicator = must<HTMLElement>('#direction-indicator')
const directionArrow = must<HTMLElement>('.direction-indicator__arrow')
const errorOverlay = must<HTMLElement>('#error-overlay')
const errorMessage = must<HTMLElement>('#error-message')
const distanceButtons = [...document.querySelectorAll<HTMLButtonElement>('#distance-buttons button')]

document.body.classList.toggle('debug-ui', debugMode)

distanceButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const nextDistance = Number(button.dataset.distance)
    if (!Number.isFinite(nextDistance)) return
    currentDistanceMeters = nextDistance
    distanceButtons.forEach((candidate) => {
      candidate.classList.toggle('is-active', candidate === button)
    })
    if (lastStableObservation && worldAnchor) {
      snapAnchorFromObservation(lastStableObservation, anchorLocked ? 'blend' : 'immediate', !anchorLocked)
    }
    renderDiagnostics()
  })
})

resetButton.addEventListener('click', () => {
  anchorSamples = []
  anchorLocked = false
  targetVisible = false
  lastStableObservation = null
  lastRecalibrationMeters = 0
  if (worldAnchor) {
    worldAnchor.visible = false
  }
  setStatus('Reinicio manual completado. Vuelve a enfocar el target hasta estabilizarlo.')
  renderDiagnostics()
})

const onXrLoaded = async () => {
  const response = await fetch(config.imageTargetUrl)
  if (!response.ok) {
    throw new Error(`No se pudo cargar el target: ${config.imageTargetUrl}`)
  }
  const imageTargetData = await response.json()

  window.XR8?.XrController.configure({
    disableWorldTracking: false,
    enableLighting: true,
    scale: 'absolute',
    imageTargetData: [imageTargetData],
  })

  window.XR8?.addCameraPipelineModules([
    window.XR8.GlTextureRenderer.pipelineModule(),
    window.XR8.Threejs.pipelineModule(),
    window.XR8.XrController.pipelineModule(),
    createPrototypePipelineModule(),
  ])

  window.XR8?.run({
    canvas: must<HTMLCanvasElement>('#camerafeed'),
  })
}

if (window.XR8) {
  void onXrLoaded().catch(handleFatalError)
} else {
  window.addEventListener('xrloaded', () => {
    void onXrLoaded().catch(handleFatalError)
  }, {once: true})
}

function createPrototypePipelineModule(): CameraPipelineModule {
  return {
    name: 'marina-prototype',
    onBeforeRun: () => {
      window.setTimeout(() => {
        if (!hasVideo) {
          showError(
            'La camara no ha arrancado. Abre este enlace directamente en Chrome o Safari, acepta los permisos de camara y evita abrirlo dentro de una previsualizacion del chat.',
          )
        }
      }, 6000)
    },
    onCameraStatusChange: ({status}: {status: string}) => {
      if (status === 'hasVideo') {
        hasVideo = true
        hideError()
        return
      }

      if (status === 'failed') {
        showError(
          'Chrome no pudo abrir la camara para esta experiencia. Revisa el permiso de camara del sitio y vuelve a abrir el enlace en una pestana normal del navegador.',
        )
      }
    },
    onStart: () => {
      const xrScene = window.XR8?.Threejs.xrScene()
      if (!xrScene) return
      camera = xrScene.camera
      xrScene.scene.background = null
      buildScene(xrScene.scene)
      setStatus('Motor XR listo. Enfoca la imagen y muévete un poco para estimar escala real.')
      renderDiagnostics()
    },
    onException: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Fallo desconocido al iniciar 8th Wall.'
      showError(message)
      console.error(error)
    },
    onUpdate: ({processCpuResult}) => {
      trackingStatus = processCpuResult.reality?.trackingStatus ?? trackingStatus
      trackingReason = processCpuResult.reality?.trackingReason ?? trackingReason
      updateIndicator()
      renderDiagnostics()
    },
    listeners: [
      {event: 'reality.imagefound', process: (event) => consumeObservation(toObservation(event), true)},
      {event: 'reality.imageupdated', process: (event) => consumeObservation(toObservation(event), false)},
      {
        event: 'reality.imagelost',
        process: () => {
          targetVisible = false
          if (!anchorLocked && worldAnchor) {
            worldAnchor.visible = false
          }
          setStatus(
            anchorLocked
              ? 'Target fuera de cámara. La escultura sigue anclada en SLAM.'
              : 'Target perdido antes de estabilizar. Vuelve a enfocarlo.',
          )
          updateIndicator()
          renderDiagnostics()
        },
      },
    ],
  }
}

function buildScene(currentScene: any) {
  const ambient = new AmbientLight(0xffffff, 1.35)
  const key = new DirectionalLight(0xffffff, 1.4)
  key.position.set(2, 4, 3)
  currentScene.add(ambient, key)

  worldAnchor = new Group()
  worldAnchor.visible = false

  const sculptureRoot = new Group()
  sculptureRoot.scale.setScalar(config.sculptureScale)
  sculptureRoot.rotateY((config.sculptureYawOffsetDeg * Math.PI) / 180)

  const body = new Mesh(
    new TorusKnotGeometry(0.38, 0.11, 160, 24),
    new MeshStandardMaterial({
      color: new Color('#c2f0ff'),
      metalness: 0.38,
      roughness: 0.26,
      emissive: new Color('#0a4663'),
      emissiveIntensity: 0.42,
    }),
  )
  body.position.y = 1.08

  const base = new Mesh(
    new BoxGeometry(0.9, 0.16, 0.9),
    new MeshStandardMaterial({
      color: new Color('#1c2f4f'),
      metalness: 0.15,
      roughness: 0.72,
    }),
  )
  base.position.y = 0.08

  const beacon = new Mesh(
    new SphereGeometry(0.08, 24, 24),
    new MeshStandardMaterial({
      color: new Color('#6ce2ff'),
      emissive: new Color('#13b7ff'),
      emissiveIntensity: 1.5,
      metalness: 0.05,
      roughness: 0.25,
    }),
  )
  beacon.position.set(0, 2.15, 0)

  sculptureRoot.add(base, body, beacon)
  worldAnchor.add(sculptureRoot)

  detectionBeacon = new Group()
  detectionBeacon.visible = false

  const beaconPlane = new Mesh(
    new PlaneGeometry(0.26, 0.38),
    new MeshBasicMaterial({
      color: new Color('#00f6ff'),
      transparent: true,
      opacity: 0.92,
    }),
  )

  const beaconCore = new Mesh(
    new SphereGeometry(0.045, 20, 20),
    new MeshBasicMaterial({
      color: new Color('#ff3bd4'),
    }),
  )
  beaconCore.position.z = 0.03

  detectionBeacon.add(beaconPlane, beaconCore)
  worldAnchor.add(detectionBeacon)
  currentScene.add(worldAnchor)

  targetGhost = new Group()
  const targetMarker = new Mesh(
    new BoxGeometry(0.32, 0.45, 0.006),
    new MeshStandardMaterial({
      color: new Color('#ff8d7a'),
      transparent: true,
      opacity: 0.35,
    }),
  )
  targetGhost.add(targetMarker)
  targetGhost.visible = false
  currentScene.add(targetGhost)
}

function consumeObservation(observation: ImageTargetObservation, isFirstFound: boolean) {
  if (observation.name !== config.imageTargetName) {
    return
  }

  targetVisible = true
  lastObservation = observation
  lastObservedTargetWidth = observation.scaledWidth ?? lastObservedTargetWidth
  lastObservedTargetHeight = observation.scaledHeight ?? lastObservedTargetHeight

  updateTargetGhost(observation)

  if (!anchorLocked) {
    // Keep a visible preview on screen while the target stabilizes.
    snapAnchorFromObservation(observation, 'immediate', true)
    pruneSamples(observation.timestamp)
    anchorSamples.push(anchorSampleFromObservation(observation))

    if (anchorSamples.length >= config.stabilizationSamplesNeeded && sampleWindowIsStable(anchorSamples)) {
      lastStableObservation = observation
      snapAnchorFromObservation(observation, 'immediate', false)
      anchorLocked = true
      setStatus(
        `Target estabilizado. Escultura anclada a ${currentDistanceMeters.toFixed(1)} m y mantenida por SLAM.`,
      )
    } else {
      setStatus(
        isFirstFound
          ? 'Target detectado. Mantén el encuadre estable y avanza/retrocede suavemente.'
          : `Estabilizando referencia (${anchorSamples.length}/${config.stabilizationSamplesNeeded})...`,
      )
    }
  } else {
    lastStableObservation = observation
    snapAnchorFromObservation(observation, 'blend', false)
    setStatus('Target reacquirido. Recalibrando suavemente sin saltos visibles.')
  }

  updateIndicator()
  renderDiagnostics()
}

function updateTargetGhost(observation: ImageTargetObservation) {
  if (!targetGhost) return
  targetGhost.visible = true
  targetGhost.position.set(observation.position.x, observation.position.y, observation.position.z)
  targetGhost.quaternion.set(
    observation.rotation.x,
    observation.rotation.y,
    observation.rotation.z,
    observation.rotation.w,
  )
  targetGhost.scale.setScalar(observation.scale)
}

function snapAnchorFromObservation(
  observation: ImageTargetObservation,
  mode: 'immediate' | 'blend',
  usePreviewPlacement: boolean,
) {
  if (!worldAnchor) return

  targetPosition.set(observation.position.x, observation.position.y, observation.position.z)
  targetRotation.set(
    observation.rotation.x,
    observation.rotation.y,
    observation.rotation.z,
    observation.rotation.w,
  )
  const distanceMeters = usePreviewPlacement ? config.previewDistanceMeters : currentDistanceMeters
  const heightOffsetMeters = usePreviewPlacement
    ? config.previewHeightOffsetMeters
    : config.sculptureHeightOffsetMeters

  helperVector.copy(config.forwardAxisFromTarget)
  helperVector.applyQuaternion(targetRotation).normalize().multiplyScalar(distanceMeters)

  worldCandidatePosition.copy(targetPosition)
  worldCandidatePosition.add(helperVector)
  worldCandidatePosition.y += heightOffsetMeters
  worldCandidateRotation.copy(targetRotation)
  worldCandidateScale.setScalar(1)

  if (mode === 'immediate' || !worldAnchor.visible) {
    worldAnchor.position.copy(worldCandidatePosition)
    worldAnchor.quaternion.copy(worldCandidateRotation)
  } else {
    correctionPosition.copy(worldAnchor.position)
    correctionPosition.lerp(worldCandidatePosition, config.recalibrationAlpha)
    worldAnchor.position.copy(correctionPosition)
    worldAnchor.quaternion.slerp(worldCandidateRotation, config.recalibrationAlpha)
    lastRecalibrationMeters = worldAnchor.position.distanceTo(worldCandidatePosition)
  }

  worldAnchor.scale.copy(worldCandidateScale)
  worldAnchor.visible = true
  if (detectionBeacon) {
    detectionBeacon.visible = usePreviewPlacement
  }
}

function pruneSamples(now: number) {
  anchorSamples = anchorSamples.filter((sample) => now - sample.timestamp <= config.stabilizationWindowMs)
}

function anchorSampleFromObservation(observation: ImageTargetObservation): AnchorSample {
  return {
    timestamp: observation.timestamp,
    position: new Vector3(observation.position.x, observation.position.y, observation.position.z),
    rotation: new Quaternion(
      observation.rotation.x,
      observation.rotation.y,
      observation.rotation.z,
      observation.rotation.w,
    ),
    scale: observation.scale,
  }
}

function sampleWindowIsStable(samples: AnchorSample[]): boolean {
  if (samples.length < config.stabilizationSamplesNeeded) {
    return false
  }

  const meanPosition = samples.reduce((accumulator, sample) => accumulator.add(sample.position), new Vector3())
  meanPosition.multiplyScalar(1 / samples.length)

  const furthestDeviation = samples.reduce((max, sample) => (
    Math.max(max, sample.position.distanceTo(meanPosition))
  ), 0)

  return furthestDeviation <= config.stabilizationPositionToleranceMeters
}

function updateIndicator() {
  if (!debugMode) {
    directionIndicator.classList.add('is-hidden')
    return
  }

  if (!camera || !worldAnchor || !worldAnchor.visible) {
    directionIndicator.classList.add('is-hidden')
    return
  }

  projectedAnchor.copy(worldAnchor.position).project(camera)
  const isInsideViewport =
    projectedAnchor.z < 1 &&
    projectedAnchor.z > -1 &&
    Math.abs(projectedAnchor.x) <= 1 &&
    Math.abs(projectedAnchor.y) <= 1

  if (isInsideViewport) {
    directionIndicator.classList.add('is-hidden')
    return
  }

  const angle = Math.atan2(projectedAnchor.x, -projectedAnchor.y) * (180 / Math.PI)
  directionArrow.style.transform = `rotate(${angle}deg)`
  directionIndicator.classList.remove('is-hidden')
}

function renderDiagnostics() {
  const ageMs = lastObservation ? Math.max(0, performance.now() - lastObservation.timestamp) : Number.NaN
  const anchorDistance =
    worldAnchor && camera && worldAnchor.visible ? worldAnchor.position.distanceTo(camera.position) : Number.NaN

  const rows: Array<[string, string]> = [
    ['Tracking SLAM', `${trackingStatus} / ${trackingReason}`],
    ['Target visible', targetVisible ? 'si' : 'no'],
    ['Anchor locked', anchorLocked ? 'si' : 'no'],
    ['Distancia offset', `${currentDistanceMeters.toFixed(1)} m`],
    ['Muestras estables', `${anchorSamples.length}/${config.stabilizationSamplesNeeded}`],
    ['Ultima vision', Number.isFinite(ageMs) ? `${Math.round(ageMs)} ms` : 'sin dato'],
    [
      'Tamano target observado',
      lastObservedTargetWidth > 0 && lastObservedTargetHeight > 0
        ? `${lastObservedTargetWidth.toFixed(3)} x ${lastObservedTargetHeight.toFixed(3)} m`
        : 'sin dato',
    ],
    [
      'Tamano target esperado',
      `${config.targetPhysicalWidthMeters.toFixed(3)} x ${config.targetPhysicalHeightMeters.toFixed(3)} m`,
    ],
    ['Correccion suave', `${lastRecalibrationMeters.toFixed(3)} m`],
    ['Camara -> escultura', Number.isFinite(anchorDistance) ? `${anchorDistance.toFixed(2)} m` : 'sin dato'],
  ]

  diagnostics.innerHTML = rows
    .map(([term, value]) => `<dt>${term}</dt><dd>${value}</dd>`)
    .join('')
}

function toObservation(event: {detail?: unknown; data?: unknown}): ImageTargetObservation {
  const detail = ((event.detail ?? event.data) as ImageTargetEventDetail | undefined)
  if (!detail) {
    throw new Error('Evento de target sin detail/data')
  }
  return {
    ...detail,
    timestamp: performance.now(),
  }
}

function setStatus(message: string) {
  statusText.textContent = message
}

function handleFatalError(error: unknown) {
  console.error(error)
  const message = error instanceof Error ? error.message : 'Error desconocido al iniciar XR.'
  setStatus(message)
  showError(message)
}

function must<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) {
    throw new Error(`No se encontro el elemento ${selector}`)
  }
  return element
}

function showError(message: string) {
  errorMessage.textContent = message
  errorOverlay.classList.remove('is-hidden')
}

function hideError() {
  errorOverlay.classList.add('is-hidden')
}
