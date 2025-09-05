// Аркада: платформы + монеты + поздравление. Исправлены клики на iOS.
(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const hud = {
    score: document.getElementById('score'),
    time: document.getElementById('time'),
    lives: document.getElementById('lives'),
  };

  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modal-title');
  const modalText = document.getElementById('modal-text');
  const resumeBtn = document.getElementById('resumeBtn');
  const restartBtn = document.getElementById('restartBtn');
  const startModal = document.getElementById('startModal');
  const startBtn = document.getElementById('startBtn');

  const W = canvas.width;
  const H = canvas.height;

  // Utility: unified tap/click handler (helps on iOS)
  function onTap(el, handler) {
    if (!el) return;
    el.addEventListener('click', handler);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); handler(e); }, {passive:false});
  }

  // Consts
  const GRAVITY = 1800;
  const MOVE_SPEED = 240;
  const JUMP_VEL = -650;
  const FRICTION_GROUND = 0.85;
  const FRICTION_AIR = 0.98;
  const LEVEL_TIME = 60;
  const START_LIVES = 3;

  let state;

  function resetState() {
    state = {
      timeLeft: LEVEL_TIME,
      lives: START_LIVES,
      score: 0,
      paused: false,
      cameraX: 0,
      keys: {},
      level: generateLevel(),
      player: { x: 100, y: 0, w: 42, h: 42, vx: 0, vy: 0, grounded: false, onPlatform: null, face: 1 },
      coins: [],
      particles: [],
    };
    for (const p of state.level.platforms) {
      if (Math.random() < 0.75) {
        const count = 1 + (Math.random() * 3 | 0);
        for (let i = 0; i < count; i++) {
          const cx = p.x + 16 + Math.random() * Math.max(0, p.w - 32);
          const cy = p.y - 16 - Math.random()*10;
          state.coins.push({x: cx, y: cy, r: 10, vy: Math.random()*8-4, life: 0});
        }
      }
    }
  }

  function generateLevel() {
    const platforms = [];
    const hazards = [];
    const width = 4000;

    platforms.push({x: -200, y: H - 80, w: width + 400, h: 80, type: 'ground'});

    let x = 120;
    let y = H - 200;
    while (x < width - 400) {
      const w = 160 + (Math.random() * 180 | 0);
      platforms.push({x, y, w, h: 28, type: 'block'});
      if (Math.random() < 0.2) {
        platforms.push({x: x + w + 80, y: y - 80, w: 120, h: 24, type: 'moving', range: 160, phase: Math.random()*Math.PI*2});
      }
      if (Math.random() < 0.25) {
        const gap = 140 + Math.random()*120;
        hazards.push({x: x + w + 10, y: H - 40, w: gap, h: 40, type: 'lava'});
        x += w + gap + 180;
        y -= 40*(Math.random()<0.5?1:-1);
      } else {
        x += w + 140;
        y += (Math.random() < 0.5 ? -1 : 1) * 40;
      }
      y = Math.max(120, Math.min(H - 180, y));
    }

    const endFlag = {x: width - 140, y: H - 140, w: 18, h: 100};
    return {platforms, hazards, width, endFlag};
  }

  function aabbIntersect(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ah + ay > by;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  const keyMap = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'jump', Space: 'jump', KeyW: 'jump',
    KeyP: 'pause', Escape: 'pause',
  };

  window.addEventListener('keydown', (e) => {
    const act = keyMap[e.code];
    if (!act) return;
    if (act === 'pause') { togglePause(); e.preventDefault(); return; }
    state.keys[act] = true;
    if (act === 'jump') tryJump();
  });
  window.addEventListener('keyup', (e) => {
    const act = keyMap[e.code];
    if (!act) return;
    state.keys[act] = false;
  });


  // Touch controls for on-screen buttons
  document.querySelectorAll('.btn[data-key]').forEach(btn => {
    const code = btn.dataset.key;
    const act = keyMap[code];
    if (!act) return;
    let pressed = false;
    const down = (ev) => {
      ev.preventDefault();
      if (act === 'pause') { togglePause(); return; }
      state.keys[act] = true;
      if (act === 'jump') tryJump();
      pressed = true;
    };
    const up = (ev) => {
      ev.preventDefault();
      if (!pressed) return;
      state.keys[act] = false;
      pressed = false;
    };
    btn.addEventListener('touchstart', down, {passive:false});
    btn.addEventListener('touchend', up, {passive:false});
    btn.addEventListener('mousedown', down);
    btn.addEventListener('mouseup', up);
    btn.addEventListener('mouseleave', up);
  });

  onTap(resumeBtn, () => { setPause(false); });
  onTap(restartBtn, () => { resetState(); setPause(false); });
  onTap(startBtn, () => {
    startModal.classList.add('hidden');
    setPause(false);
  });

  function togglePause() { setPause(!state.paused); }
  function setPause(v) {
    state.paused = v;
    modal.classList.toggle('hidden', !v);
    modalTitle.textContent = v ? 'Пауза' : '';
    modalText.textContent = v ? 'Нажми «Продолжить», чтобы играть дальше.' : '';
  }

  const audioCtx = (() => {
    try { return new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return null; }
  })();

  function beep(freq = 880, dur = 0.08, type = 'square', vol = 0.05) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type; osc.frequency.value = freq; gain.gain.value = vol;
    osc.connect(gain).connect(audioCtx.destination);
    const now = audioCtx.currentTime; osc.start(now); osc.stop(now + dur);
  }

  function tryJump() {
    if (state.player.grounded) {
      state.player.vy = JUMP_VEL;
      state.player.grounded = false;
      state.player.onPlatform = null;
      beep(740, 0.09);
    }
  }

  let last = performance.now();
  function loop(t) {
    const dt = Math.min(0.033, (t - last) / 1000);
    last = t;
    if (!state.paused) { update(dt); render(); }
    requestAnimationFrame(loop);
  }

  function update(dt) {
    state.timeLeft -= dt;
    if (state.timeLeft <= 0) { state.lives--; beep(220,0.15,'sawtooth',0.06);
      if (state.lives <= 0) { gameOver(false); return; }
      state.timeLeft = LEVEL_TIME; respawn(); }

    for (const p of state.level.platforms) {
      if (p.type === 'moving') {
        const speed = 1.4;
        p._originX ??= p.x;
        p.x = p._originX + Math.sin((performance.now()/1000)*speed + p.phase) * p.range;
      }
    }

    const pl = state.player;
    const wanted = (state.keys.left ? -1 : 0) + (state.keys.right ? 1 : 0);
    pl.vx += wanted * MOVE_SPEED * dt * (pl.grounded ? 1.1 : 0.7);
    pl.vx *= pl.grounded ? FRICTION_GROUND : FRICTION_AIR;
    pl.face = wanted !== 0 ? wanted : pl.face;
    pl.vy += GRAVITY * dt;

    pl.x += pl.vx * dt; collide(pl, 'x');
    pl.y += pl.vy * dt; pl.grounded = false; collide(pl, 'y');

    state.cameraX = clamp(pl.x - W*0.4, 0, state.level.width - W);

    for (const hz of state.level.hazards) {
      if (aabbIntersect(pl.x, pl.y, pl.w, pl.h, hz.x, hz.y, hz.w, hz.h)) { loseLife(); return; }
    }
    if (pl.y > H + 400) { loseLife(); return; }

    for (let i = state.coins.length - 1; i >= 0; i--) {
      const c = state.coins[i];
      c.life += dt; c.y += Math.sin(c.life*6) * 0.4;
      const dx = (pl.x + pl.w/2) - c.x;
      const dy = (pl.y + pl.h/2) - c.y;
      const dist2 = dx*dx + dy*dy;
      if (dist2 < (pl.w*0.5 + c.r)*(pl.w*0.5 + c.r)) {
        state.coins.splice(i,1); state.score += 1;
        hud.score.textContent = 'Монет: ' + state.score;
        beep(1100, 0.07, 'square', 0.06);
        for (let k=0;k<8;k++) state.particles.push({x:c.x,y:c.y,vx:(Math.random()*2-1)*120,vy:(Math.random()*2-1)*120,life:0.5});
      }
    }

    if (aabbIntersect(pl.x, pl.y, pl.w, pl.h, state.level.endFlag.x, state.level.endFlag.y-state.level.endFlag.h, state.level.endFlag.w, state.level.endFlag.h)) {
      gameOver(true); return;
    }

    for (let i=state.particles.length-1;i>=0;i--) {
      const p = state.particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.96; p.vy *= 0.96; p.life -= dt;
      if (p.life <= 0) state.particles.splice(i,1);
    }

    hud.time.textContent = 'Время: ' + Math.max(0, Math.ceil(state.timeLeft));
    hud.lives.textContent = 'Жизни: ' + state.lives;
  }

  function respawn() {
    const pl = state.player;
    pl.x = 100; pl.y = 0; pl.vx = 0; pl.vy = 0; pl.grounded = false; pl.onPlatform = null;
  }

  function loseLife() {
    state.lives--; beep(180,0.18,'sawtooth',0.07);
    if (state.lives <= 0) { gameOver(false); return; }
    respawn();
  }

  function gameOver(win) {
    setPause(true);
    modalTitle.textContent = win ? 'С днём рождения! 🎉' : 'Игра окончена';
    modalText.textContent = win
      ? `Ура! Ты дошёл до тортика и собрал ${state.score} монет! 🎂`
      : `Жизни закончились. Монет собрано: ${state.score}.`;
  }

  function collide(pl, axis) {
    const pads = state.level.platforms;
    for (const p of pads) {
      if (!aabbIntersect(pl.x, pl.y, pl.w, pl.h, p.x, p.y, p.w, p.h)) continue;
      if (axis === 'y') {
        if (pl.vy > 0 && (pl.y + pl.h) - p.y < 40) {
          pl.y = p.y - pl.h; pl.vy = 0; pl.grounded = true; pl.onPlatform = p;
        } else if (pl.vy < 0) { pl.y = p.y + p.h; pl.vy = 0; }
      } else if (axis === 'x') {
        if (pl.vx > 0) pl.x = p.x - pl.w; else if (pl.vx < 0) pl.x = p.x + p.w; pl.vx = 0;
      }
    }
  }

  function drawBlock(x, y, w, h, colorA, colorB) {
    ctx.fillStyle = colorB; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = colorA; ctx.fillRect(x, y, w, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(x, y + h - 6, w, 6);
  }

  function render() {
    const cam = state.cameraX;
    ctx.clearRect(0,0,W,H);

    ctx.save(); ctx.translate(-cam*0.4, 0);
    for (let i=0;i<12;i++) {
      const bx = i*360 + 80;
      const by = 80 + (Math.sin(i)*20);
      drawBlock(bx, by, 120, 32, '#ffffff', '#e6f6ff');
    }
    ctx.restore();

    ctx.save(); ctx.translate(-cam, 0);

    for (const hz of state.level.hazards) {
      const wave = Math.sin(performance.now()/400 + hz.x*0.01) * 3;
      ctx.fillStyle = '#ff7555'; ctx.fillRect(hz.x, hz.y-10, hz.w, hz.h+20);
      ctx.fillStyle = '#ff3b2f'; ctx.fillRect(hz.x, hz.y + wave - 10, hz.w, 16);
    }

    for (const p of state.level.platforms) {
      const cA = p.type==='ground' ? '#c8f398' : '#fff3a6';
      const cB = p.type==='ground' ? '#8ad35e' : '#f1d05e';
      drawBlock(p.x, p.y, p.w, p.h, cA, cB);
    }

    // Finish as a cake 🎂
    const f = state.level.endFlag;
    // cake stand
    drawBlock(f.x-16, f.y - 16, 56, 16, '#ffd6e7', '#ff9ec9'); // plate
    // cake body
    drawBlock(f.x-8, f.y - 48, 40, 32, '#fff1b3', '#ffcf66');
    // candle
    ctx.fillStyle = '#66a3ff'; ctx.fillRect(f.x+8, f.y - 60, 4, 12);
    ctx.fillStyle = '#ffdd55'; ctx.beginPath(); ctx.arc(f.x+10, f.y-62, 4, 0, Math.PI*2); ctx.fill();

    for (const c of state.coins) {
      const glow = (Math.sin(performance.now()/200 + c.x*0.01)*0.2 + 0.8);
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI*2); ctx.closePath();
      ctx.fillStyle = `rgba(255, 220, 0, ${glow})`; ctx.fill();
      ctx.strokeStyle = 'rgba(110,90,0,0.5)'; ctx.lineWidth = 3; ctx.stroke();
    }

    for (const p of state.particles) {
      ctx.globalAlpha = Math.max(0, p.life*1.8); ctx.fillStyle = '#ffe066';
      ctx.fillRect(p.x-3,p.y-3,6,6); ctx.globalAlpha = 1;
    }

    const pl = state.player;
    drawBlock(pl.x, pl.y, pl.w, pl.h, '#a7ffcc', '#64e39e');
    ctx.fillStyle = '#1b1b1b';
    const eyeOffset = pl.face >= 0 ? 10 : -10;
    ctx.fillRect(pl.x + pl.w*0.35 + eyeOffset*0.2, pl.y + pl.h*0.35, 6, 6);
    ctx.fillRect(pl.x + pl.w*0.55 + eyeOffset*0.2, pl.y + pl.h*0.35, 6, 6);
    ctx.fillRect(pl.x + pl.w*0.45 + eyeOffset*0.15, pl.y + pl.h*0.58, 10, 4);

    ctx.restore();
  }

  resetState();
  // Start: show only greeting modal, keep game paused but without showing pause modal
  state.paused = true;
  modal.classList.add('hidden'); // ensure pause modal hidden
  requestAnimationFrame(loop);

  function resizeCanvas() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = 960 * dpr;
    canvas.height = 540 * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
})();
