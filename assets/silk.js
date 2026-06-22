/* PayParty animated silk background — self-inits on any <canvas data-silk>.
   Same look as the landing hero (bold violet, iridescent peaks, bloom, grain,
   mouse ripple). Falls back to a soft CSS gradient if WebGL is unavailable. */
(function () {
  var canvas = document.querySelector('canvas[data-silk]');
  if (!canvas) return;
  var gl = canvas.getContext('webgl', { antialias: true }) || canvas.getContext('experimental-webgl');
  if (!gl) { canvas.style.background = 'radial-gradient(120% 90% at 50% 0%,#efe7ff,#fff 70%)'; return; }
  var VERT = 'attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0.0,1.0);}';
  var FRAG = [
    'precision highp float;',
    'uniform float u_time;uniform vec2 u_resolution;uniform vec2 u_mouse;uniform float u_vel;',
    'vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}',
    'vec2 mod289(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}',
    'vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}',
    'float snoise(vec2 v){const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);',
    'vec2 i=floor(v+dot(v,C.yy));vec2 x0=v-i+dot(i,C.xx);vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);',
    'vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;i=mod289(i);',
    'vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));',
    'vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);m=m*m;m=m*m;',
    'vec3 x=2.0*fract(p*C.www)-1.0;vec3 h=abs(x)-0.5;vec3 ox=floor(x+0.5);vec3 a0=x-ox;',
    'm*=1.79284291400159-0.85373472095314*(a0*a0+h*h);',
    'vec3 g;g.x=a0.x*x0.x+h.x*x0.y;g.yz=a0.yz*x12.xz+h.yz*x12.yw;return 130.0*dot(m,g);}',
    'float fbm(vec2 p){float f=0.65*snoise(p);f+=0.35*snoise(p*2.03+vec2(3.1,1.7));return f;}',
    'void main(){vec2 uv=gl_FragCoord.xy/u_resolution.xy;vec2 p=uv;p.x*=u_resolution.x/u_resolution.y;',
    'float t=u_time*0.055;',
    'vec2 mp=u_mouse;mp.x*=u_resolution.x/u_resolution.y;',
    'vec2 rd=p-mp;float rl=length(rd);',
    'float ripple=sin(rl*24.0-u_time*4.5)*exp(-rl*5.0);',
    'p+=normalize(rd+vec2(0.0001))*ripple*(0.011+0.06*u_vel);',
    'vec2 q=vec2(fbm(p*1.15+vec2(0.0,t)),fbm(p*1.15+vec2(5.2,-t)));',
    'vec2 r=vec2(fbm(p*1.15+1.75*q+vec2(1.7,9.2)+0.65*t),fbm(p*1.15+1.75*q+vec2(8.3,2.8)-0.65*t));',
    'float n=fbm(p*1.15+1.85*r);float nn=n*0.5+0.5;',
    'float irid=fbm(p*1.05+1.5*r+vec2(2.0,-t));',
    'vec3 white=vec3(1.0,1.0,1.0);vec3 lav=vec3(0.86,0.83,1.0);',
    'vec3 violet=vec3(0.56,0.42,1.0);vec3 deep=vec3(0.40,0.19,0.99);',
    'vec3 blue=vec3(0.33,0.56,1.0);vec3 pink=vec3(0.96,0.46,0.96);',
    'vec3 col=mix(white,lav,smoothstep(0.0,0.5,nn));',
    'col=mix(col,violet,smoothstep(0.42,0.84,nn));',
    'col=mix(col,deep,smoothstep(0.78,1.0,nn));',
    'col=mix(col,blue,smoothstep(0.8,1.0,nn)*clamp(irid*0.5+0.5,0.0,1.0)*0.55);',
    'col=mix(col,pink,smoothstep(0.86,1.0,nn)*clamp(-irid*0.5+0.5,0.0,1.0)*0.45);',
    'float sheen=smoothstep(0.66,1.0,fbm(p*1.9+2.0*r+t));col+=vec3(0.55,0.45,1.0)*sheen*0.42;',
    'float spec=pow(clamp(nn,0.0,1.0),3.0);col+=vec3(0.5,0.42,1.0)*spec*0.26;',
    'col=mix(col,deep,smoothstep(0.42,0.0,rl)*0.20);',
    'col+=vec3(0.6,0.5,1.0)*abs(ripple)*smoothstep(0.55,0.0,rl)*(0.4+0.95*u_vel);',
    'float vig=smoothstep(1.2,0.3,length(uv-vec2(0.5,0.42)));col=mix(white,col,mix(0.72,1.0,vig));',
    'float grain=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);col+=(grain-0.5)*0.022;',
    'gl_FragColor=vec4(col,1.0);}'
  ].join('\n');
  function sh(t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; }
  var prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog); gl.useProgram(prog);
  var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, 'a_pos'); gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  var uT = gl.getUniformLocation(prog, 'u_time'), uR = gl.getUniformLocation(prog, 'u_resolution'),
      uM = gl.getUniformLocation(prog, 'u_mouse'), uV = gl.getUniformLocation(prog, 'u_vel');
  var mouse = { x: 0.5, y: 0.6 }, vel = 0, lmx = 0.5, lmy = 0.6;
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
    gl.uniform2f(uR, canvas.width, canvas.height);
  }
  new ResizeObserver(resize).observe(canvas); resize();
  var start = performance.now();
  (function frame() { resize(); gl.uniform1f(uT, (performance.now() - start) / 1000); gl.uniform2f(uM, mouse.x, mouse.y); vel *= 0.91; gl.uniform1f(uV, vel); gl.drawArrays(gl.TRIANGLES, 0, 3); requestAnimationFrame(frame); })();
  window.addEventListener('mousemove', function (e) {
    mouse.x = e.clientX / window.innerWidth; mouse.y = 1 - (e.clientY / window.innerHeight);
    var dvx = mouse.x - lmx, dvy = mouse.y - lmy; vel = Math.min(1, vel + Math.sqrt(dvx * dvx + dvy * dvy) * 7); lmx = mouse.x; lmy = mouse.y;
  });
})();
