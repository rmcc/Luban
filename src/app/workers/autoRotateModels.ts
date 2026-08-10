import { Observable } from 'rxjs';
import { Matrix4, BufferGeometry, BufferAttribute, Vector3 } from 'three';
import ThreeUtils from '../scene/three-extensions/ThreeUtils';

type ModelInfoData = {
    matrixWorld: Matrix4;
    inverseNormal: boolean;
    convexGeometry: BufferGeometry;
};

type AttributeObject = {
    array: number[];
    itemSize: number;
    normalized: boolean;
};

type AttributeData = {
    send: AttributeObject[];
};

type AutoRotateModelsData = {
    selectedModelInfo: ModelInfoData[];
    positionAttribute: AttributeData;
    normalAttribute: AttributeData;
};

const autoRotateModels = (data: AutoRotateModelsData) => {
    const { selectedModelInfo, positionAttribute, normalAttribute } = data;
    return new Observable((observer) => {
        try {
            const selectedModelLength = selectedModelInfo.length;
            selectedModelInfo.forEach(async (modelItemInfo, index) => {
                const {
                    matrixWorld: rawMatrix,
                    inverseNormal,
                    convexGeometry: rawConvex,
                } = modelItemInfo;

                const matrixWorld = new Matrix4();
                if (rawMatrix && rawMatrix.elements) {
                    matrixWorld.fromArray(rawMatrix.elements);
                }

                const convexGeometry = new BufferGeometry();
                if (rawConvex && rawConvex.attributes && rawConvex.attributes.position) {
                    const rawPos = rawConvex.attributes.position;
                    convexGeometry.setAttribute(
                        'position',
                        new BufferAttribute(rawPos.array, rawPos.itemSize, rawPos.normalized)
                    );
                }

                const geometry = new BufferGeometry();
                const positionObject = positionAttribute.send[index];
                const normalObject = normalAttribute.send[index];
                geometry.setAttribute(
                    'position',
                    new BufferAttribute(
                        positionObject.array,
                        positionObject.itemSize,
                        positionObject.normalized
                    )
                );
                geometry.setAttribute(
                    'normal',
                    new BufferAttribute(
                        normalObject.array,
                        normalObject.itemSize,
                        normalObject.normalized
                    )
                );
                geometry.computeBoundingBox();
                geometry.computeBoundingSphere();
                const box3 = geometry.boundingBox;
                const x = (box3.max.x + box3.min.x) / 2;
                const y = (box3.max.y + box3.min.y) / 2;
                const z = (box3.max.z + box3.min.z) / 2;
                const center = new Vector3(x, y, z);
                center.applyMatrix4(matrixWorld);
                const { planes, areas, planesPosition } = await ThreeUtils.computeGeometryPlanes(
                    convexGeometry,
                    matrixWorld,
                    [],
                    center,
                    inverseNormal,
                    (subProgress) => {
                        observer.next({
                            status: 'PROGRESS',
                            value: {
                                // By the time the worker is called, the progress bar
                                // is already at 20%. So start there and go up to 80
                                progress: 0.20 + 0.60 * ((index + subProgress * 0.5) / (selectedModelLength + 1)),
                            },
                        });
                    }
                );
                const maxArea = areas.reduce((max, current) => current > max ? current : max, -Infinity);
                const bigPlanes = { planes: null, areas: [], planesPosition: [] };
                bigPlanes.planes = planes.filter((p, idx) => {
                    // filter big planes, 0.1 can be change to improve perfomance
                    const isBig = areas[idx] > maxArea * 0.1;
                    if (isBig) {
                        bigPlanes.areas.push(areas[idx]);
                        bigPlanes.planesPosition.push(planesPosition[idx]);
                    }
                    return isBig;
                });

                if (!bigPlanes.planes.length && planes.length > 0) {
                    const sortedIndices = areas
                        .map((area, idx) => ({ area, idx }))
                        .sort((itemA, itemB) => itemB.area - itemA.area);

                    const candidateCount = Math.min(5, sortedIndices.length);
                    const backupPlanes = [];

                    for (let cIdx = 0; cIdx < candidateCount; cIdx++) {
                        const originalIdx = sortedIndices[cIdx].idx;
                        backupPlanes.push(planes[originalIdx]);
                        bigPlanes.areas.push(areas[originalIdx]);
                        bigPlanes.planesPosition.push(planesPosition[originalIdx]);
                    }
                    bigPlanes.planes = backupPlanes;
                }

                if (!bigPlanes.planes.length) {
                    observer.next({
                        status: 'PROGRESS',
                        value: {
                            // By the time the worker is called, the progress bar
                            // is already at 20%. So start there and go up to 80
                            progress: 0.20 + 0.60 * ((index + 1) / (selectedModelLength + 1)),
                        },
                    });
                    index + 1 >= selectedModelLength && observer.complete();
                    return;
                }
                const xyPlaneNormal = new Vector3(0, 0, -1);
                const objPlanes = await ThreeUtils.computeGeometryPlanes(
                    geometry,
                    matrixWorld,
                    bigPlanes.planes,
                    center,
                    inverseNormal,
                    (subProgress) => {
                        observer.next({
                            status: 'PROGRESS',
                            value: {
                                // By the time the worker is called, the progress bar
                                // is already at 20%. So start there and go up to 80
                                progress: 0.20 + 0.60 * ((index + 0.5 + subProgress * 0.5) / (selectedModelLength + 1)),
                            },
                        });
                    }
                );
                let targetPlane;
                const minSupportVolume = objPlanes.supportVolumes.reduce(
                    (min, current) => current < min ? current : min, Infinity
                );
                const rates = [];
                if (minSupportVolume < 1) {
                    const idx = objPlanes.supportVolumes.findIndex(
                        (i) => i === minSupportVolume
                    );
                    targetPlane = objPlanes.planes[idx];
                }
                for (
                    let idx = 0, len = bigPlanes.planes.length;
                    idx < len;
                    idx++
                ) {
                    // update rate formula to improve performance
                    const areasFactor = objPlanes.areas[idx] / bigPlanes.areas[idx];
                    let supportVolumesFactor = 0;
                    if (objPlanes.supportVolumes[idx] !== 0) {
                        supportVolumesFactor = minSupportVolume
                            / objPlanes.supportVolumes[idx];
                    } else if (minSupportVolume === 0) {
                        supportVolumesFactor = 1;
                    }
                    rates.push(
                        objPlanes.areas[idx]
                        * areasFactor
                        * supportVolumesFactor
                    );
                }
                if (!targetPlane) {
                    const maxRate = rates.reduce((max, current) => current > max ? current : max, -Infinity);
                    const idx = rates.findIndex((r) => r === maxRate);
                    targetPlane = bigPlanes.planes[idx];
                }
                observer.next({
                    status: 'PARTIAL_SUCCESS',
                    value: {
                        progress:
                            selectedModelLength === 1
                                ? 0.8
                                : (index + 1) / (selectedModelLength + 1),
                        targetPlane: targetPlane.normal,
                        xyPlaneNormal,
                        index,
                        isFinish: index + 1 >= selectedModelLength,
                        rates: rates,
                        planes: objPlanes.planes,
                        planesPosition: bigPlanes.planesPosition,
                        areas: objPlanes.areas,
                        supportVolumes: objPlanes.supportVolumes
                    }
                });
                index + 1 >= selectedModelLength && observer.complete();
            });
        } catch (err) {
            observer.next({ status: 'ERROR', value: err });
            observer.complete();
        }
    });
};

export default autoRotateModels;
