// Local WebGL surface renderer: depth-tested triangles, interpolated scalar colors and smooth data normals.
// No Python server, VTK download or external plotting service is required.
(() => {
    const api = window.SlideForgeLandscape;
    function createSurfaceRenderer(canvas) {
        const gl = canvas.getContext("webgl", { alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
        if (!gl) return null;
        const shaders = [], resources = [];
        let lost = false;
        const onLost = event => { event.preventDefault(); lost = true; };
        canvas.addEventListener("webglcontextlost", onLost);
        const dispose = () => {
            canvas.removeEventListener("webglcontextlost", onLost);
            for (const [kind, resource] of resources) gl[kind](resource);
            for (const shader of shaders) gl.deleteShader(shader);
            gl.getExtension("WEBGL_lose_context")?.loseContext();
        };
        try {
            const compile = (type, source) => {
                const shader = gl.createShader(type); shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
                return shader;
            };
            const vertex = compile(gl.VERTEX_SHADER, `
                attribute vec3 aPosition; attribute vec3 aNormal; attribute vec4 aColor;
                // The scene's camera (view.js, project and screen): yaw and pitch as cos/sin, the scale and offset to
                // CSS pixels, the box's size, and the depth range drawn.
                uniform vec4 uTurn; uniform vec3 uPlace; uniform vec2 uSize; uniform vec2 uDepth;
                varying vec3 vNormal; varying vec4 vColor;
                void main() {
                    float u = aPosition.x * uTurn.x - aPosition.y * uTurn.y;
                    float across = aPosition.x * uTurn.y + aPosition.y * uTurn.x;
                    float v = -across * uTurn.w - aPosition.z * uTurn.z;
                    float depth = across * uTurn.z - aPosition.z * uTurn.w;
                    vec2 screen = uPlace.yz + vec2(u, v) * uPlace.x;
                    gl_Position = vec4(screen.x / uSize.x * 2.0 - 1.0, 1.0 - screen.y / uSize.y * 2.0, (depth - uDepth.x) / uDepth.y * 1.98 - 0.99, 1.0);
                    vNormal = aNormal; vColor = aColor;
                }
            `);
            const fragment = compile(gl.FRAGMENT_SHADER, `
                precision mediump float;
                varying vec3 vNormal; varying vec4 vColor;
                uniform float uLighting; uniform vec3 uEye;
                void main() {
                    vec3 rgb = vColor.rgb;
                    if (uLighting > 0.5 && length(vNormal) > 0.01) {
                        vec3 n = normalize(vNormal); if (!gl_FrontFacing) n = -n;
                        vec3 light = normalize(vec3(-0.35, -0.45, 0.82));
                        float diffuse = max(0.0, dot(n, light));
                        float specular = pow(max(0.0, dot(reflect(-light, n), normalize(uEye))), 24.0);
                        rgb = rgb * (0.48 + 0.52 * diffuse) + 0.14 * specular;
                    }
                    gl_FragColor = vec4(rgb, vColor.a);
                }
            `);
            const program = gl.createProgram(); resources.push(["deleteProgram", program]);
            gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
            const buffer = gl.createBuffer(); resources.push(["deleteBuffer", buffer]);
            const locations = ["aPosition", "aNormal", "aColor"].map(name => gl.getAttribLocation(program, name));
            const lighting = gl.getUniformLocation(program, "uLighting"), eye = gl.getUniformLocation(program, "uEye");
            const [turn, place, size, depthRange] = ["uTurn", "uPlace", "uSize", "uDepth"].map(name => gl.getUniformLocation(program, name));
            // The surface's vertices do not move with the camera: uploaded once per mesh, not for every frame.
            let uploaded = null;
            return {
                render(scene) {
                    if (lost || gl.isContextLost()) return false;
                    const ratio = Math.min(2, window.devicePixelRatio || 1), width = Math.round(scene.width * ratio), height = Math.round(scene.height * ratio);
                    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
                    const { mesh, projection: view } = scene;
                    if (!mesh || !view) return false;
                    const opaqueCount = mesh.cellCount * 6;
                    gl.viewport(0, 0, width, height); gl.disable(gl.SCISSOR_TEST); gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
                    gl.enable(gl.SCISSOR_TEST); gl.scissor(Math.round(scene.plot.x * ratio), Math.round((scene.height - scene.plot.y - scene.plot.h) * ratio), Math.round(scene.plot.w * ratio), Math.round(scene.plot.h * ratio));
                    gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                    if (uploaded !== mesh) { gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW); uploaded = mesh; }
                    gl.uniform4f(turn, view.cosYaw, view.sinYaw, view.cosPitch, view.sinPitch);
                    gl.uniform3f(place, view.scale, view.offsetX, view.offsetY);
                    gl.uniform2f(size, scene.width, scene.height); gl.uniform2f(depthRange, view.near, view.span);
                    for (const [i, components, start] of [[0, 3, 0], [1, 3, 12], [2, 4, 24]]) { gl.enableVertexAttribArray(locations[i]); gl.vertexAttribPointer(locations[i], components, gl.FLOAT, false, 40, start); }
                    const yaw = scene.camera.yaw * Math.PI / 180, pitch = scene.camera.pitch * Math.PI / 180;
                    gl.uniform3f(eye, -Math.sin(yaw) * Math.cos(pitch), -Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch));
                    gl.uniform1f(lighting, scene.lighting ? 1 : 0); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
                    gl.drawArrays(gl.TRIANGLES, 0, opaqueCount);
                    if (mesh.planeCount) {
                        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
                        // Near-zero tails can be coplanar at depth-buffer precision. Bias the reference plane away
                        // from the surface so it does not produce a patchwork of fighting triangles.
                        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1); gl.depthFunc(gl.LESS);
                        gl.drawArrays(gl.TRIANGLES, opaqueCount, mesh.planeCount * 6);
                        gl.disable(gl.POLYGON_OFFSET_FILL); gl.depthMask(true);
                    }
                    gl.flush();
                    return true;
                },
                dispose,
            };
        } catch (error) { dispose(); console.warn("Landscape WebGL unavailable; using canvas:", error); return null; }
    }
    function snapshot(scene) {
        const canvas = document.createElement("canvas"), mesh = document.createElement("canvas");
        const renderer = api.createSurfaceRenderer(mesh);
        try {
            const drawn = Boolean(renderer?.render(scene));
            // Without WebGL the surface is painted face by face: a scene left to the GPU gets its faces first.
            api.paint(canvas, drawn || !scene.withFaces ? scene : scene.withFaces(), drawn ? mesh : null);
            return canvas.toDataURL("image/png");
        }
        finally { renderer?.dispose(); }
    }
    Object.assign(api, { createSurfaceRenderer, snapshot });
})();
