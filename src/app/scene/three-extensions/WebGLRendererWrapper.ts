import { isUndefined } from 'lodash';
import type { WebGLRendererParameters } from 'three';
import { Color, WebGLRenderer, WebGLRenderTarget, OrthographicCamera, PlaneGeometry, ShaderMaterial, Mesh, Scene, Object3D } from 'three';

import log from '../../lib/log';
import Detector from './Detector';

type WebGLRendererOptions = WebGLRendererParameters & {
    clearColor?: Color;
    clearAlpha?: number;
}

/**
 * Simple wrapper of WebGLRenderer.
 *
 * Given basic renderer method mirrors and default configuration.
 */
class WebGLRendererWrapper {
    private renderer: WebGLRenderer;
    private renderTarget: WebGLRenderTarget;
    private orthoCamera: OrthographicCamera;
    private quadGeometry: PlaneGeometry;
    private quadMaterial: ShaderMaterial;
    private quadMesh: Mesh;
    private postScene: Scene;
    private currentWidth: number = 0;
    private currentHeight: number = 0;

    // Fixed layer IDs for rendering passes
    private readonly ENVIRONMENT_LAYER = 0;
    private readonly PROTECTED_LAYER = 1;

    public constructor(options: WebGLRendererOptions) {
        if (Detector.isWebGLAvailable()) {
            this.renderer = new WebGLRenderer(options);

            if (options.clearColor) {
                this.renderer.setClearColor(options.clearColor);
            } else {
                this.renderer.setClearColor(new Color(0xF5F5F7), 1);
            }

            if (!isUndefined(options.clearAlpha)) {
                this.setClearAlpha(options.clearAlpha);
            }

            this.renderer.shadowMap.enabled = true;
            this.renderer.localClippingEnabled = true;

            this.orthoCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
            this.quadGeometry = new PlaneGeometry(2, 2);
            this.postScene = new Scene();
        } else {
            this.renderer = null;
        }
    }

    private initInversionPass(width: number, height: number): void {
        if (this.renderTarget) {
            this.renderTarget.dispose();
        }
        if (this.quadMaterial) {
            this.quadMaterial.dispose();
        }
        if (this.quadMesh) {
            this.postScene.remove(this.quadMesh);
        }

        this.currentWidth = width;
        this.currentHeight = height;
        this.renderTarget = new WebGLRenderTarget(width, height, {
            depthBuffer: true,
            stencilBuffer: true
        });

        this.quadMaterial = new ShaderMaterial({
            uniforms: {
                tDiffuse: { value: this.renderTarget.texture }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                varying vec2 vUv;
                void main() {
                    vec4 texel = texture2D(tDiffuse, vUv);
                    vec3 raw = texel.rgb;

                    float r = 1.0 - (-0.574 * raw.r + 1.430 * raw.g + 0.144 * raw.b);
                    float g = 1.0 - (0.426 * raw.r + 0.430 * raw.g + 0.144 * raw.b);
                    float b = 1.0 - (0.426 * raw.r + 1.430 * raw.g - 0.856 * raw.b);

                    gl_FragColor = vec4(clamp(vec3(r, g, b), 0.0, 1.0), texel.a);
                }
            `
        });

        this.quadMesh = new Mesh(this.quadGeometry, this.quadMaterial);
        this.postScene.add(this.quadMesh);
    }

    /**
     * Traverses the scene to route specific meshes into rendering layers.
     */
    private updateSceneLayers(scene: Scene): void {
        scene.traverse((obj: Object3D) => {
            const isProtected = obj.name === 'Model Group'
                || obj.name === 'Brush Mesh'
                || (obj.name && obj.name.indexOf('GCode') !== -1);

            // Temporarily print anything that isn't already grouped on the protected layer
            /*if (!isProtected && obj.name && !obj.layers.test(this.PROTECTED_LAYER)) {
                console.log('Active Canvas Object Name:', obj.name, 'Type:', obj.type);
            }*/

            if (isProtected) {
                obj.traverse((child: Object3D) => {
                    child.layers.set(this.PROTECTED_LAYER);
                });
            } else if (obj.layers.test(this.PROTECTED_LAYER)) {
                let isChildOfProtectedGroup = false;
                let currentParent = obj.parent;
                while (currentParent) {
                    const isParentProtected = currentParent.name === 'Model Group'
                        || currentParent.name === 'Brush Mesh'
                        || (currentParent.name && currentParent.name.indexOf('GCode') !== -1);

                    if (isParentProtected) {
                        isChildOfProtectedGroup = true;
                        break;
                    }
                    currentParent = currentParent.parent;
                }
                if (!isChildOfProtectedGroup) {
                    obj.layers.set(this.ENVIRONMENT_LAYER);
                }
            }
        });
    }

    /**
     * Traverses the scene graph to invert all active light colors.
     */
    private invertSceneLights(scene: Scene): void {
        scene.traverse((obj: any) => {
            if (obj.isLight && obj.color) {
                obj.color.r = 1.0 - obj.color.r;
                obj.color.g = 1.0 - obj.color.g;
                obj.color.b = 1.0 - obj.color.b;
            }
        });
    }

    public isInitialized(): boolean {
        return !!this.renderer;
    }

    public get domElement() {
        return this.renderer.domElement;
    }

    public setClearColor(color: Color | string | number, alpha?: number): void {
        this.renderer.setClearColor(color, alpha);
    }

    public setClearAlpha(alpha: number): void {
        this.renderer.setClearAlpha(alpha);
    }

    public setSize(width: number, height: number): void {
        if (this.renderer) {
            this.renderer.setSize(width, height);
            if (width !== this.currentWidth || height !== this.currentHeight) {
                this.initInversionPass(width, height);
            }
        }
    }

    public setSortObjects(bool) {
        this.renderer.sortObjects = bool;
    }

    public render(scene, camera) {
        const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

        if (!isDarkMode || !this.renderTarget) {
            camera.layers.enableAll();
            this.renderer.setRenderTarget(null);
            this.renderer.render(scene, camera);
            return;
        }

        this.updateSceneLayers(scene);

        this.invertSceneLights(scene);

        const originalMask = camera.layers.mask;

        // --- PASS 1: Isolate and Render Background/Tools Only ---
        camera.layers.set(this.ENVIRONMENT_LAYER);
        this.renderer.setRenderTarget(this.renderTarget);
        this.renderer.render(scene, camera);

        // --- PASS 2: Output Inverted Quad Background ---
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.postScene, this.orthoCamera);

        this.invertSceneLights(scene);

        // --- PASS 3: Overlay Protected Elements natively over background ---
        camera.layers.set(this.PROTECTED_LAYER);
        this.renderer.autoClear = false;
        this.renderer.clearDepth();
        this.renderer.render(scene, camera);
        this.renderer.autoClear = true;

        camera.layers.mask = originalMask;
    }

    public dispose() {
        if (!this.renderer) {
            return;
        }
        try {
            if (this.renderTarget) {
                this.renderTarget.dispose();
            }
            if (this.quadMaterial) {
                this.quadMaterial.dispose();
            }
            if (this.quadGeometry) {
                this.quadGeometry.dispose();
            }
            this.renderer.forceContextLoss();
            this.renderer.domElement = null;
            this.renderer.dispose();
            this.renderer = null;
        } catch (e) {
            log.warn(e);
        }
    }
}

export default WebGLRendererWrapper;
