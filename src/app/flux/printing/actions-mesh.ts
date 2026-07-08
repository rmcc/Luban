import path from 'path';
import {
    BufferAttribute,
    BufferGeometry,
    DoubleSide,
    Mesh,
    MeshPhongMaterial,
} from 'three';

import api from '../../api';
import { DATA_PREFIX } from '../../constants';
import { HEAD_PRINTING } from '../../constants/machines';
import { controller } from '../../communication/socket-communication';
import log from '../../lib/log';
import workerManager from '../../lib/manager/workerManager';
import ModelGroup from '../../models/ModelGroup';
import { ExtruderConfig, ModelTransformation, TSize } from '../../models/ThreeBaseModel';
import ThreeModel from '../../models/ThreeModel';
import ModelExporter from '../../ui/widgets/PrintingVisualizer/ModelExporter';

export declare interface MeshFileInfo {
    originalName: string; // file original name
    uploadName: string; // file upload name
    modelName?: string;

    isGroup: boolean;

    modelID?: string;
    parentUploadName?: string;
    children?: object[];
    baseName?: string;
}

interface UploadMeshOptions {
    fileType?: string;
    uploadName?: string;
}

/**
 * Upload Mesh object.
 */
const uploadMesh = async (mesh: Mesh, fileName: string, options?: UploadMeshOptions) => {
    // From ThreeModel:
    // BYTE_COUNT_COLOR_MASK, BYTE_COUNT_LEFT_EXTRUDER, BYTE_COUNT_RIGHT_EXTRUDER
    // We can't use them directly, it hangs app startup. Circular dependency?
    const MASK_COLOR = 0xff00;
    const EXTRUDER_LEFT = 0x0100;
    const EXTRUDER_RIGHT = 0x0200;

    const fileType = options?.fileType || 'stl';
    const geometry = mesh.geometry;
    const byteCountAttr = geometry.getAttribute('byte_count');
    const positionAttr = geometry.getAttribute('position');

    let finalUploadResult = null;

    // The editor uses a per-face coloring hack by tagging each bytecount field
    // with a "this is painted" flag on dual-extrusion. If we find that, let's
    // turn it into Cura's MaterialSplitter syntax

    if (byteCountAttr && positionAttr && fileType.toLowerCase() === 'stl') {
        const indexAttr = geometry.index;
        const totalFaces = indexAttr !== null ? (indexAttr.count / 3) : (positionAttr.count / 3);

        // CuraEngine takes the "painted areas" map as a texture map in a PNG.
        // Let's make that PNG, and its corresponding UV coordinate map.
        //
        // For each face in the model, the PNG will have a 16x16 square,
        // with the red channel containing just the extruder ID (0 or 1). The
        // other channels are irrelevant, so we'll leave them black.
        // The UV map will point each of those faces' three vertices to a fixed,
        // uniform right-angle triangle mapped completely inside that 16x16 square.
        // CuraEngine will sample the pixels bounded by this 2D triangle area
        // to read the extruder ID (value of red channel) for that face.

        const columns = Math.ceil(Math.sqrt(totalFaces));
        const rows = Math.ceil(totalFaces / columns);
        const cellSize = 16;
        const imgWidth = columns * cellSize;
        const imgHeight = rows * cellSize;

        const totalVertices = totalFaces * 3;
        const uvBufferLength = 4 + (totalVertices * 2 * 4);
        const uvArrayBuffer = new ArrayBuffer(uvBufferLength);
        const uvView = new DataView(uvArrayBuffer);

        uvView.setUint32(0, totalVertices, true);
        let uvOffset = 4; // Start coordinate writes at offset 4

        // Allocate flat raw byte buffer for direct array manipulation
        const rawPixelBytes = new Uint8Array(imgWidth * imgHeight * 4);

        // Precompute dimensions and scaling factor inverses to avoid slow division inside the loop
        const pad = 0.5;
        const invWidth = 1 / imgWidth;
        const invHeight = 1 / imgHeight;
        const padX = pad * invWidth;
        const padY = pad * invHeight;
        const cellW = cellSize * invWidth;
        const cellH = cellSize * invHeight;

        for (let faceIndex = 0; faceIndex < totalFaces; faceIndex++) {
            // Read the Luban byteCount coloring flag
            const byteCount = byteCountAttr.array[faceIndex] || 0;
            const byteCountColor = (byteCount & MASK_COLOR);

            // Isolate target extruder number (0 for T0, 1 for T1)
            let extruderId = 0;

            if (byteCountColor === EXTRUDER_LEFT) {
                extruderId = 0;
            } else if (byteCountColor === EXTRUDER_RIGHT) {
                extruderId = 1;
            }

            const col = faceIndex % columns;
            const row = Math.floor(faceIndex / columns);
            const startX = col * cellSize;
            const startY = row * cellSize;

            // Build the PNG's 16x16 square for this face
            for (let cy = 0; cy < cellSize; cy++) {
                const pixelStartIndex = ((startY + cy) * imgWidth + startX) * 4;
                const pixelEndIndex = pixelStartIndex + (cellSize * 4);

                // Zero out the entire row of pixels inside the cell first
                rawPixelBytes.fill(0, pixelStartIndex, pixelEndIndex);

                // Set the specific Red and Alpha bytes across the 16 pixels
                for (let cx = 0; cx < cellSize; cx++) {
                    const idx = pixelStartIndex + (cx * 4);
                    rawPixelBytes[idx] = extruderId; // Red Channel: Stores literal 0 or 1 byte
                    rawPixelBytes[idx + 3] = 255; // Alpha Channel: Fully opaque to guarantee zero compression losses from anti-aliasing
                }
            }

            // Now write vertex A, B, and C (u, v) as raw 32-bit floats for the map
            const uStart = startX * invWidth;
            const vStart = startY * invHeight;

            // Vertex A
            uvView.setFloat32(uvOffset, uStart + padX, true); uvOffset += 4;
            uvView.setFloat32(uvOffset, vStart + padY, true); uvOffset += 4;

            // Vertex B
            uvView.setFloat32(uvOffset, uStart + cellW - padX, true); uvOffset += 4;
            uvView.setFloat32(uvOffset, vStart + padY, true); uvOffset += 4;

            // Vertex C
            uvView.setFloat32(uvOffset, uStart, true); uvOffset += 4;
            uvView.setFloat32(uvOffset, vStart + cellH - padY, true); uvOffset += 4;
        }
        // upload a clean STL file, with the coloring flags stripped out so
        // Luban doesn't try to use the custom MultiMaterialSegmentation code. We
        // want Cura's variant.
        const stl = new ModelExporter().parse(mesh, fileType, true, { clean: true });
        const blob = new Blob([stl], { type: 'application/octet-stream' });
        const fileOfBlob = new File([blob], fileName);

        const stlFormData = new FormData();
        stlFormData.append('file', fileOfBlob);
        if (options?.uploadName) {
            stlFormData.append('uploadName', options.uploadName);
        }

        finalUploadResult = await api.uploadFile(stlFormData, HEAD_PRINTING);

        // CuraEngine searches for files with the exact same name but different extensions
        // to determine if there is coloring to be applied. So get the name our file got
        // after uploading and use it.
        let baselineUploadName = finalUploadResult.body.uploadName;
        if (baselineUploadName.toLowerCase().endsWith('.stl')) {
            baselineUploadName = baselineUploadName.substring(0, baselineUploadName.lastIndexOf('.'));
        }

        const uvUploadName = `${baselineUploadName}.uv`;
        const pngUploadName = `${baselineUploadName}.png`;
        const baseName = fileName.substring(0, fileName.lastIndexOf('.'));

        // Upload the UV coordinate map as a raw binary
        const uvBlob = new Blob([uvArrayBuffer], { type: 'application/octet-stream' });
        const uvFile = new File([uvBlob], `${baseName}.uv`);

        const uvFormData = new FormData();
        uvFormData.append('file', uvFile);
        uvFormData.append('uploadName', uvUploadName);

        await api.uploadFile(uvFormData, HEAD_PRINTING);

        // Write the raw byte array into a canvas context to generate the PNG
        const canvas = new OffscreenCanvas(imgWidth, imgHeight);
        const ctx = canvas.getContext('2d')!;
        const imgData = ctx.createImageData(imgWidth, imgHeight);
        imgData.data.set(rawPixelBytes);
        ctx.putImageData(imgData, 0, 0);

        const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
        const pngArrayBuffer = await pngBlob.arrayBuffer();
        const pngBytes = new Uint8Array(pngArrayBuffer);

        // We have the PNG, build and inject the metadata
        const metadataObj = {
            'extruder': Array.of(24, 31) // In an RGBA set of 32 bits, we want the last 8
        };
        const jsonString = JSON.stringify(metadataObj);

        // Format a standard PNG tEXt chunk: "Description\0" + JSON string
        const keyStr = 'Description';

        // Encode metadata payloads directly using native text compilation
        const textEncoder = new TextEncoder();
        const keyBytes = textEncoder.encode(keyStr);
        const jsonBytes = textEncoder.encode(jsonString);
        const chunkDataLength = keyBytes.length + 1 + jsonBytes.length;

        // Length(4) + ChunkType(4) + Data(Length) + CRC(4)
        const textChunkBytes = new Uint8Array(4 + 4 + chunkDataLength + 4);
        const chunkView = new DataView(textChunkBytes.buffer);

        // Write chunk data size (big-endian)
        chunkView.setUint32(0, chunkDataLength, false);

        // Write chunk type keyword: "tEXt"
        chunkView.setUint32(4, 0x74455874, false);

        // Write key "Description" followed by a null terminator and the JSON payload via direct byte blitting
        textChunkBytes.set(keyBytes, 8);
        textChunkBytes[8 + keyBytes.length] = 0; // null terminator
        textChunkBytes.set(jsonBytes, 8 + keyBytes.length + 1);

        const textOffset = 8 + chunkDataLength;

        // mandatory CRC-32 checksum
        let crc = -1;
        // CRC checks run from chunk type (index 4) up to the start of the CRC field itself
        for (let i = 4; i < textOffset; i++) {
            let c = (crc ^ chunkView.getUint8(i)) & 0xFF;
            for (let k = 0; k < 8; k++) {
                c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
            }
            crc = c ^ (crc >>> 8);
        }
        const finalCrc = (crc ^ -1) >>> 0;
        chunkView.setUint32(textOffset, finalCrc, false);

        // Locate the end of the 8-byte signature + 25-byte IHDR chunk to inject metadata
        const ihdrEndOffset = 8 + 4 + 4 + 13 + 4; // Signature (8) + Len (4) + Type (4) + Data (13) + CRC (4)
        const finalPngBytes = new Uint8Array(pngBytes.length + textChunkBytes.length);

        // Stitch the final payload: [Signature + IHDR] + [tEXt Chunk] + [Rest of original PNG]
        finalPngBytes.set(pngBytes.subarray(0, ihdrEndOffset), 0);
        finalPngBytes.set(textChunkBytes, ihdrEndOffset);
        finalPngBytes.set(pngBytes.subarray(ihdrEndOffset), ihdrEndOffset + textChunkBytes.length);

        const modifiedPngBlob = new Blob(Array.of(finalPngBytes), { type: 'image/png' });
        const pngFile = new File(Array.of(modifiedPngBlob), `${baseName}.png`);

        const pngFormData = new FormData();
        pngFormData.append('file', pngFile);
        pngFormData.append('uploadName', pngUploadName);

        await api.uploadFile(pngFormData, HEAD_PRINTING);
    } else {
        // No coloring, just upload the file
        const stl = new ModelExporter().parse(mesh, fileType, true, { clean: false });
        const blob = new Blob([stl], { type: 'application/octet-stream' });
        const fileOfBlob = new File([blob], fileName);

        const fallbackFormData = new FormData();
        fallbackFormData.append('file', fileOfBlob);
        if (options?.uploadName) {
            fallbackFormData.append('uploadName', options.uploadName);
        }

        finalUploadResult = await api.uploadFile(fallbackFormData, HEAD_PRINTING);
    }

    return finalUploadResult;
};

/**
 * Check integrity of meshes.
 *
 * Note that this function is not an action actually.
 */
const checkMeshes = async (meshInfos: MeshFileInfo[]) => {
    const checkResultMap = new Map();

    for (const meshInfo of meshInfos) {
        // Ignore group
        if (meshInfo.isGroup) {
            continue;
        }

        // Ignore other extensions
        const ext = path.extname(meshInfo.uploadName);
        if (!['.obj', '.stl'].includes(ext)) {
            continue;
        }

        // Ignore prime tower (it's virtual mesh)
        if (meshInfo.uploadName.indexOf('prime_tower_') === 0) {
            continue;
        }

        await new Promise((resolve) => {
            controller.checkModel({
                uploadName: meshInfo.uploadName
            }, (data) => {
                if (data.type === 'error') {
                    checkResultMap.set(meshInfo.uploadName, {
                        isDamage: true,
                    });
                    resolve(true);
                } else if (data.type === 'success') {
                    checkResultMap.set(meshInfo.uploadName, {
                        isDamage: false,
                    });
                    resolve(true);
                }
            });
        });
    }

    return checkResultMap;
};

export const MeshHelper = {
    uploadMesh,
    checkMeshes,
};

/**
 * Synchronize mesh changes to file (Upload mesh).
 */
const synchronizeMeshFile = (model: ThreeModel) => {
    return async () => {
        // Upload mesh object with uploadName (unchanged)
        await MeshHelper.uploadMesh(
            model.meshObject,
            model.baseName,
            {
                uploadName: model.uploadName,
            }
        );

        return true;
    };
};

const createLoadModelWorker = ({ uploadPath, monoColor }, onMessage) => {
    const task = {
        worker: workerManager.loadModel({
            filePath: uploadPath,
            monoColor,
        }, (data) => {
            for (const fn of task.cbOnMessage) {
                if (typeof fn === 'function') {
                    fn(data);
                }
            }
        }),
        cbOnMessage: []
    };

    task.cbOnMessage.push(onMessage);
};

export type LoadMeshFileOptions = {
    headType: typeof HEAD_PRINTING;

    loadFrom: 0 | 1; // 0 or 1
    size?: TSize;
    mode?: string;

    sourceType: '3d',
    sourceWidth?: number;
    sourceHeight?: number;

    transformation?: ModelTransformation;

    parentModelID?: string;
    primeTowerTag?: boolean;
    extruderConfig?: ExtruderConfig;

    monoColor?: boolean;

    onProgress?: (progress: number) => void;
};

interface LoadMeshFilesResult {
    models: Array<ThreeModel>;
    promptTasks: Array<{
        status: string;
        originalName: string;
    }>;
}

export const loadMeshFiles = async (meshFileInfos: MeshFileInfo[], modelGroup: ModelGroup, options: LoadMeshFileOptions): Promise<LoadMeshFilesResult> => {
    const {
        headType,

        loadFrom,
        size,
        mode,

        sourceType,
        sourceWidth,
        sourceHeight,

        transformation,

        extruderConfig,

        parentModelID,
        primeTowerTag,

        monoColor = false,

        onProgress,
    } = options;

    let _progress = 0;
    const promptTasks = [];

    const promises = meshFileInfos.map(async (meshFileInfo) => {
        _progress = meshFileInfos.length === 1 ? 0.25 : 0.001;

        onProgress && onProgress(_progress);

        if (meshFileInfo.isGroup) {
            return modelGroup.generateModel({
                loadFrom,
                limitSize: size,
                headType,
                sourceType,
                originalName: meshFileInfo.originalName,
                uploadName: meshFileInfo.uploadName,
                modelName: meshFileInfo.modelName,
                baseName: meshFileInfo.baseName,
                mode: mode,
                sourceWidth,
                width: sourceWidth,
                sourceHeight,
                height: sourceHeight,
                geometry: null,
                material: null,
                transformation,
                modelID: meshFileInfo.modelID,
                extruderConfig,
                isGroup: meshFileInfo.isGroup,
                children: meshFileInfo.children,
            });
        } else if (primeTowerTag) {
            if (modelGroup.primeTower) {
                modelGroup.primeTower.updateTowerTransformation(transformation);
            }
            return modelGroup.primeTower;
        } else {
            const uploadPath = `${DATA_PREFIX}/${meshFileInfo.uploadName}`;
            const newModel = await new Promise((resolve, reject) => {
                const onMessage = async (data) => {
                    const { type } = data;
                    switch (type) {
                        case 'LOAD_MODEL_POSITIONS': {
                            const { positions, originalPosition, byteCount } = data;
                            const bufferGeometry = new BufferGeometry();
                            const modelPositionAttribute = new BufferAttribute(positions, 3);
                            const material = new MeshPhongMaterial({
                                side: DoubleSide,
                                color: 0xa0a0a0,
                                specular: 0xb0b0b0,
                                shininess: 0
                            });

                            bufferGeometry.setAttribute('position', modelPositionAttribute);

                            if (byteCount) {
                                bufferGeometry.setAttribute('byte_count', new BufferAttribute(byteCount, 1));
                            }

                            bufferGeometry.computeVertexNormals();

                            try {
                                const model = await modelGroup.generateModel(
                                    {
                                        loadFrom,
                                        limitSize: size,
                                        headType,
                                        sourceType,
                                        originalName: meshFileInfo.originalName,
                                        uploadName: meshFileInfo.uploadName,
                                        modelName: meshFileInfo.modelName,
                                        baseName: meshFileInfo.baseName,
                                        mode: mode,
                                        sourceWidth,
                                        width: sourceWidth,
                                        sourceHeight,
                                        height: sourceHeight,
                                        geometry: bufferGeometry,
                                        material: material,
                                        transformation,
                                        originalPosition,
                                        modelID: meshFileInfo.modelID,
                                        extruderConfig,
                                        parentModelID,
                                        parentUploadName: meshFileInfo.parentUploadName
                                    }
                                );

                                // update progress
                                if (meshFileInfos.length > 1) {
                                    _progress += 1 / meshFileInfos.length;

                                    onProgress && onProgress(_progress);
                                }
                                resolve(model);
                            } catch (e) {
                                log.error(e);
                                promptTasks.push({
                                    status: 'load-model-fail',
                                    originalName: meshFileInfo.originalName
                                });

                                // update progress
                                if (meshFileInfos.length > 1) {
                                    _progress += 1 / meshFileInfos.length;

                                    onProgress && onProgress(_progress);
                                }
                                reject(new Error('Failed to load mesh'));
                                // throw new Error('Failed to load mesh');
                            }
                            break;
                        }
                        case 'LOAD_MODEL_CONVEX': {
                            let { positions } = data;

                            const convexGeometry = new BufferGeometry();
                            const positionAttribute = new BufferAttribute(
                                positions,
                                3
                            );
                            convexGeometry.setAttribute(
                                'position',
                                positionAttribute
                            );

                            modelGroup.setConvexGeometry(
                                meshFileInfo.uploadName,
                                convexGeometry
                            );
                            positions = null;
                            break;
                        }
                        case 'LOAD_MODEL_PROGRESS': {
                            if (meshFileInfos.length === 1) {
                                const progress = 0.25 + data.progress * 0.5;
                                onProgress && onProgress(progress);
                            }
                            break;
                        }
                        case 'LOAD_MODEL_FAILED': {
                            promptTasks.push({
                                status: 'load-model-fail',
                                originalName: meshFileInfo.originalName
                            });

                            if (meshFileInfos.length > 1) {
                                _progress += 1 / meshFileInfos.length;

                                onProgress && onProgress(_progress);
                            }
                            // reject();
                            // break;
                            reject(new Error(`Failed to load mesh: ${data.err}`));
                            break;
                        }
                        default:
                            break;
                    }
                };
                createLoadModelWorker({
                    uploadPath,
                    monoColor,
                }, onMessage);
            });

            return newModel;
        }
    });

    const promiseResults = await Promise.allSettled(promises) as PromiseSettledResult<ThreeModel>[];
    const models = promiseResults
        .filter((result) => result.status === 'fulfilled')
        .map((result) => (result as PromiseFulfilledResult<ThreeModel>).value);

    return {
        models,
        promptTasks,
    };
};

export {
    synchronizeMeshFile,
};

export default {
};
