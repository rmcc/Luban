import fs from 'fs';
import * as THREE from 'three';
import { isUndefined } from 'lodash';
import log from 'loglevel';
import * as dxfModule from 'dxf';
import { svgInverse, svgToString } from '../SVGParser/SvgToString';

const Helper = dxfModule.Helper || dxfModule.default || dxfModule;

function angle2(p1, p2) {
    const v1 = new THREE.Vector2(p1.x, p1.y);
    const v2 = new THREE.Vector2(p2.x, p2.y);
    v2.sub(v1); // sets v2 to be our chord
    v2.normalize();
    if (v2.y < 0) return -Math.acos(v2.x);
    return Math.acos(v2.x);
}

function readFile(originalPath) {
    return new Promise((resolve, reject) => {
        fs.readFile(originalPath, 'utf8', async (err, fileText) => {
            if (err) {
                reject(err);
                return;
            }

            resolve(fileText);
        });
    }).catch((err) => {
        log.error(err);
    });
}

class BulgeGeometry extends THREE.BufferGeometry {
    constructor(startPoint, endPoint, bulge, segments) {
        super();
        let vertex, i;
        const p0 = startPoint
            ? new THREE.Vector2(startPoint.x, startPoint.y)
            : new THREE.Vector2(0, 0);
        const p1 = endPoint
            ? new THREE.Vector2(endPoint.x, endPoint.y)
            : new THREE.Vector2(1, 0);
        bulge = bulge || 1;
        this.startPoint = p0;
        this.endPoint = p1;
        this.bulge = bulge;

        const angle = 4 * Math.atan(bulge);
        const radius = p0.distanceTo(p1) / 2 / Math.sin(angle / 2);
        const center = {
            x: startPoint.x + radius * Math.cos(angle2(p0, p1) + (Math.PI / 2 - angle / 2)),
            y: startPoint.y + radius * Math.sin(angle2(p0, p1) + (Math.PI / 2 - angle / 2))
        };

        if (segments !== undefined) {
            this.segments = segments;
        } else {
            this.segments = Math.max(
                Math.abs(Math.ceil(angle / (Math.PI / 36))),
                6
            ); // By default want a segment roughly every 5 degrees
        }

        const startAngle = angle2(center, p0);
        const thetaAngle = angle / this.segments;

        const verticesCount = this.segments + 1;
        const positions = new Float32Array(verticesCount * 3);
        this.vertices = [];

        positions[0] = p0.x;
        positions[1] = p0.y;
        positions[2] = 0;
        this.vertices.push(new THREE.Vector2(p0.x, p0.y));

        for (i = 1; i <= this.segments - 1; i++) {
            vertex = {
                x: center.x + Math.abs(radius) * Math.cos(startAngle + thetaAngle * i),
                y: center.y + Math.abs(radius) * Math.sin(startAngle + thetaAngle * i)
            };

            positions[i * 3] = vertex.x;
            positions[i * 3 + 1] = vertex.y;
            positions[i * 3 + 2] = 0;
            this.vertices.push(new THREE.Vector2(vertex.x, vertex.y));
        }

        positions[(this.segments) * 3] = p1.x;
        positions[(this.segments) * 3 + 1] = p1.y;
        positions[(this.segments) * 3 + 2] = 0;
        this.vertices.push(new THREE.Vector2(p1.x, p1.y));

        this.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    }
}

export const dxfToSvg = (dxf, strokeWidth = 0.72) => {
    const shapes = [];
    let res = {};
    const insUnits = dxf.header && dxf.header.insUnits;
    let s = 1.0;
    if (insUnits === 1) {
        s = 25.4; // Inches to mm
    } else if (insUnits === 5) {
        s = 10.0; // cm to mm
    } else if (insUnits === 6) {
        s = 1000.0; // Meters to mm
    } else if (insUnits === 2) {
        s = 304.8; // Feet to mm
    }
    for (const entities of dxf.entities) {
        if (
            dxf.tables
            && dxf.tables.layer
            && !isUndefined(dxf.tables.layer.layers[entities.layer].visible)
            && !dxf.tables.layer.layers[entities.layer].visible
        ) {
            continue;
        }

        const shape = {};
        shape.paths = [];
        const pathsObj = {};
        pathsObj.points = [];

        if (
            entities.type === 'LINE'
            || entities.type === 'POLYLINE'
            || entities.type === 'LWPOLYLINE'
        ) {
            pathsObj.points = [];
            pathsObj.closed = false;

            let vertex, startPoint, endPoint, bulgeGeometry, bulge, i;

            // create geometry
            for (i = 0; i < entities.vertices.length; i++) {
                if (entities.vertices[i].bulge) {
                    bulge = entities.vertices[i].bulge;
                    startPoint = { x: entities.vertices[i].x * s, y: entities.vertices[i].y * s };
                    endPoint = i + 1 < entities.vertices.length
                        ? { x: entities.vertices[i + 1].x * s, y: entities.vertices[i + 1].y * s }
                        : { x: entities.vertices[0].x * s, y: entities.vertices[0].y * s };

                    bulgeGeometry = new BulgeGeometry(
                        startPoint,
                        endPoint,
                        bulge
                    );
                    bulgeGeometry.vertices.forEach((vertice) => {
                        pathsObj.points.push([vertice.x, vertice.y]);
                    });
                } else {
                    vertex = entities.vertices[i];
                    if (entities.extrusionDirection && entities.extrusionDirection.z === -1) {
                        pathsObj.points.push([-vertex.x * s, vertex.y * s]);
                    } else {
                        pathsObj.points.push([vertex.x * s, vertex.y * s]);
                    }
                }
            }

            if (entities.closed || entities.vertices.length > 2 && entities.shape === true) {
                pathsObj.points.push([
                    entities.vertices[0].x * s,
                    entities.vertices[0].y * s
                ]);
                pathsObj.closed = true;
            }
            shape.paths.push(pathsObj);
        } else if (entities.type === 'SPLINE') {
            pathsObj.points = [];
            entities.controlPoints.forEach((item) => {
                pathsObj.points.push([item.x * s, item.y * s]);
            });
            pathsObj.closed = entities.closed;
            if (pathsObj.closed) {
                pathsObj.points.push([
                    entities.controlPoints[0].x * s,
                    entities.controlPoints[0].y * s
                ]);
            }
            shape.paths.push(pathsObj);
        } else if (entities.type === 'POINT') {
            if (entities.position.y === 0 && entities.position.x === 0) {
                continue;
            }
            pathsObj.closed = false;
            pathsObj.points.push([entities.position.x * s, entities.position.y * s]);
            shape.paths.push(pathsObj);
        } else if (entities.type === 'ARC') {
            const radius = entities.radius * s;
            const { startAngle, endAngle, angleLength } = entities;
            const totalAngle = startAngle <= endAngle ? angleLength : Math.PI * 2 + angleLength;

            for (let i = 0; i <= 64; i++) {
                const angle = startAngle + (totalAngle * (i / 64));
                const x1 = (entities.center.x * s) + radius * Math.cos(angle);
                const y1 = (entities.center.y * s) + radius * Math.sin(angle);
                pathsObj.points.push([x1, y1]);
            }

            pathsObj.closed = false;
            shape.paths.push(pathsObj);
        } else if (entities.type === 'CIRCLE') {
            const radius = entities.radius * s;
            const centerX = entities.center.x * s;
            const centerY = entities.center.y * s;
            pathsObj.closed = false;
            for (let i = 0; i <= 360; i += 5) {
                const x1 = centerX + radius * Math.cos((i * Math.PI) / 180);
                const y1 = centerY + radius * Math.sin((i * Math.PI) / 180);
                pathsObj.points.push([x1, y1]);
            }
            shape.paths.push(pathsObj);
        } else if (entities.type === 'ELLIPSE') {
            const xrad = Math.sqrt(
                entities.majorAxisEndPoint.x ** 2
                + entities.majorAxisEndPoint.y ** 2
            ) * s;
            const yrad = xrad * entities.axisRatio;
            const rotation = Math.atan2(
                entities.majorAxisEndPoint.y,
                entities.majorAxisEndPoint.x
            );

            const curve = new THREE.EllipseCurve(
                entities.center.x * s,
                entities.center.y * s,
                xrad,
                yrad,
                entities.startAngle,
                entities.endAngle,
                false, // Always counterclockwise
                rotation
            );
            const points = curve.getPoints(80);
            points.forEach((item) => {
                pathsObj.points.push([item.x, item.y]);
            });
            shape.paths.push(pathsObj);
        } else if (entities.type === 'INSERT') {
            continue;
        }
        shape.fill = 'none';
        shape.stroke = '#000000';
        shape.strokeWidth = strokeWidth;
        shape.visibility = true;
        shapes.push(shape);
    }

    res = {
        shapes
    };

    return res;
};

export function updateShapeBoundingBox(shape) {
    const boundingBox = {
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity
    };

    for (const path of shape.paths) {
        for (const point of path.points) {
            boundingBox.minX = Math.min(boundingBox.minX, point[0]);
            boundingBox.maxX = Math.max(boundingBox.maxX, point[0]);
            boundingBox.minY = Math.min(boundingBox.minY, point[1]);
            boundingBox.maxY = Math.max(boundingBox.maxY, point[1]);
        }
    }

    shape.boundingBox = boundingBox;
}

export const updateDxfBoundingBox = (svg) => {
    const boundingBox = {
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity
    };

    let maxStroke = 0.1;
    for (const shape of svg.shapes) {
        updateShapeBoundingBox(shape);
        if (shape.visibility) {
            boundingBox.minX = Math.min(
                boundingBox.minX,
                shape.boundingBox.minX
            );
            boundingBox.maxX = Math.max(
                boundingBox.maxX,
                shape.boundingBox.maxX
            );
            boundingBox.minY = Math.min(
                boundingBox.minY,
                shape.boundingBox.minY
            );
            boundingBox.maxY = Math.max(
                boundingBox.maxY,
                shape.boundingBox.maxY
            );
        }
        if (shape.visibility && shape.strokeWidth > maxStroke) {
            maxStroke = shape.strokeWidth;
        }
    }

    svg.boundingBox = boundingBox;
    const margin = maxStroke * 2;
    svg.width = (svg.boundingBox.maxX - svg.boundingBox.minX) + (margin * 2);
    svg.height = (svg.boundingBox.maxY - svg.boundingBox.minY) + (margin * 2);
    svg.viewBox = [boundingBox.minX - margin, boundingBox.minY - margin, svg.width, svg.height];

    return svg;
};

export const parseDxf = async (originalPath) => {
    const fileText = await readFile(originalPath);
    const helper = new Helper(fileText);
    const dxfStr = helper.parsed;

    const shapesWrapper = dxfToSvg(dxfStr, 0.1);
    updateDxfBoundingBox(shapesWrapper);

    dxfStr.width = shapesWrapper.width;
    dxfStr.height = shapesWrapper.height;

    // fs.writeFile(
    //     originalPath.replace(/(\.dxf)$/, 'laserdxf.json'),
    //     JSON.stringify(dxfStr),
    //     (err) => {
    //         if (err) {
    //             console.log(err);
    //         } else {
    //             console.log('successful>>>>>>>>>>>>>');
    //         }
    //     }
    // );
    return {
        svg: dxfStr,
        width: dxfStr.width,
        height: dxfStr.height
    };
};

export const generateSvgFromDxf = (dxf, tempPath, tempName) => {
    return new Promise((resolve, reject) => {
        const svg = dxfToSvg(dxf, 0.1);
        const uploadPath = tempPath.replace(/\.dxf$/, 'parsed.svg');
        const uploadName = tempName.replace(/\.dxf$/, 'parsed.svg');
        updateDxfBoundingBox(svg);
        svgInverse(svg, 2);
        fs.writeFile(uploadPath, svgToString(svg), 'utf8', (error) => {
            if (error) throw reject(error);
            resolve({ uploadName });
        });
    });
};
