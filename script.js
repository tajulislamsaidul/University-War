/* script.js
   Game: Daffodil launches rockets -> hit City targets
   Controls:
     - Click or Space: fire rocket
     - Arrow Up/W: move drone up
     - Arrow Down/S: move drone down
*/

(() => {
  // Config
  const GAME_WIDTH = 1200;
  const GAME_HEIGHT = 675;
  const ROCKET_SPEED = 600;
  const ROCKET_COOLDOWN = 200;
  const GAME_DURATION_SECONDS = 180;
  const SHIELD_COUNT = 3;
  const MAX_TARGETS = 12;
  const DRONE_SPEED = 250; // pixels per second
  const DEFENSE_FIRE_COOLDOWN = 800; // Reduced from 1500 to 800 ms
  const DEFENSE_PROJECTILE_SPEED = 350; // Increased from 300
  const DRONE_MAX_HP = 3;

  const sounds = {
    rocket: 'sounds/rocket.mp3',
    explosion: 'sounds/explosion.mp3',
    hit1: 'sounds/hit1.mp3',
    hit10: 'sounds/hit10.mp3',
    hit15: 'sounds/hit15.mp3',
    win: 'sounds/win.mp3',
    lose: 'sounds/lose.mp3',
    defenseFire: 'sounds/defense_fire.mp3',
    droneHit: 'sounds/drone_hit.mp3'
  };

  // Image paths - with fallback colors
  const images = {
    background: 'Assets/background.png',
    drone: 'Assets/drone.png',
    rocket: 'Assets/rocket.png',
    building: 'Assets/building.png',
    bus: 'Assets/bus.png',
    car: 'Assets/car.png',
    defenseProjectile: 'Assets/defense_projectile.png'
  };

  const audios = {};
  for (const k in sounds) {
    audios[k] = new Audio(sounds[k]);
    audios[k].preload = 'auto';
  }

  // Load images
  const loadedImages = {};
  let imagesLoaded = 0;
  const totalImages = Object.keys(images).length;
  let allImagesLoaded = false;

  function loadImages() {
    for (const [key, path] of Object.entries(images)) {
      loadedImages[key] = new Image();
      loadedImages[key].onload = () => {
        imagesLoaded++;
        console.log(`Loaded: ${path}`);
        if (imagesLoaded === totalImages) {
          allImagesLoaded = true;
          console.log('All images loaded successfully');
          if (bgImageLoaded) resetGame();
        }
      };
      loadedImages[key].onerror = () => {
        console.warn(`Failed to load image: ${path}`);
        imagesLoaded++;
        if (imagesLoaded === totalImages) {
          allImagesLoaded = true;
          console.log('All images attempted to load, some failed');
          if (bgImageLoaded) resetGame();
        }
      };
      loadedImages[key].src = path;
    }
  }

  const canvas = document.getElementById('game');
  canvas.width = GAME_WIDTH;
  canvas.height = GAME_HEIGHT;
  const ctx = canvas.getContext('2d');
  const hitsEl = document.getElementById('hits');
  const targetsLeftEl = document.getElementById('targetsLeft');
  const timeEl = document.getElementById('timeDisplay');
  const droneHpEl = document.getElementById('droneHp');
  const overlay = document.getElementById('overlay');
  const resultTitle = document.getElementById('resultTitle');
  const resultText = document.getElementById('resultText');
  const restartBtn = document.getElementById('restartBtn');

  // Background handling
  const bgImage = new Image();
  let bgImageLoaded = false;
  bgImage.onload = () => {
    bgImageLoaded = true;
    console.log('Background image loaded');
    if (allImagesLoaded) resetGame();
  };
  bgImage.onerror = () => {
    console.warn('Background image failed to load, using fallback background');
    bgImageLoaded = true;
    if (allImagesLoaded) resetGame();
  };
  bgImage.src = images.background;

  let lastShotTime = 0;
  let lastDefenseFireTime = 0;
  let rockets = [];
  let defenseProjectiles = [];
  let shields = [];
  let targets = [];
  let hits = 0;
  let startTime = null;
  let gameOver = false;
  let timeRemaining = GAME_DURATION_SECONDS;
  let animationId = null;

  const drone = {
    x: 70,
    y: GAME_HEIGHT / 2,
    w: 100,
    h: 60,
    vy: 0,
    hp: DRONE_MAX_HP,
    maxHp: DRONE_MAX_HP,
    hitCooldown: 0,
    hitCooldownMax: 1000
  };

  const keys = { up: false, down: false };

  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

  function spawnTargets() {
    targets = [];
    const rightAreaX = GAME_WIDTH * 0.62;
    const cols = 4, rows = 3;
    let count = 0;
    
    // Define target types with fallback colors
    const targetTypes = [
      { type: 'building', image: loadedImages.building, hp: 3, height: 120, canShoot: true, color: '#8B4513' },
      { type: 'bus', image: loadedImages.bus, hp: 2, height: 80, canShoot: true, color: '#FF6B35' },
      { type: 'car', image: loadedImages.car, hp: 1, height: 50, canShoot: false, color: '#4ECDC4' }
    ];
    
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (count >= MAX_TARGETS) continue;
        const targetType = targetTypes[r];
        const w = 90;
        const h = targetType.height;
        const x = rightAreaX + 20 + c * (w + 18);
        const y = 80 + r * (h + 40);
        
        targets.push({ 
          x, y, w, h, 
          hp: targetType.hp, 
          maxHp: targetType.hp, 
          alive: true,
          type: targetType.type,
          image: targetType.image,
          color: targetType.color,
          canShoot: targetType.canShoot,
          lastShot: 0
        });
        count++;
      }
    }
    updateTargetsLeft();
  }

  function spawnShields() {
    shields = [];
    const baseX = GAME_WIDTH * 0.55;
    for (let i = 0; i < SHIELD_COUNT; i++) {
      const w = 40, h = 120;
      const x = baseX + i * 80;
      const y = 80 + i * 120;
      const vy = (Math.random() > 0.5 ? 1 : -1) * (60 + Math.random() * 80);
      shields.push({ x, y, w, h, vy });
    }
  }

  function defenseFire(now) {
    if (gameOver) return;
    
    // Find alive targets that can shoot
    const shootingTargets = targets.filter(t => t.alive && t.canShoot);
    if (shootingTargets.length === 0) return;

    // Only shoot if cooldown has passed
    if (now - lastDefenseFireTime < DEFENSE_FIRE_COOLDOWN) return;
    
    // Choose a random shooting target
    const shooter = shootingTargets[Math.floor(Math.random() * shootingTargets.length)];
    
    // Calculate direction towards drone with slight prediction
    const predictX = drone.x + (keys.down ? 50 : keys.up ? -50 : 0); // Predict drone movement
    const predictY = drone.y;
    
    const dx = predictX - shooter.x;
    const dy = predictY - shooter.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > 50) { // Only shoot if drone is not too close
      const directionX = dx / distance;
      const directionY = dy / distance;

      // Create defense projectile
      defenseProjectiles.push({
        x: shooter.x + shooter.w / 2,
        y: shooter.y + shooter.h / 2,
        vx: directionX * DEFENSE_PROJECTILE_SPEED,
        vy: directionY * DEFENSE_PROJECTILE_SPEED,
        radius: 8, // Slightly larger radius
        alive: true,
        image: loadedImages.defenseProjectile,
        width: 16,
        height: 16
      });

      lastDefenseFireTime = now;
      safePlay(audios.defenseFire);
    }
  }

  function resetGame() {
    console.log('Resetting game...');
    rockets = [];
    defenseProjectiles = [];
    hits = 0;
    gameOver = false;
    startTime = performance.now();
    timeRemaining = GAME_DURATION_SECONDS;
    lastShotTime = 0;
    lastDefenseFireTime = 0;
    drone.hp = DRONE_MAX_HP;
    drone.hitCooldown = 0;
    spawnTargets();
    spawnShields();
    overlay.classList.add('hidden');
    updateStats();
    if (animationId) cancelAnimationFrame(animationId);
    loop(performance.now());
  }

  function fireRocket() {
    if (gameOver) return;
    const now = performance.now();
    if (now - lastShotTime < ROCKET_COOLDOWN) return;
    lastShotTime = now;
    const x = drone.x + drone.w - 10;
    const y = drone.y;
    const vx = ROCKET_SPEED;
    rockets.push({ 
      x, y, vx, 
      radius: 8, 
      alive: true,
      image: loadedImages.rocket,
      width: 20,
      height: 8
    });
    safePlay(audios.rocket);
  }

  function safePlay(audio) {
    if (!audio) return;
    try { audio.currentTime = 0; audio.play().catch(()=>{}); } catch(e){}
  }

  function rectCircleCollide(rect, circle) {
    const cx = circle.x;
    const cy = circle.y;
    const rx = rect.x, ry = rect.y, rw = rect.w, rh = rect.h;
    const nearestX = clamp(cx, rx, rx + rw);
    const nearestY = clamp(cy, ry, ry + rh);
    const dx = cx - nearestX;
    const dy = cy - nearestY;
    return (dx * dx + dy * dy) < (circle.radius * circle.radius);
  }

  function circleCircleCollide(c1, c2) {
    const dx = c1.x - c2.x;
    const dy = c1.y - c2.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance < (c1.radius + c2.radius);
  }

  function updateStats() {
    hitsEl.textContent = hits;
    droneHpEl.textContent = `${drone.hp}/${drone.maxHp}`;
    updateTargetsLeft();
  }
  
  function updateTargetsLeft() {
    const left = targets.filter(t=>t.alive).length;
    targetsLeftEl.textContent = left;
  }

  function loop(now) {
    animationId = requestAnimationFrame(loop);
    if (!startTime) startTime = now;
    const dt = Math.min(40, now - (loop._last || now)) / 1000.0;
    loop._last = now;

    if (drone.hitCooldown > 0) {
      drone.hitCooldown -= dt * 1000;
    }

    // Drone movement
    if (keys.up) drone.y -= DRONE_SPEED * dt;
    if (keys.down) drone.y += DRONE_SPEED * dt;
    drone.y = clamp(drone.y, 60, GAME_HEIGHT - 60);

    // Timer
    const elapsed = (now - startTime) / 1000;
    timeRemaining = Math.max(0, GAME_DURATION_SECONDS - Math.floor(elapsed));
    const mm = String(Math.floor(timeRemaining / 60)).padStart(2,'0');
    const ss = String(timeRemaining % 60).padStart(2,'0');
    timeEl.textContent = `${mm}:${ss}`;

    // Defense fire
    defenseFire(now);

    // Shields - Fixed vertical movement
    shields.forEach(s=>{
      s.y += s.vy * dt;
      if (s.y < 40 || s.y + s.h > GAME_HEIGHT - 40) s.vy *= -1;
    });

    // Rockets
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.x += r.vx * dt;
      r.y -= 10 * dt;
      if (r.x > GAME_WIDTH + 50 || r.y < -50 || r.y > GAME_HEIGHT + 50) {
        rockets.splice(i,1);
        continue;
      }

      let blocked = false;
      for (const s of shields) {
        if (rectCircleCollide({x:s.x,y:s.y,w:s.w,h:s.h}, r)) {
          safePlay(audios.explosion);
          rockets.splice(i,1);
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      for (const t of targets) {
        if (!t.alive) continue;
        if (rectCircleCollide(t, r)) {
          t.hp -= 1;
          safePlay(audios.explosion);
          hits += 1;
          if (hits === 1) safePlay(audios.hit1);
          else if (hits === 10) safePlay(audios.hit10);
          else if (hits >= 15) safePlay(audios.hit15);

          rockets.splice(i,1);
          if (t.hp <= 0) t.alive = false;
          updateStats();
          break;
        }
      }
    }

    // Defense projectiles - FIXED COLLISION DETECTION
    for (let i = defenseProjectiles.length - 1; i >= 0; i--) {
      const p = defenseProjectiles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      
      if (p.x < -50 || p.x > GAME_WIDTH + 50 || p.y < -50 || p.y > GAME_HEIGHT + 50) {
        defenseProjectiles.splice(i,1);
        continue;
      }

      // FIXED: Use proper drone collision detection
      if (drone.hitCooldown <= 0) {
        const droneRect = {
          x: drone.x - 20,
          y: drone.y - 30,
          w: drone.w,
          h: drone.h
        };
        
        if (rectCircleCollide(droneRect, p)) {
          drone.hp -= 1;
          drone.hitCooldown = drone.hitCooldownMax;
          safePlay(audios.droneHit);
          defenseProjectiles.splice(i,1);
          updateStats();
          
          console.log(`Drone hit! HP: ${drone.hp}`);
          
          if (drone.hp <= 0) {
            gameOver = true;
            endGame(false);
            return;
          }
          continue;
        }
      }

      // Check collision with shields
      let blocked = false;
      for (const s of shields) {
        if (rectCircleCollide({x:s.x,y:s.y,w:s.w,h:s.h}, p)) {
          defenseProjectiles.splice(i,1);
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
    }

    const left = targets.filter(t=>t.alive).length;
    if (left === 0 && !gameOver) {
      gameOver = true;
      endGame(true);
      return;
    }
    if (timeRemaining <= 0 && !gameOver) {
      gameOver = true;
      endGame(false);
      return;
    }

    draw();
  }

  function draw() {
    ctx.clearRect(0,0,GAME_WIDTH,GAME_HEIGHT);
    
    // Draw background with better fallback
    if (bgImage.complete && bgImage.naturalWidth > 0) {
      const iw = bgImage.naturalWidth, ih = bgImage.naturalHeight;
      const scale = Math.max(GAME_WIDTH / iw, GAME_HEIGHT / ih);
      const iwScaled = iw * scale, ihScaled = ih * scale;
      const sx = (GAME_WIDTH - iwScaled) / 2;
      const sy = (GAME_HEIGHT - ihScaled) / 2;
      ctx.drawImage(bgImage, sx, sy, iwScaled, ihScaled);
    } else {
      // Fallback gradient background
      const gradient = ctx.createLinearGradient(0, 0, GAME_WIDTH, GAME_HEIGHT);
      gradient.addColorStop(0, '#00111a');
      gradient.addColorStop(1, '#003366');
      ctx.fillStyle = gradient;
      ctx.fillRect(0,0,GAME_WIDTH,GAME_HEIGHT);
      
      // Add some city silhouette
      ctx.fillStyle = '#000033';
      ctx.fillRect(0, GAME_HEIGHT - 100, GAME_WIDTH, 100);
      
      // Add some building shapes
      ctx.fillStyle = '#002244';
      for (let i = 0; i < 10; i++) {
        const height = 50 + Math.random() * 100;
        ctx.fillRect(i * 120 + 50, GAME_HEIGHT - 100 - height, 60, height);
      }
    }

    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.fillRect(0,0,GAME_WIDTH,GAME_HEIGHT);

    // Draw drone
    if (loadedImages.drone && loadedImages.drone.complete && loadedImages.drone.naturalWidth > 0) {
      ctx.save();
      if (drone.hitCooldown > 0 && Math.floor(drone.hitCooldown / 100) % 2 === 0) {
        ctx.filter = 'brightness(2) saturate(3)';
      }
      ctx.drawImage(loadedImages.drone, drone.x - 20, drone.y - 30, drone.w, drone.h);
      ctx.restore();
    } else {
      // Fallback drone drawing
      ctx.save();
      if (drone.hitCooldown > 0 && Math.floor(drone.hitCooldown / 100) % 2 === 0) {
        ctx.fillStyle = '#ff4444';
      } else {
        ctx.fillStyle = '#0fb0ff';
      }
      ctx.translate(drone.x,drone.y);
      ctx.beginPath();
      ctx.roundRect(-20,-30,110,60,8);
      ctx.fill();
      ctx.fillStyle = '#cddff9';
      ctx.fillRect(10,-42,60,8);
      ctx.restore();
    }

    // Draw drone health bar
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(drone.x - 20, drone.y - 45, drone.w, 6);
    ctx.fillStyle = drone.hp > 1 ? '#4CAF50' : '#f44336';
    ctx.fillRect(drone.x - 20, drone.y - 45, drone.w * (drone.hp / drone.maxHp), 6);

    // Draw targets
    for (const t of targets) {
      if (!t.alive) continue;
      
      if (t.image && t.image.complete && t.image.naturalWidth > 0) {
        ctx.drawImage(t.image, t.x, t.y, t.w, t.h);
      } else {
        // Fallback colored rectangles for targets
        ctx.fillStyle = t.color || '#888888';
        ctx.fillRect(t.x, t.y, t.w, t.h);
        
        // Add some details to distinguish targets
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(t.x + 5, t.y + 5, t.w - 10, 10);
        ctx.fillRect(t.x + 5, t.y + t.h - 15, t.w - 10, 10);
      }
      
      // Draw health bar
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(t.x, t.y - 8, t.w, 6);
      ctx.fillStyle = '#e23e3e';
      ctx.fillRect(t.x, t.y - 8, t.w * (t.hp / t.maxHp), 6);
    }

    // Shields
    for (const s of shields) {
      ctx.save();
      ctx.fillStyle = 'rgba(120,200,255,0.16)';
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.strokeStyle = 'rgba(120,200,255,0.6)';
      ctx.lineWidth = 2;
      drawRoundedRect(ctx, s.x, s.y, s.w, s.h, 6);
      ctx.restore();
    }

    // Rockets
    for (const r of rockets) {
      if (r.image && r.image.complete && r.image.naturalWidth > 0) {
        ctx.save();
        ctx.translate(r.x, r.y);
        ctx.rotate(Math.atan2(-10, r.vx));
        ctx.drawImage(r.image, -r.width/2, -r.height/2, r.width, r.height);
        ctx.restore();
      } else {
        ctx.save();
        ctx.translate(r.x, r.y);
        ctx.fillStyle = '#ffd6a6';
        ctx.beginPath();
        ctx.arc(0,0,r.radius,0,Math.PI*2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,140,20,0.9)';
        ctx.beginPath();
        ctx.ellipse(-r.radius - 4, 0, r.radius*0.7, r.radius*0.4, 0, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Defense projectiles
    for (const p of defenseProjectiles) {
      if (p.image && p.image.complete && p.image.naturalWidth > 0) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.drawImage(p.image, -p.width/2, -p.height/2, p.width, p.height);
        ctx.restore();
      } else {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.fillStyle = '#ff4444';
        ctx.beginPath();
        ctx.arc(0,0,p.radius,0,Math.PI*2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,200,50,0.9)';
        ctx.beginPath();
        ctx.arc(0,0,p.radius*0.6,0,Math.PI*2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawRoundedRect(ctx,x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y);
    ctx.quadraticCurveTo(x+w, y, x+w, y+r);
    ctx.lineTo(x+w, y+h-r);
    ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    ctx.lineTo(x+r, y+h);
    ctx.quadraticCurveTo(x, y+h, x, y+h-r);
    ctx.lineTo(x, y+r);
    ctx.quadraticCurveTo(x, y, x+r, y);
    ctx.stroke();
  }

  function endGame(win) {
    cancelAnimationFrame(animationId);
    overlay.classList.remove('hidden');
    if (win) {
      resultTitle.textContent = 'Daffodil Wins!';
      resultText.innerHTML = `All City University targets destroyed.<br>City University cries.`;
      safePlay(audios.win);
    } else {
      if (drone.hp <= 0) {
        resultTitle.textContent = 'Drone Destroyed!';
        resultText.innerHTML = `Your drone was shot down.<br>Daffodil must pay <strong>50 crore taka</strong>.`;
      } else {
        resultTitle.textContent = 'Time\'s Up!';
        resultText.innerHTML = `You ran out of time.<br>Daffodil must pay <strong>50 crore taka</strong>.`;
      }
      safePlay(audios.lose);
    }
  }

  // Controls
  window.addEventListener('keydown', e => {
    if (e.code === 'ArrowUp' || e.code === 'KeyW') keys.up = true;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') keys.down = true;
    if (e.code === 'Space') {
      e.preventDefault();
      fireRocket();
    }
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'ArrowUp' || e.code === 'KeyW') keys.up = false;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') keys.down = false;
  });
  canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    drone.y = clamp(y, 60, GAME_HEIGHT - 60);
    fireRocket();
  });

  restartBtn.addEventListener('click', () => resetGame());

  // Start loading images
  loadImages();
  
  // Force reset if images take too long
  setTimeout(() => {
    if (!startTime) {
      console.log('Forcing game start after timeout');
      resetGame();
    }
  }, 3000);
})();