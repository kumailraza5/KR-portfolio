/**
 * Renders a packed-alpha H.264 video to a transparent WebGL canvas.
 *
 * Source video layout (1080 x 810):
 *   Left  540 px -> RGB colour frames of the person
 *   Right 540 px -> Greyscale alpha matte (white = opaque, black = transparent)
 *
 * The canvas composites correctly over any CSS background.
 * Audio plays from the hidden video element itself.
 */

const VERT = `
attribute vec2 aPos;
varying   vec2 vUV;
void main(){
  vUV = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUV;
void main(){
  vec3  col   = texture2D(uTex, vec2(vUV.x * 0.5,        vUV.y)).rgb;
  float alpha = texture2D(uTex, vec2(vUV.x * 0.5 + 0.5,  vUV.y)).r;
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

export class TransparentVideoRenderer {
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly texture: WebGLTexture;
  private raf = 0;
  private _destroyed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly video: HTMLVideoElement,
  ) {
    const gl = (
      canvas.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: 'low-power',
      }) ??
      (canvas.getContext as (id: string, opts?: object) => RenderingContext | null)(
        'experimental-webgl',
        { alpha: true, premultipliedAlpha: true, antialias: false, depth: false },
      )
    ) as WebGLRenderingContext | null;

    if (!gl) throw new Error('WebGL is not available on this device');
    this.gl = gl;

    const prog = gl.createProgram();
    if (!prog) throw new Error('gl.createProgram() returned null');
    gl.attachShader(prog, this.compileShader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, this.compileShader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('WebGL link error: ' + gl.getProgramInfoLog(prog));
    }
    this.program = prog;
    gl.useProgram(prog);

    const vbo = gl.createBuffer();
    if (!vbo) throw new Error('gl.createBuffer() returned null');
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    if (!tex) throw new Error('gl.createTexture() returned null');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
    this.texture = tex;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
  }

  private compileShader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type);
    if (!s) throw new Error('gl.createShader() returned null');
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('Shader compile error: ' + gl.getShaderInfoLog(s));
    }
    return s;
  }

  private renderFrame(): void {
    const { gl, video, canvas } = this;
    if (video.readyState < 2) return;

    const displayW = video.videoWidth / 2;
    const displayH = video.videoHeight;

    if (canvas.width !== displayW || canvas.height !== displayH) {
      canvas.width = displayW;
      canvas.height = displayH;
      gl.viewport(0, 0, displayW, displayH);
    }

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  start(): void {
    if (this._destroyed) return;
    const tick = () => {
      if (this._destroyed) return;
      this.renderFrame();
      this.raf = requestAnimationFrame(tick);
    };
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  destroy(): void {
    this.stop();
    this._destroyed = true;
    this.gl.deleteTexture(this.texture);
    this.gl.deleteProgram(this.program);
  }
}
