declare module '*.css'
declare module 'three'

declare global {
  interface Window {
    XR8?: XR8
  }

  type Vec3Like = {x: number; y: number; z: number}
  type QuatLike = {x: number; y: number; z: number; w: number}

  type ImageTargetEventDetail = {
    name: string
    position: Vec3Like
    rotation: QuatLike
    scale: number
    scaledWidth?: number
    scaledHeight?: number
  }

  type CameraPipelineModule = {
    name: string
    onStart?: () => void
    onUpdate?: (args: {
      processCpuResult: {
        reality?: {
          trackingStatus?: string
          trackingReason?: string
          position?: Vec3Like
        }
      }
    }) => void
    listeners?: Array<{
      event: string
      process: (event: {name: string; detail?: unknown; data?: unknown}) => void
    }>
  }

  type XR8 = {
    GlTextureRenderer: {pipelineModule: () => CameraPipelineModule}
    Threejs: {
      pipelineModule: () => CameraPipelineModule
      xrScene: () => {
        scene: import('three').Scene
        camera: import('three').PerspectiveCamera
        renderer: import('three').WebGLRenderer
      }
    }
    XrController: {
      configure: (config: {
        disableWorldTracking?: boolean
        enableLighting?: boolean
        scale?: 'responsive' | 'absolute'
        imageTargetData?: unknown[]
      }) => void
      pipelineModule: () => CameraPipelineModule
    }
    addCameraPipelineModules: (modules: CameraPipelineModule[]) => void
    run: (config: {canvas: HTMLCanvasElement}) => void
  }
}

export {}
