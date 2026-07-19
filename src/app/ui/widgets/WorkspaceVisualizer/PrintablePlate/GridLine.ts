import * as THREE from 'three';
import { Object3D } from 'three';

class GridLine extends Object3D {
    // public group = new THREE.Object3D();

    private colorCenterLine = new THREE.Color(0x444444);

    private colorGrid = new THREE.Color(0x888888);

    public constructor(minX, maxX, stepX, minY, maxY, stepY, colorCenterLine, colorGrid) {
        super();

        colorCenterLine = new THREE.Color(colorCenterLine) || this.colorCenterLine;
        colorGrid = new THREE.Color(colorGrid) || this.colorGrid;

        minY = minY ?? minX;
        maxY = maxY ?? maxX;
        stepY = stepY ?? stepX;

        for (let x = Math.ceil(minX / stepX) * stepX; x <= Math.floor(maxX / stepX) * stepX; x += stepX) {
            const geometry = new THREE.BufferGeometry();
            const material = new THREE.LineBasicMaterial({
                vertexColors: true
            });
            const color = (x === 0) ? colorCenterLine : colorGrid;

            const positions = new Float32Array([
                x, minY, 0,
                x, maxY, 0
            ]);
            const colors = new Float32Array([
                color.r, color.g, color.b,
                color.r, color.g, color.b
            ]);

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

            this.add(new THREE.Line(geometry, material));
        }

        for (let y = Math.ceil(minY / stepY) * stepY; y <= Math.floor(maxY / stepY) * stepY; y += stepY) {
            const geometry = new THREE.BufferGeometry();
            const material = new THREE.LineBasicMaterial({
                vertexColors: true
            });
            const color = (y === 0) ? colorCenterLine : colorGrid;

            const positions = new Float32Array([
                minX, y, 0,
                maxX, y, 0
            ]);
            const colors = new Float32Array([
                color.r, color.g, color.b,
                color.r, color.g, color.b
            ]);

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

            this.add(new THREE.Line(geometry, material));
        }
    }
}

export default GridLine;
