// OWNER: Person A. GLSL ES 3.00 shaders.

// One oversized triangle covers the whole viewport; no vertex buffer needed (uses gl_VertexID).
// uv.y is flipped so v = 0 is the TOP of the screen: textures are uploaded top row first
// (no UNPACK_FLIP_Y), and mask row 0 = top, so both stay upright.
export const FULLSCREEN_VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 pos = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

// Milestone 2: show the displayed (oldest) frame unchanged.
export const PASSTHROUGH_FRAG = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uFrame;
out vec4 outColor;
void main() {
  outColor = vec4(texture(uFrame, vUv).rgb, 1.0);
}
`;
