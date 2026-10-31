/* =========================================================================
   NEBULA — Transforming AI Racing Companion  (Phase 2)
   - 高级未来超跑 <-> 运动型人形机甲（同一骨架、部件级机械变形）
   - 主题自适应材质（跟随应用 data-theme，3D 材质真实变色，非滤镜）
   - 状态机：CAR_IDLE / ROBOT_IDLE / CAR_TO_ROBOT / ROBOT_TO_CAR /
             GREETING / THINKING / EXCITED / WARNING / SLEEPING
   - 交互：单击问候 / 双击变形（带队列）/ 长按全息菜单 / 点击光晕
   - 依赖：全局 THREE（three.min.js）
   ========================================================================= */
(function () {
  if (window.__companionBootedV2) return;
  window.__companionBootedV2 = true;

  const THREE = window.THREE;
  if (!THREE) { console.error('[companion] THREE 未加载'); return; }

  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  /* =======================================================================
     主题调色板
     ======================================================================= */
  const PALETTES = {
    dark: {
      body: 0x111827, armor: 0x273449, metal: 0x64748b, carbon: 0x090d16,
      joint: 0x0b1220, glow: 0x00cfff, glow2: 0x36afff, eye: 0x55e7ff,
      headlight: 0x9be8ff, tire: 0x0a0a0c, glass: 0x0b2233,
      ambient: 0x3a4a66, rimLight: 0x00cfff, floor: 0x0a1830,
    },
    light: {
      body: 0xdfe7f0, armor: 0xb6c3d4, metal: 0x8d9bad, carbon: 0x55637a,
      joint: 0x334155, glow: 0x168bff, glow2: 0x54cfff, eye: 0x299fff,
      headlight: 0x2f8fe0, tire: 0x111318, glass: 0x9cc4dd,
      ambient: 0xbfd4ea, rimLight: 0x168bff, floor: 0x9dbfe2,
    },
  };

  /* =======================================================================
     几何工具
     ======================================================================= */
  function roundedRectShape(w, h, r) {
    const s = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  function roundedBox(w, h, d, r, mat) {
    const geo = new THREE.ExtrudeGeometry(roundedRectShape(w, h, r), {
      depth: d, bevelEnabled: true,
      bevelThickness: Math.min(0.015, d / 3), bevelSize: Math.min(0.015, r),
      bevelSegments: 2, steps: 1, curveSegments: 6,
    });
    geo.center();
    return new THREE.Mesh(geo, mat);
  }
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

  /* =======================================================================
     材质（键名与调色板一致）
     ======================================================================= */
  function makeMaterials() {
    const mk = (key, opts) => {
      const m = new THREE.MeshStandardMaterial(opts);
      m.userData.key = key;
      return m;
    };
    const mats = {
      body: mk('body', { color: 0x111827, metalness: 0.55, roughness: 0.26 }),
      armor: mk('armor', { color: 0x273449, metalness: 0.55, roughness: 0.32 }),
      metal: mk('metal', { color: 0x9aa6b6, metalness: 0.62, roughness: 0.24 }),
      carbon: mk('carbon', { color: 0x090d16, metalness: 0.35, roughness: 0.68 }),
      joint: mk('joint', { color: 0x0b1220, metalness: 0.60, roughness: 0.50 }),
      tire: mk('tire', { color: 0x0a0a0c, metalness: 0.15, roughness: 0.92 }),
      glass: mk('glass', { color: 0x16344a, metalness: 0.42, roughness: 0.07, transparent: true, opacity: 0.78 }),
      glow: mk('glow', { color: 0x00cfff, emissive: 0x00cfff, emissiveIntensity: 2.6, metalness: 0.3, roughness: 0.3 }),
      glow2: mk('glow2', { color: 0x36afff, emissive: 0x36afff, emissiveIntensity: 2.0, metalness: 0.3, roughness: 0.3 }),
      eye: mk('eye', { color: 0xffffff, emissive: 0x55e7ff, emissiveIntensity: 3.2 }),
      headlight: mk('headlight', { color: 0xffffff, emissive: 0x9be8ff, emissiveIntensity: 3.0 }),
    };
    ['body', 'armor', 'metal', 'carbon', 'joint', 'glass'].forEach((k) => { mats[k].envMapIntensity = 1.2; });
    return mats;
  }

  /* =======================================================================
     程序化环境贴图（让金属有反射，随主题切换）
     ======================================================================= */
  function makeEnvTexture(name) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    if (name === 'light') {
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.42, '#cfdff0'); g.addColorStop(1, '#728aa4');
    } else {
      g.addColorStop(0, '#131e30'); g.addColorStop(0.45, '#0a1220'); g.addColorStop(1, '#04070d');
    }
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 128);
    // 地平线亮带（形成金属反射条）
    ctx.fillStyle = name === 'light' ? 'rgba(255,255,255,0.9)' : 'rgba(120,190,255,0.22)';
    ctx.fillRect(0, 42, 256, 7);
    // 光源亮点
    const spot = ctx.createRadialGradient(72, 52, 0, 72, 52, 66);
    spot.addColorStop(0, name === 'light' ? 'rgba(90,180,255,0.7)' : 'rgba(0,207,255,0.30)');
    spot.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = spot; ctx.fillRect(0, 0, 256, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function makeShadowTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,0.9)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.42)');
    g.addColorStop(0.75, 'rgba(0,0,0,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  /* =======================================================================
     主题材质控制器
     ======================================================================= */
  class ThemeMaterialController {
    constructor(mats, lights, extras) {
      this.mats = mats;
      this.lights = lights;
      this.extras = extras || {};
      this.theme = 'dark';
      this.target = {};
      this.transition = REDUCED ? 0.05 : 0.45;
      this._buildTarget('dark');
      this.applyInstant();
    }
    _buildTarget(name) {
      const pal = PALETTES[name] || PALETTES.dark;
      this.target = {};
      for (const k in pal) this.target[k] = new THREE.Color(pal[k]);
    }
    setTheme(name, instant) {
      this.theme = name;
      this._buildTarget(name);
      const light = name === 'light';
      // 浅色主题：加强接触阴影，削弱自发光地面（否则加色混合会把白底烧穿）
      if (this.extras.shadowMat) this.extras.shadowMat.opacity = light ? 0.55 : 0.34;
      if (this.extras.floorMat) this.extras.floorMat.opacity = light ? 0.14 : 0.34;
      // 浅色主题下压曝光，避免近白色车身与背景糊在一起
      if (this.extras.renderer) this.extras.renderer.toneMappingExposure = light ? 1.02 : 1.30;
      if (instant) this.applyInstant();
    }
    applyInstant() {
      for (const key in this.mats) {
        const m = this.mats[key], tc = this.target[key];
        if (!tc) continue;
        if (m.color) m.color.copy(tc);
        if (m.emissive && /glow|eye|headlight/.test(key)) m.emissive.copy(tc);
      }
      if (this.lights.ambient) this.lights.ambient.color.copy(this.target.ambient);
      if (this.lights.rim) this.lights.rim.color.copy(this.target.rimLight);
      if (this.extras.ringMat) this.extras.ringMat.color.copy(this.target.glow);
      if (this.extras.particleMat) this.extras.particleMat.color.copy(this.target.glow2);
      if (this.extras.floorMat) this.extras.floorMat.color.copy(this.target.floor);
    }
    update(dt) {
      const f = clamp(dt / this.transition, 0, 1);
      for (const key in this.mats) {
        const m = this.mats[key], tc = this.target[key];
        if (!tc) continue;
        if (m.color) m.color.lerp(tc, f);
        if (m.emissive && /glow|eye|headlight/.test(key)) m.emissive.lerp(tc, f);
      }
      if (this.lights.ambient) this.lights.ambient.color.lerp(this.target.ambient, f);
      if (this.lights.rim) this.lights.rim.color.lerp(this.target.rimLight, f);
      if (this.extras.ringMat) this.extras.ringMat.color.lerp(this.target.glow, f);
      if (this.extras.particleMat) this.extras.particleMat.color.lerp(this.target.glow2, f);
      if (this.extras.floorMat) this.extras.floorMat.color.lerp(this.target.floor, f);
    }
  }

  /* =======================================================================
     车身轮廓：沿 X 轴挤出侧视轮廓 + 逐顶点收腰 —— 得到真正的超跑楔形
     pts: [[z, y], ...] 侧视多边形（z=车长方向，y=高度）
     ======================================================================= */
  function profileBody(pts, width, taper, mat, bevel) {
    const shape = new THREE.Shape();
    pts.forEach(([z, y], i) => { i ? shape.lineTo(z, y) : shape.moveTo(z, y); });
    shape.closePath();
    const b = bevel === undefined ? 0.016 : bevel;
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: width, bevelEnabled: true,
      bevelThickness: b, bevelSize: b, bevelSegments: 2, steps: 1, curveSegments: 8,
    });
    // 轮廓 x 轴 -> 世界 z 轴；挤出方向 -> 世界 x 轴
    geo.rotateY(-Math.PI / 2);
    geo.translate(width / 2, 0, 0);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const f = taper ? taper(pos.getZ(i), pos.getY(i)) : 1;
      pos.setX(i, pos.getX(i) * f);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat);
  }

  /* =======================================================================
     轮子（胎肩倒角 / 轮圈 / 六辐条 / 刹车盘 / 卡钳 / 发光环）
     ======================================================================= */
  function buildWheel(M, r) {
    const g = new THREE.Group();
    const spin = new THREE.Group(); g.add(spin);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.14, 32), M.tire);
    tire.rotation.z = Math.PI / 2; spin.add(tire);
    // 胎肩倒角，消除"圆柱感"
    const shL = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r, 0.028, 32), M.tire);
    shL.rotation.z = -Math.PI / 2; shL.position.x = 0.072; spin.add(shL);
    const shR = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r, 0.028, 32), M.tire);
    shR.rotation.z = Math.PI / 2; shR.position.x = -0.072; spin.add(shR);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.70, r * 0.70, 0.152, 28), M.metal);
    rim.rotation.z = Math.PI / 2; spin.add(rim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.2, r * 0.2, 0.165, 16), M.joint);
    hub.rotation.z = Math.PI / 2; spin.add(hub);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.02, 22), M.joint);
    disc.rotation.z = Math.PI / 2; spin.add(disc);
    for (let i = 0; i < 6; i++) {
      const sp = box(0.022, r * 0.96, 0.048, M.metal);
      sp.rotation.x = (i * Math.PI) / 3; spin.add(sp);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, 0.014, 8, 30), M.glow);
    ring.rotation.y = Math.PI / 2; spin.add(ring);
    const caliper = box(0.045, r * 0.42, 0.045, M.glow2);
    caliper.position.set(0, r * 0.33, 0); spin.add(caliper);
    return { group: g, spin };
  }

  /* =======================================================================
     头部（机甲头盔 / 车形态时压缩为低趴座舱盖）
     ======================================================================= */
  function buildHead(M) {
    const g = new THREE.Group();
    const helmet = roundedBox(0.40, 0.34, 0.40, 0.10, M.armor); g.add(helmet);
    const crown = roundedBox(0.30, 0.08, 0.30, 0.04, M.body); crown.position.y = 0.17; g.add(crown);
    const jaw = roundedBox(0.24, 0.09, 0.26, 0.03, M.joint); jaw.position.set(0, -0.16, 0.03); g.add(jaw);
    const face = box(0.26, 0.13, 0.03, M.metal); face.position.set(0, -0.062, 0.19); g.add(face);
    const brow = box(0.34, 0.028, 0.04, M.metal); brow.position.set(0, 0.108, 0.192); g.add(brow);
    // 眼睛藏在面罩内侧，透过玻璃发光（车形态时即挡风玻璃的 HUD 微光）
    const eyeL = box(0.086, 0.040, 0.014, M.eye); eyeL.position.set(-0.075, 0.042, 0.196); g.add(eyeL);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.075; g.add(eyeR);
    const visor = box(0.33, 0.115, 0.035, M.glass); visor.position.set(0, 0.042, 0.188); g.add(visor);
    const finL = box(0.022, 0.15, 0.19, M.metal); finL.position.set(0.205, 0.03, -0.02); g.add(finL);
    const finR = finL.clone(); finR.position.x = -0.205; g.add(finR);
    const ant = box(0.016, 0.13, 0.016, M.glow2); ant.position.set(0.13, 0.225, -0.07); g.add(ant);
    return { group: g, eyes: [eyeL, eyeR] };
  }

  /* =======================================================================
     手臂（肩甲 / 上臂 / 肘 / 前臂 / 手掌 / 手指）
     ======================================================================= */
  function buildArm(M) {
    const g = new THREE.Group(); // 枢轴在肩部
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), M.joint); g.add(shoulder);
    const pauldron = roundedBox(0.17, 0.19, 0.21, 0.05, M.armor);
    pauldron.position.set(0.03, -0.035, 0); g.add(pauldron);
    const upper = roundedBox(0.115, 0.26, 0.125, 0.035, M.metal); upper.position.y = -0.24; g.add(upper);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.058, 14, 10), M.joint); elbow.position.y = -0.39; g.add(elbow);
    const fore = roundedBox(0.135, 0.27, 0.145, 0.035, M.armor); fore.position.y = -0.55; g.add(fore);
    // 前臂护板（车形态时收进车身）
    const shield = roundedBox(0.028, 0.26, 0.16, 0.02, M.body);
    shield.position.set(0.085, -0.55, 0); g.add(shield);
    // 手
    const palm = box(0.105, 0.09, 0.085, M.joint); palm.position.y = -0.725; g.add(palm);
    for (let i = 0; i < 3; i++) {
      const f = box(0.028, 0.085, 0.028, M.metal);
      f.position.set(-0.032 + i * 0.032, -0.805, 0.012); g.add(f);
    }
    const thumb = box(0.028, 0.07, 0.028, M.metal); thumb.position.set(0.068, -0.745, 0.012); g.add(thumb);
    return g;
  }

  /* =======================================================================
     腿（髋球 / 大腿 / 膝关节 / 小腿 / 液压活塞 / 脚掌）
     ======================================================================= */
  function buildLeg(M) {
    const g = new THREE.Group(); // 枢轴在髋部
    const hip = new THREE.Mesh(new THREE.SphereGeometry(0.078, 14, 10), M.joint); g.add(hip);
    const thigh = roundedBox(0.175, 0.34, 0.195, 0.045, M.armor); thigh.position.y = -0.21; g.add(thigh);
    const knee = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.19, 16), M.metal);
    knee.rotation.z = Math.PI / 2; knee.position.y = -0.41; g.add(knee);
    const shin = roundedBox(0.155, 0.34, 0.175, 0.045, M.body); shin.position.y = -0.61; g.add(shin);
    const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.28, 8), M.metal);
    piston.position.set(0.092, -0.58, 0.07); g.add(piston);
    const foot = roundedBox(0.195, 0.085, 0.32, 0.03, M.metal); foot.position.set(0, -0.83, 0.065); g.add(foot);
    const toe = box(0.175, 0.05, 0.09, M.joint); toe.position.set(0, -0.845, 0.225); g.add(toe);
    return g;
  }

  /* =======================================================================
     组装骨架（超跑 <-> 机甲 两种姿态，部件级刚性变形）
     ======================================================================= */
  const BODY_W = 1.02;
  const WHEEL_R = 0.215;

  function buildRig(M) {
    const root = new THREE.Group();
    const parts = {};
    const pose = (p, r, s) => ({ p: p || [0, 0, 0], r: r || [0, 0, 0], s: s || [1, 1, 1] });
    function addPart(name, group, car, robot, delay) {
      parts[name] = { group, car, robot, delay: delay || 0 };
      root.add(group);
    }

    /* ---------- 前段车身（引擎盖/前鼻）→ 胸甲 ---------- */
    const chest = new THREE.Group();
    chest.add(profileBody([
      [-0.62, 0.118], [-0.22, 0.134], [0.20, 0.088], [0.47, 0.020], [0.60, -0.050],
      [0.60, -0.122], [0.24, -0.142], [-0.62, -0.134],
    ], BODY_W, (z) => 1 - 0.30 * Math.pow(clamp((z + 0.62) / 1.22, 0, 1), 1.5), M.body, 0.018));
    // 引擎盖散热格栅
    const hoodVent = roundedBox(0.36, 0.03, 0.26, 0.012, M.carbon);
    hoodVent.position.set(0, 0.126, -0.10); hoodVent.rotation.x = 0.055; chest.add(hoodVent);
    const hoodRib = box(0.34, 0.016, 0.016, M.metal);
    hoodRib.position.set(0, 0.142, -0.10); hoodRib.rotation.x = 0.055; chest.add(hoodRib);
    // 大灯（锐角 LED 灯条）
    const hlL = box(0.19, 0.028, 0.055, M.headlight);
    hlL.position.set(0.195, 0.042, 0.435); hlL.rotation.z = 0.18; hlL.rotation.x = -0.14; chest.add(hlL);
    const hlR = hlL.clone(); hlR.position.x = -0.195; hlR.rotation.z = -0.18; chest.add(hlR);
    // 前分流器 + 侧翼
    const splitter = box(0.70, 0.028, 0.22, M.carbon);
    splitter.position.set(0, -0.150, 0.44); chest.add(splitter);
    const canardL = box(0.13, 0.018, 0.085, M.carbon);
    canardL.position.set(0.395, -0.062, 0.29); canardL.rotation.z = 0.14; chest.add(canardL);
    const canardR = canardL.clone(); canardR.position.x = -0.395; canardR.rotation.z = -0.14; chest.add(canardR);
    // 侧进气格栅
    for (let i = 0; i < 3; i++) {
      const sl = box(0.018, 0.05, 0.15, M.carbon);
      sl.position.set(0.437, -0.035 + i * 0.048, 0.02); sl.rotation.x = -0.12; chest.add(sl);
      const sr = sl.clone(); sr.position.x = -0.437; chest.add(sr);
    }
    // 座舱：低趴玻璃穹顶（机甲形态时成为胸口驾驶舱）
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(0.30, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.glass);
    canopy.scale.set(1.0, 0.50, 0.95);
    canopy.position.set(0, 0.108, -0.40); chest.add(canopy);
    const canopyFrame = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.012, 6, 40), M.metal);
    canopyFrame.rotation.x = -Math.PI / 2; canopyFrame.scale.set(1.0, 0.95, 1);
    canopyFrame.position.set(0, 0.112, -0.40); chest.add(canopyFrame);
    addPart('chest', chest,
      pose([0, 0.32, 0.62], [0, 0, 0], [1, 1, 1]),
      pose([0, 1.50, 0.01], [Math.PI / 2, 0, 0], [0.60, 1.05, 0.52]), 0.0);

    /* ---------- 后段车身（尾舱）→ 骨盆 ---------- */
    const pelvis = new THREE.Group();
    pelvis.add(profileBody([
      [-0.62, 0.048], [-0.44, 0.128], [0.16, 0.146], [0.62, 0.118],
      [0.62, -0.134], [-0.28, -0.145], [-0.62, -0.108],
    ], BODY_W, (z) => 1 - 0.06 * (1 - clamp((z + 0.62) / 1.24, 0, 1)), M.body, 0.018));
    // 尾部灯带
    const tail = box(0.84, 0.036, 0.03, M.glow2);
    tail.position.set(0, 0.075, -0.615); pelvis.add(tail);
    const tailCore = box(0.50, 0.018, 0.02, M.glow);
    tailCore.position.set(0, 0.075, -0.625); pelvis.add(tailCore);
    // 发动机舱散热鳍片
    for (let i = 0; i < 3; i++) {
      const f = box(0.60, 0.014, 0.05, M.carbon);
      f.position.set(0, 0.150, -0.16 - i * 0.10); pelvis.add(f);
    }
    // 尾部扩散器 + 排气
    const diffuser = box(0.78, 0.075, 0.14, M.carbon);
    diffuser.position.set(0, -0.115, -0.60); pelvis.add(diffuser);
    const exL = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.10, 12), M.metal);
    exL.rotation.x = Math.PI / 2; exL.position.set(0.17, -0.02, -0.645); pelvis.add(exL);
    const exR = exL.clone(); exR.position.x = -0.17; pelvis.add(exR);
    // 鲨鱼鳍
    const shark = box(0.022, 0.075, 0.26, M.armor);
    shark.position.set(0, 0.185, -0.34); pelvis.add(shark);
    addPart('pelvis', pelvis,
      pose([0, 0.32, -0.62], [0, 0, 0], [1, 1, 1]),
      pose([0, 1.02, 0.01], [Math.PI / 2, 0, 0], [0.50, 1.08, 0.26]), 0.08);

    /* ---------- 腰部核心 ---------- */
    const abdomen = new THREE.Group();
    abdomen.add(roundedBox(0.42, 0.22, 0.34, 0.05, M.joint));
    const core = box(0.15, 0.035, 0.05, M.glow); core.position.set(0, 0.015, 0.20); abdomen.add(core);
    const ribL = box(0.02, 0.13, 0.03, M.metal); ribL.position.set(0.11, 0.01, 0.20); abdomen.add(ribL);
    const ribR = ribL.clone(); ribR.position.x = -0.11; abdomen.add(ribR);
    addPart('abdomen', abdomen,
      pose([0, 0.31, 0.02], [0, 0, 0], [1.05, 0.92, 1.15]),
      pose([0, 1.19, 0.03], [0, 0, 0], [0.90, 1.10, 0.90]), 0.12);

    /* ---------- 头部 / 座舱盖 ---------- */
    const head = buildHead(M);
    addPart('head', head.group,
      pose([0, 0.300, -0.10], [0, 0, 0], [0.50, 0.50, 0.50]),
      pose([0, 1.94, 0.02], [0, 0, 0], [1, 1, 1]), 0.62);

    /* ---------- 手臂 ---------- */
    const armL = buildArm(M), armR = buildArm(M);
    addPart('armL', armL,
      pose([0.40, 0.31, 0.24], [Math.PI / 2, 0, 0]),
      pose([0.345, 1.70, 0.02], [0.05, 0, 0.13]), 0.50);
    addPart('armR', armR,
      pose([-0.40, 0.31, 0.24], [Math.PI / 2, 0, 0]),
      pose([-0.345, 1.70, 0.02], [0.05, 0, -0.13]), 0.50);

    /* ---------- 腿 ---------- */
    const legL = buildLeg(M), legR = buildLeg(M);
    addPart('legL', legL,
      pose([0.22, 0.28, -0.12], [Math.PI / 2, 0, 0], [1, 0.68, 0.75]),
      pose([0.155, 0.87, 0.01], [0, 0, 0], [1, 1, 1]), 0.38);
    addPart('legR', legR,
      pose([-0.22, 0.28, -0.12], [Math.PI / 2, 0, 0], [1, 0.68, 0.75]),
      pose([-0.155, 0.87, 0.01], [0, 0, 0], [1, 1, 1]), 0.38);

    /* ---------- 车轮（车=四角 / 机甲=背部推进器阵列）---------- */
    const wFL = buildWheel(M, WHEEL_R), wFR = buildWheel(M, WHEEL_R);
    const wRL = buildWheel(M, WHEEL_R), wRR = buildWheel(M, WHEEL_R);
    addPart('wheelFL', wFL.group,
      pose([0.50, WHEEL_R, 0.79], [0, 0, 0]),
      pose([0.235, 1.60, -0.30], [0, Math.PI / 2, 0]), 0.42);
    addPart('wheelFR', wFR.group,
      pose([-0.50, WHEEL_R, 0.79], [0, 0, 0]),
      pose([-0.235, 1.60, -0.30], [0, Math.PI / 2, 0]), 0.42);
    addPart('wheelRL', wRL.group,
      pose([0.50, WHEEL_R, -0.79], [0, 0, 0]),
      pose([0.235, 1.16, -0.30], [0, Math.PI / 2, 0]), 0.42);
    addPart('wheelRR', wRR.group,
      pose([-0.50, WHEEL_R, -0.79], [0, 0, 0]),
      pose([-0.235, 1.16, -0.30], [0, Math.PI / 2, 0]), 0.42);

    /* ---------- 尾翼 → 背包翼 ---------- */
    const spoiler = new THREE.Group();
    const wing = roundedBox(0.82, 0.05, 0.24, 0.025, M.carbon); wing.position.y = 0.06; spoiler.add(wing);
    const wingTipL = box(0.02, 0.10, 0.22, M.armor); wingTipL.position.set(0.41, 0.055, 0); spoiler.add(wingTipL);
    const wingTipR = wingTipL.clone(); wingTipR.position.x = -0.41; spoiler.add(wingTipR);
    const supL = box(0.035, 0.16, 0.05, M.metal); supL.position.set(0.28, -0.03, 0); spoiler.add(supL);
    const supR = supL.clone(); supR.position.x = -0.28; spoiler.add(supR);
    const wingGlow = box(0.66, 0.016, 0.035, M.glow2); wingGlow.position.set(0, 0.095, 0.09); spoiler.add(wingGlow);
    addPart('spoiler', spoiler,
      pose([0, 0.50, -1.10], [-0.10, 0, 0]),
      pose([0, 1.90, -0.26], [0.18, 0, 0]), 0.30);

    /* ---------- 侧进气 → 肩甲 ---------- */
    const intakeL = new THREE.Group();
    intakeL.add(roundedBox(0.12, 0.16, 0.42, 0.03, M.carbon));
    intakeL.add(roundedBox(0.05, 0.06, 0.34, 0.015, M.glow2));
    addPart('intakeL', intakeL,
      pose([0.455, 0.355, 0.26], [0, 0, 0]),
      pose([0.315, 1.80, 0.0], [0, 0, -0.22]), 0.45);
    const intakeR = new THREE.Group();
    intakeR.add(roundedBox(0.12, 0.16, 0.42, 0.03, M.carbon));
    intakeR.add(roundedBox(0.05, 0.06, 0.34, 0.015, M.glow2));
    addPart('intakeR', intakeR,
      pose([-0.455, 0.355, 0.26], [0, 0, 0]),
      pose([-0.315, 1.80, 0.0], [0, 0, 0.22]), 0.45);

    return { root, parts, wheels: [wFL, wFR, wRL, wRR], eyes: head.eyes, mats: M };
  }

  /* =======================================================================
     变形控制器（含安全队列）
     ======================================================================= */
  class TransformationController {
    constructor(rig) {
      this.rig = rig;
      this.progress = 0;
      this.target = 0;
      this.duration = REDUCED ? 0.4 : 1.8;
      this.active = false;
      this.pending = null;
      this.apply(0);
    }
    get isRobot() { return this.target > 0.5; }
    toRobot() { this._request(1); }
    toCar() { this._request(0); }
    toggle() { this._request(this.target > 0.5 ? 0 : 1); }
    _request(v) {
      v = v > 0.5 ? 1 : 0;
      if (this.active) { this.pending = v; return; } // 安全排队：进行中只记录最后一次意图
      if (Math.abs(this.progress - v) < 0.001) { this.progress = v; this.target = v; this.apply(v); return; }
      this.target = v; this.active = true;
    }
    setInstant(v) { this.progress = v; this.target = v; this.active = false; this.pending = null; this.apply(v); }
    update(dt) {
      if (!this.active) return;
      const dir = Math.sign(this.target - this.progress);
      if (dir === 0) { this.active = false; return; }
      this.progress += dir * (dt / this.duration);
      if ((dir > 0 && this.progress >= this.target) || (dir < 0 && this.progress <= this.target)) {
        this.progress = this.target;
        this.active = false;
        if (this.pending !== null && this.pending !== this.target) {
          const p = this.pending; this.pending = null; this._request(p);
        }
      }
      this.apply(this.progress);
    }
    apply(t) {
      for (const name in this.rig.parts) {
        const part = this.rig.parts[name];
        const d = part.delay;
        const local = clamp((t - d) / (1 - d || 1), 0, 1);
        const e = easeInOut(local);
        const { car, robot } = part;
        const p = lerp3(car.p, robot.p, e);
        part.group.position.set(p[0], p[1], p[2]);
        part.group.rotation.set(lerp(car.r[0], robot.r[0], e), lerp(car.r[1], robot.r[1], e), lerp(car.r[2], robot.r[2], e));
        part.group.scale.set(lerp(car.s[0], robot.s[0], e), lerp(car.s[1], robot.s[1], e), lerp(car.s[2], robot.s[2], e));
      }
    }
  }

  /* =======================================================================
     动画状态控制器
     ======================================================================= */
  class CompanionAnimationController {
    constructor(rig, transform, theme) {
      this.rig = rig; this.transform = transform; this.theme = theme;
      this.state = 'CAR_IDLE';
      this.t = 0; this.stateTime = 0;
      this.blinkTimer = 1.5; this.blink = 0;
    }
    setState(s) { if (this.state === s) return; this.state = s; this.stateTime = 0; }
    greet() { this.setState('GREETING'); }
    think() { this.setState('THINKING'); }
    celebrate() { this.setState('EXCITED'); }
    warn() { this.setState('WARNING'); }
    sleep() { this.setState('SLEEPING'); }
    wake() { this.setState(this.transform.isRobot ? 'ROBOT_IDLE' : 'CAR_IDLE'); }

    update(dt) {
      this.t += dt; this.stateTime += dt;
      const p = this.transform.progress;
      const rig = this.rig, M = rig.mats, parts = rig.parts;

      const float = Math.sin(this.t * 1.5) * 0.028;
      rig.root.position.y = float;

      const wheelSpeed = this.state === 'EXCITED' ? 8 : 1.1;
      rig.wheels.forEach((w, i) => { w.spin.rotation.x += dt * wheelSpeed * (i % 2 ? -1 : 1); });

      const pulse = 0.7 + Math.sin(this.t * 2.2) * 0.3;
      M.glow.emissiveIntensity = 1.9 + pulse * 0.9;
      M.glow2.emissiveIntensity = 1.5 + pulse * 0.7;

      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) { this.blink = 0.13; this.blinkTimer = 2.4 + Math.random() * 2.4; }
      if (this.blink > 0) this.blink -= dt;
      const eyeScaleY = this.blink > 0 ? 0.15 : 1;
      rig.eyes.forEach((e) => { e.scale.y = eyeScaleY; });

      let eyeGlow = 2.8 + pulse * 0.9;
      if (this.state === 'THINKING') eyeGlow = 2.2 + Math.sin(this.t * 6) * 1.4;
      M.eye.emissiveIntensity = eyeGlow;

      const head = parts.head.group, armL = parts.armL.group, armR = parts.armR.group, hull = parts.chest.group;
      // 注意：以下全部是"在变形姿态之上叠加"的偏移，不能覆盖 pose
      hull.scale.y *= 1 + Math.sin(this.t * 1.7) * 0.012 * p;
      head.rotation.z += Math.sin(this.t * 0.9) * 0.05 * p;
      head.rotation.x += Math.sin(this.t * 1.1) * 0.04 * p;

      // 主题眼睛颜色（WARNING 覆盖为琥珀色）
      const eyeBase = this.theme.target.eye;
      if (this.state === 'WARNING') {
        M.eye.emissive.lerp(new THREE.Color(0xffb020), clamp(dt * 6, 0, 1));
        M.eye.emissiveIntensity = 2.2 + Math.sin(this.t * 4) * 0.8;
        if (this.stateTime > 1.8) this.wake();
      } else {
        M.eye.emissive.lerp(eyeBase, clamp(dt * 4, 0, 1));
      }

      if (this.state === 'GREETING') {
        const k = Math.min(this.stateTime / 0.5, 1) * Math.max(0, 1 - Math.max(0, this.stateTime - 1.1) / 0.4);
        if (p > 0.5) { armR.rotation.z -= 1.5 * k; head.rotation.z += 0.12 * k; }
        else { M.headlight.emissiveIntensity = 3 + k * 4; rig.root.position.y = float + k * 0.05; }
        if (this.stateTime > 1.6) this.setState(p > 0.5 ? 'ROBOT_IDLE' : 'CAR_IDLE');
      } else if (this.state === 'THINKING') {
        head.rotation.z += 0.18; head.rotation.x += -0.12 + Math.sin(this.t * 3) * 0.03;
        armR.rotation.z -= 0.9; armR.rotation.x += -0.5;
      } else if (this.state === 'EXCITED') {
        const k = Math.sin(Math.min(this.stateTime / 0.35, 1) * Math.PI);
        if (p > 0.5) { armL.rotation.z += 1.3 * k; armR.rotation.z -= 1.3 * k; rig.root.position.y = float + Math.abs(Math.sin(this.stateTime * 8)) * 0.06 * k; }
        else { rig.root.position.y = float + Math.abs(Math.sin(this.stateTime * 10)) * 0.05 * k; M.headlight.emissiveIntensity = 3 + k * 5; }
        if (this.stateTime > 1.8) this.setState(p > 0.5 ? 'ROBOT_IDLE' : 'CAR_IDLE');
      } else if (this.state === 'SLEEPING') {
        head.rotation.x += 0.22; head.rotation.z += 0.05;
        M.eye.emissiveIntensity = 0.4; M.glow.emissiveIntensity = 0.5; M.headlight.emissiveIntensity = 0.8;
        rig.root.position.y = float * 0.3 - 0.03;
      } else {
        M.headlight.emissiveIntensity = 2.6 + (Math.sin(this.t * 1.3) > 0.6 ? 1.2 : 0);
      }
    }
  }

  /* =======================================================================
     场景 + 环境
     ======================================================================= */
  class Robot3DScene {
    constructor(container) {
      this.container = container;
      this.M = makeMaterials();
      this.rig = buildRig(this.M);
      this.rig.root.rotation.y = 0.34;

      this.scene = new THREE.Scene();
      this.scene.add(this.rig.root);
      this.envDark = makeEnvTexture('dark');
      this.envLight = makeEnvTexture('light');
      this.scene.environment = this.envDark;
      this._envFade = 1;
      this._envKeys = ['body', 'armor', 'metal', 'carbon', 'joint', 'glass'];

      this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
      this.camera.position.set(2.30, 0.60, 3.25);
      this._lookY = 0.26;
      this.camera.lookAt(0, this._lookY, 0);

      const ambient = new THREE.AmbientLight(0x3a4a66, 2.0);
      this.scene.add(ambient);
      const key = new THREE.DirectionalLight(0xffffff, 3.4); key.position.set(3, 5, 4); this.scene.add(key);
      const front = new THREE.DirectionalLight(0xbcd8ff, 2.0); front.position.set(-0.6, 1.4, 5); this.scene.add(front);
      const rim = new THREE.DirectionalLight(0x00cfff, 2.4); rim.position.set(-4, 2, -3); this.scene.add(rim);
      const rim2 = new THREE.DirectionalLight(0x7fd4ff, 1.9); rim2.position.set(-5, 2.6, 2.4); this.scene.add(rim2);
      const fill = new THREE.DirectionalLight(0xa78bfa, 0.9); fill.position.set(-2, 1, 4); this.scene.add(fill);
      const bounce = new THREE.DirectionalLight(0x2f7fd0, 1.1); bounce.position.set(0.5, -2, 2.5); this.scene.add(bounce);
      const chest = new THREE.PointLight(0x00cfff, 2.2, 6); chest.position.set(0, 1.5, 0.6); this.scene.add(chest);
      this.lights = { ambient, rim };

      // 接触阴影（让模型"落地"，浅色主题尤其关键）
      this.shadowMat = new THREE.MeshBasicMaterial({ map: makeShadowTexture(), transparent: true, opacity: 0.34, depthWrite: false });
      this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.shadowMat);
      this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.008; this.shadow.renderOrder = 2;
      this.scene.add(this.shadow);

      // 地面：自发光圆盘 + 能量环（随形态缩放）
      this.ground = new THREE.Group();
      this.scene.add(this.ground);
      this.floorMat = new THREE.MeshBasicMaterial({ color: 0x0a1830, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false });
      const floor = new THREE.Mesh(new THREE.CircleGeometry(1.0, 44), this.floorMat);
      floor.rotation.x = -Math.PI / 2; floor.position.y = 0.004; this.ground.add(floor);

      const ringMat = new THREE.MeshBasicMaterial({ color: 0x00cfff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.015, 8, 60), ringMat);
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; this.ground.add(ring);
      this.ring = ring;
      const ring2Mat = new THREE.MeshBasicMaterial({ color: 0x36afff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending });
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.008, 8, 60), ring2Mat);
      ring2.rotation.x = -Math.PI / 2; ring2.position.y = 0.02; this.ground.add(ring2);

      // 粒子
      const N = 42, pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 2.2;
        pos[i * 3 + 1] = Math.random() * 2.4 + 0.3;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 2.2;
      }
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.particleMat = new THREE.PointsMaterial({ color: 0x36afff, size: 0.028, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
      this.particles = new THREE.Points(pg, this.particleMat);
      this.scene.add(this.particles);

      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      if (THREE.SRGBColorSpace) this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.3;
      this.renderer.domElement.className = 'companion-canvas';

      this.transform = new TransformationController(this.rig);
      this.theme = new ThemeMaterialController(this.M, this.lights, { ringMat, particleMat: this.particleMat, floorMat: this.floorMat, shadowMat: this.shadowMat, renderer: this.renderer });
      this.anim = new CompanionAnimationController(this.rig, this.transform, this.theme);

      // 跟随应用主题
      const readTheme = () => {
        const t = document.documentElement.getAttribute('data-theme');
        return t === 'light' ? 'light' : 'dark';
      };
      this.theme.setTheme(readTheme(), true);
      this.setEnvironment(readTheme(), true);
      this._themeObserver = new MutationObserver(() => {
        const t = readTheme();
        if (t === this.theme.theme) return;
        this.theme.setTheme(t, false);
        this.setEnvironment(t, false);
      });
      this._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

      this.clock = new THREE.Clock();
      this.running = false;
      this._onResize = () => this.resize();
      window.addEventListener('resize', this._onResize);
      this.resize();
    }

    setEnvironment(name, instant) {
      const next = name === 'light' ? this.envLight : this.envDark;
      if (this.scene.environment === next) return;
      this.scene.environment = next;
      // 环境贴图替换的瞬间金属反射会跳变，用一次"重新打光"柔化
      this._envFade = instant ? 1 : 0;
      if (instant) this._envKeys.forEach((k) => { this.M[k].envMapIntensity = 1.2; });
    }

    resize() {
      const w = this.container.clientWidth || 200;
      const h = this.container.clientHeight || 180;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.clock.start();
      const loop = () => {
        if (!this.running) return;
        this._raf = requestAnimationFrame(loop);
        if (document.hidden) return;
        const dt = Math.min(this.clock.getDelta(), 0.05);
        this.theme.update(dt);
        if (this._envFade < 1) {
          this._envFade = Math.min(1, this._envFade + dt / 0.45);
          const k = 0.45 + 0.55 * this._envFade;
          this._envKeys.forEach((key) => { this.M[key].envMapIntensity = 1.2 * k; });
        }
        this.transform.update(dt);
        // 每帧重建基础姿态，动画控制器在其上叠加偏移
        this.transform.apply(this.transform.progress);
        this.anim.update(dt);
        // 镜头随形态自动构图：车形态低角度看楔形，机甲形态平视
        const p = this.transform.progress;
        this._lookY += (lerp(0.26, 1.16, p) - this._lookY) * clamp(dt * 3.2, 0, 1);
        this.camera.position.set(
          lerp(2.30, 2.10, p),
          lerp(0.60, 1.58, p),
          lerp(3.25, 3.02, p)
        );
        this.camera.lookAt(0, this._lookY, 0);
        // 地面与阴影随形态切换尺度
        this.ground.scale.setScalar(lerp(1.10, 0.90, p));
        this.shadow.scale.set(lerp(1.70, 1.12, p), lerp(2.70, 0.92, p), 1);
        this.ring.material.opacity = 0.35 + Math.sin(performance.now() * 0.002) * 0.18;
        this.particles.rotation.y += dt * 0.22;
        this.particles.position.y = Math.sin(performance.now() * 0.0008) * 0.1;
        this.renderer.render(this.scene, this.camera);
      };
      loop();
    }
    stop() { this.running = false; if (this._raf) cancelAnimationFrame(this._raf); }
    dispose() {
      this.stop();
      if (this._themeObserver) this._themeObserver.disconnect();
      window.removeEventListener('resize', this._onResize);
      this.renderer.dispose();
    }
  }

  /* =======================================================================
     交互
     ======================================================================= */
  class CompanionInteractionHandler {
    constructor(companion) {
      this.c = companion;
      this.pressTimer = null; this.clickTimer = null;
      this.downPos = null; this.moved = false; this.longPressed = false;
    }
    bind(el) {
      if (this._boundEl === el) return;
      this._boundEl = el;
      el.addEventListener('click', (e) => this.onClick(e));
      el.addEventListener('dblclick', (e) => {
        e.preventDefault();
        if (this.clickTimer) { clearTimeout(this.clickTimer); this.clickTimer = null; }
        this.c.toggleForm();
      });
      el.addEventListener('pointerdown', (e) => this.onDown(e));
      el.addEventListener('pointerup', () => this.clearPress());
      el.addEventListener('pointerleave', () => this.clearPress());
      el.addEventListener('pointermove', (e) => this.onMove(e));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    onDown(e) {
      this.downPos = { x: e.clientX, y: e.clientY };
      this.moved = false; this.longPressed = false;
      this.clearPress();
      this.pressTimer = setTimeout(() => {
        this.pressTimer = null; this.longPressed = true;
        this.c.openMenu(e.clientX, e.clientY);
      }, 520);
    }
    onMove(e) {
      if (!this.downPos) return;
      if (Math.abs(e.clientX - this.downPos.x) + Math.abs(e.clientY - this.downPos.y) > 8) { this.moved = true; this.clearPress(); }
    }
    clearPress() { if (this.pressTimer) { clearTimeout(this.pressTimer); this.pressTimer = null; } }
    onClick(e) {
      if (this.moved) { this.moved = false; return; }
      if (this.longPressed) { this.longPressed = false; return; }
      if (this.pressTimer) return;
      if (this.clickTimer) return;
      this.clickTimer = setTimeout(() => { this.clickTimer = null; this.c.onClick(e.clientX, e.clientY); }, 220);
    }
  }

  /* =======================================================================
     主控
     ======================================================================= */
  class RobotCompanion {
    constructor() { this.scene = null; this.interaction = null; this.mountEl = null; this.menuEl = null; }
    attach(container) {
      this.mountEl = container;
      let created = false;
      if (!this.scene) {
        try { this.scene = new Robot3DScene(container); }
        catch (err) { console.warn('[companion] WebGL 初始化失败，使用降级视觉', err); this.renderFallback(container); return; }
        this.interaction = new CompanionInteractionHandler(this);
        created = true;
      }
      if (this.scene.renderer.domElement.parentNode !== container) container.appendChild(this.scene.renderer.domElement);
      this.scene.container = container;
      this.scene.resize();
      this.scene.start();
      this.interaction.bind(container);
      if (created) {
        this.startAutoTransform();
        try {
          const params = new URLSearchParams(location.search);
          const qForm = params.get('form'); const qT = params.get('t');
          if (qForm === 'robot') this.scene.transform.setInstant(1);
          else if (qForm === 'car') this.scene.transform.setInstant(0);
          else if (qT !== null) this.scene.transform.setInstant(clamp(parseFloat(qT) || 0, 0, 1));
        } catch (e) {}
      }
    }
    detach() { if (this.scene) this.scene.stop(); this.closeMenu(); }

    renderFallback(container) {
      container.innerHTML = '<div class="companion-fallback" title="3D 不可用">' +
        '<svg viewBox="0 0 120 60" width="90" height="45"><rect x="8" y="26" width="104" height="20" rx="10" fill="#111827" stroke="#00cfff" stroke-width="2"/><circle cx="34" cy="48" r="8" fill="#111"/><circle cx="86" cy="48" r="8" fill="#111"/><rect x="44" y="16" width="34" height="14" rx="6" fill="#00cfff" opacity="0.6"/></svg>' +
        '<span>3D 不可用</span></div>';
    }

    onClick(x, y) { this.ripple(x, y); this.scene && this.scene.anim.greet(); }
    toggleForm() { if (!this.scene) return; this.scene.transform.toggle(); this.scene.anim.wake(); }
    greet() { this.scene && this.scene.anim.greet(); }
    celebrate() { this.scene && this.scene.anim.celebrate(); }
    think() { this.scene && this.scene.anim.think(); }
    warn() { this.scene && this.scene.anim.warn(); }
    acknowledge() { this.scene && this.scene.anim.greet(); }
    sleep() { this.scene && this.scene.anim.sleep(); }
    setForm(form) { if (!this.scene) return; form === 'robot' ? this.scene.transform.toRobot() : this.scene.transform.toCar(); }
    setTheme(name) {
      if (!this.scene) return;
      this.scene.theme.setTheme(name, false);
      this.scene.setEnvironment(name, false);
    }

    ripple(x, y) {
      if (!this.mountEl) return;
      const r = document.createElement('span');
      r.className = 'companion-ripple';
      const rect = this.mountEl.getBoundingClientRect();
      r.style.left = (x - rect.left) + 'px'; r.style.top = (y - rect.top) + 'px';
      this.mountEl.appendChild(r);
      setTimeout(() => r.remove(), 700);
    }

    openMenu(x, y) {
      this.closeMenu();
      const menu = document.createElement('div');
      menu.className = 'companion-menu';
      menu.innerHTML =
        '<button data-act="toggle">🔄 变形 Transform</button>' +
        '<button data-act="talk">💬 对话 Talk to AI</button>' +
        '<button data-act="settings">⚙️ 设置 Settings</button>';
      const rect = this.mountEl.getBoundingClientRect();
      menu.style.left = Math.min(x, rect.right - 160) + 'px';
      menu.style.top = (y + 8) + 'px';
      document.body.appendChild(menu);
      this.menuEl = menu;
      menu.addEventListener('click', (e) => {
        const act = e.target.getAttribute('data-act');
        if (!act) return;
        if (act === 'toggle') this.toggleForm();
        if (act === 'talk') { this.think(); window.dispatchEvent(new CustomEvent('companion:talk')); }
        if (act === 'settings') window.dispatchEvent(new CustomEvent('companion:settings'));
        this.closeMenu();
      });
      setTimeout(() => { document.addEventListener('click', this._closeOnce = () => this.closeMenu(), { once: true }); }, 0);
    }
    closeMenu() { if (this.menuEl) { this.menuEl.remove(); this.menuEl = null; } }

    startAutoTransform() {
      if (REDUCED) return;
      const tick = () => {
        if (!this.scene) return;
        if (!this.scene.transform.active && this.scene.anim.state.endsWith('_IDLE')) {
          this.scene.transform.toggle(); this.scene.anim.wake();
        }
        this._autoTimer = setTimeout(tick, 22000 + Math.random() * 14000);
      };
      this._autoTimer = setTimeout(tick, 18000);
    }
  }

  /* =======================================================================
     挂载
     ======================================================================= */
  const companion = new RobotCompanion();
  window.RobotCompanion = companion;

  function ensureMount() {
    const el = document.querySelector('#companion-mount');
    if (el) { if (companion.mountEl !== el) companion.attach(el); }
    else if (companion.mountEl) { companion.detach(); companion.mountEl = null; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureMount);
  else ensureMount();
  const mo = new MutationObserver(() => ensureMount());
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
