(() => {
  /* Prevent double-init in the same extension context */
  if (window.__doodlerInitialized) return;
  window.__doodlerInitialized = true;

  /* Clean up stale DOM from a previous (dead) extension context.
     When the extension is reloaded/updated, old content script dies but
     its DOM elements remain — remove them so fresh ones can be created. */
  ['doodler-canvas', 'doodler-toolbar', 'doodler-toast', 'doodler-status',
   'doodler-sel-overlay', 'doodler-text-input'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  /* ═══════════════════════════════════
     STATE
     ═══════════════════════════════════ */
  let isActive = false;
  let isDrawing = false;
  let color = '#ff3366';
  let brushSize = 4;
  let tool = 'pen';       // select | pen | eraser | text | shape | line
  let shapeType = 'rect'; // rect | roundrect | circle | triangle | diamond | star
  let lineType = 'solid'; // solid | dashed | dotted | arrow | double-arrow
  let paths = [];
  let currentPath = null;
  let undoneStack = [];
  let ssMode = 'full';    // full | part
  let dragStart = null;
  let activeTextInput = null;

  // Load saved preferences
  chrome.storage.local.get(['doodler_ss_mode', 'doodler_shape_type', 'doodler_line_type'], (r) => {
    if (r.doodler_ss_mode) ssMode = r.doodler_ss_mode;
    if (r.doodler_shape_type) shapeType = r.doodler_shape_type;
    if (r.doodler_line_type) lineType = r.doodler_line_type;
    updateSSTick();
    updateShapeTick();
    updateLineTick();
  });

  /* ═══════════════════════════════════
     CANVAS
     ═══════════════════════════════════ */
  const canvas = document.createElement('canvas');
  canvas.id = 'doodler-canvas';
  document.documentElement.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = window.innerWidth  * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width  = window.innerWidth  + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  /* ═══════════════════════════════════
     TOOLBAR
     ═══════════════════════════════════ */
  const toolbar = document.createElement('div');
  toolbar.id = 'doodler-toolbar';
  toolbar.innerHTML = `
    <button id="doodler-select" title="Select"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 2v16.5l4.3-3.9 3.2 7.4 2.2-1-3.3-7.3 5.8-.5L7 2z" fill="#fff"/></svg></button>
    <button id="doodler-pen" class="active" title="Pen">✒️</button>
    <button id="doodler-eraser" title="Eraser">🧹</button>
    <button id="doodler-text" title="Text"><span class="doodler-txt-icon">T</span></button>
    <div class="doodler-split-group">
      <button id="doodler-shape" title="Shape">⬜</button><button id="doodler-shape-arrow" class="doodler-dd-arrow" title="Shape type">▾</button>
      <div id="doodler-shape-menu" class="doodler-dd-menu">
        <div class="doodler-dd-item" data-shape="rect">
          <span class="doodler-dd-check">✓</span><span>□ Rectangle</span>
        </div>
        <div class="doodler-dd-item" data-shape="roundrect">
          <span class="doodler-dd-check">✓</span><span>▢ Rounded</span>
        </div>
        <div class="doodler-dd-item" data-shape="circle">
          <span class="doodler-dd-check">✓</span><span>○ Circle</span>
        </div>
        <div class="doodler-dd-item" data-shape="triangle">
          <span class="doodler-dd-check">✓</span><span>△ Triangle</span>
        </div>
        <div class="doodler-dd-item" data-shape="diamond">
          <span class="doodler-dd-check">✓</span><span>◇ Diamond</span>
        </div>
        <div class="doodler-dd-item" data-shape="star">
          <span class="doodler-dd-check">✓</span><span>☆ Star</span>
        </div>
      </div>
    </div>
    <div class="doodler-split-group">
      <button id="doodler-line" title="Line">📏</button><button id="doodler-line-arrow" class="doodler-dd-arrow" title="Line type">▾</button>
      <div id="doodler-line-menu" class="doodler-dd-menu">
        <div class="doodler-dd-item" data-line="solid">
          <span class="doodler-dd-check">✓</span><span>── Solid</span>
        </div>
        <div class="doodler-dd-item" data-line="dashed">
          <span class="doodler-dd-check">✓</span><span>╌╌ Dashed</span>
        </div>
        <div class="doodler-dd-item" data-line="dotted">
          <span class="doodler-dd-check">✓</span><span>··· Dotted</span>
        </div>
        <div class="doodler-dd-item" data-line="arrow">
          <span class="doodler-dd-check">✓</span><span>→ Arrow</span>
        </div>
        <div class="doodler-dd-item" data-line="double-arrow">
          <span class="doodler-dd-check">✓</span><span>↔ Double arrow</span>
        </div>
      </div>
    </div>
    <div class="sep"></div>
    <input type="color" id="doodler-color" value="${color}" title="Color">
    <input type="range" id="doodler-size" min="1" max="100" value="${brushSize}" title="Brush size">
    <input type="number" id="doodler-size-num" class="sz-input" value="${brushSize}" min="1" max="100" title="Type a size">
    <div class="sep"></div>
    <button id="doodler-undo" title="Undo">↩</button>
    <button id="doodler-redo" title="Redo">↪</button>
    <button id="doodler-clear" title="Clear">🗑</button>
    <div class="sep"></div>
    <button id="doodler-save" title="Save">💾</button>
    <button id="doodler-download" title="Export doodle PNG">📥</button>
    <div class="doodler-split-group">
      <button id="doodler-screenshot" title="Screenshot">📸</button><button id="doodler-ss-arrow" class="doodler-dd-arrow" title="Screenshot options">▾</button>
      <div id="doodler-ss-menu" class="doodler-dd-menu">
        <div class="doodler-dd-item" data-mode="full">
          <span class="doodler-dd-check">✓</span><span>Full page</span>
        </div>
        <div class="doodler-dd-item" data-mode="part">
          <span class="doodler-dd-check">✓</span><span>Select area</span>
        </div>
      </div>
    </div>
  `;
  document.documentElement.appendChild(toolbar);

  /* ═══════════════════════════════════
     TOAST · BADGE · SELECTION OVERLAY
     ═══════════════════════════════════ */
  const toast = document.createElement('div');
  toast.id = 'doodler-toast';
  document.documentElement.appendChild(toast);

  const badge = document.createElement('div');
  badge.id = 'doodler-status';
  badge.textContent = '🎨 DOODLE MODE';
  document.documentElement.appendChild(badge);

  const selOverlay = document.createElement('div');
  selOverlay.id = 'doodler-sel-overlay';
  const selBox = document.createElement('div');
  selBox.id = 'doodler-sel-box';
  selOverlay.appendChild(selBox);
  document.documentElement.appendChild(selOverlay);

  /* ═══════════════════════════════════
     TOOL SWITCHING
     ═══════════════════════════════════ */
  const $ = (s) => toolbar.querySelector(s);
  const toolBtns = {
    select: $('#doodler-select'),
    pen:    $('#doodler-pen'),
    eraser: $('#doodler-eraser'),
    text:   $('#doodler-text'),
    shape:  $('#doodler-shape'),
    line:   $('#doodler-line'),
  };

  function setTool(t) {
    finalizeTextInput();
    tool = t;
    Object.entries(toolBtns).forEach(([k, btn]) => {
      btn.classList.toggle('active', k === t);
    });
    if (t === 'select') {
      canvas.style.pointerEvents = 'none';
      canvas.style.cursor = 'default';
    } else if (isActive) {
      canvas.style.pointerEvents = 'auto';
      canvas.style.cursor = t === 'text' ? 'text' : 'crosshair';
    }
  }

  /* ═══════════════════════════════════
     TOOLBAR WIRING
     ═══════════════════════════════════ */
  toolBtns.select.onclick = () => setTool('select');
  toolBtns.pen.onclick    = () => setTool('pen');
  toolBtns.eraser.onclick = () => setTool('eraser');
  toolBtns.text.onclick   = () => setTool('text');
  toolBtns.shape.onclick  = () => setTool('shape');
  toolBtns.line.onclick   = () => setTool('line');

  $('#doodler-color').addEventListener('input', (e) => { color = e.target.value; });

  /* ── Size: slider + number input stay in sync ── */
  const sizeSlider = $('#doodler-size');
  const sizeNum    = $('#doodler-size-num');

  sizeSlider.addEventListener('input', (e) => {
    brushSize = +e.target.value;
    sizeNum.value = brushSize;
  });

  sizeNum.addEventListener('input', (e) => {
    let v = parseInt(e.target.value, 10);
    if (isNaN(v) || v < 1) v = 1;
    if (v > 100) v = 100;
    brushSize = v;
    sizeSlider.value = Math.min(v, +sizeSlider.max);
  });

  sizeNum.addEventListener('blur', (e) => {
    e.target.value = brushSize;
  });

  // Prevent doodler shortcuts while typing in the number input
  sizeNum.addEventListener('keydown', (e) => { e.stopPropagation(); });

  $('#doodler-undo').onclick  = undo;
  $('#doodler-redo').onclick  = redo;
  $('#doodler-clear').onclick = clearAll;
  $('#doodler-save').onclick  = save;
  $('#doodler-download').onclick = exportDoodle;

  /* ── Screenshot button & dropdown ── */
  $('#doodler-screenshot').onclick = () => {
    closeDropdowns();
    ssMode === 'part' ? startRegionSelect() : exportScreenshot();
  };

  const ssArrow = $('#doodler-ss-arrow');
  const ssMenu  = $('#doodler-ss-menu');

  ssArrow.addEventListener('click', (e) => {
    e.stopPropagation();
    shapeMenu.classList.remove('open');
    lineMenu.classList.remove('open');
    ssMenu.classList.toggle('open');
  });

  ssMenu.querySelectorAll('.doodler-dd-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      ssMode = item.dataset.mode;
      chrome.storage.local.set({ doodler_ss_mode: ssMode });
      updateSSTick();
      ssMenu.classList.remove('open');
      showToast(ssMode === 'full' ? 'Default: full page' : 'Default: select area', 'info');
    });
  });

  function updateSSTick() {
    ssMenu.querySelectorAll('.doodler-dd-item').forEach((it) => {
      it.classList.toggle('active', it.dataset.mode === ssMode);
    });
  }

  /* ── Shape dropdown ── */
  const shapeArrow = $('#doodler-shape-arrow');
  const shapeMenu  = $('#doodler-shape-menu');

  shapeArrow.addEventListener('click', (e) => {
    e.stopPropagation();
    ssMenu.classList.remove('open');
    lineMenu.classList.remove('open');
    shapeMenu.classList.toggle('open');
  });

  shapeMenu.querySelectorAll('.doodler-dd-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      shapeType = item.dataset.shape;
      chrome.storage.local.set({ doodler_shape_type: shapeType });
      updateShapeTick();
      shapeMenu.classList.remove('open');
      setTool('shape');
      const names = { rect:'Rectangle', roundrect:'Rounded', circle:'Circle', triangle:'Triangle', diamond:'Diamond', star:'Star' };
      showToast('Shape: ' + (names[shapeType] || shapeType), 'info');
    });
  });

  function updateShapeTick() {
    shapeMenu.querySelectorAll('.doodler-dd-item').forEach((it) => {
      it.classList.toggle('active', it.dataset.shape === shapeType);
    });
  }

  /* ── Line dropdown ── */
  const lineArrow = $('#doodler-line-arrow');
  const lineMenu  = $('#doodler-line-menu');

  lineArrow.addEventListener('click', (e) => {
    e.stopPropagation();
    ssMenu.classList.remove('open');
    shapeMenu.classList.remove('open');
    lineMenu.classList.toggle('open');
  });

  lineMenu.querySelectorAll('.doodler-dd-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      lineType = item.dataset.line;
      chrome.storage.local.set({ doodler_line_type: lineType });
      updateLineTick();
      lineMenu.classList.remove('open');
      setTool('line');
      const names = { solid:'Solid', dashed:'Dashed', dotted:'Dotted', arrow:'Arrow', 'double-arrow':'Double arrow' };
      showToast('Line: ' + (names[lineType] || lineType), 'info');
    });
  });

  function updateLineTick() {
    lineMenu.querySelectorAll('.doodler-dd-item').forEach((it) => {
      it.classList.toggle('active', it.dataset.line === lineType);
    });
  }

  function closeDropdowns() {
    ssMenu.classList.remove('open');
    shapeMenu.classList.remove('open');
    lineMenu.classList.remove('open');
  }

  // Close dropdowns on any outside click
  document.addEventListener('click', closeDropdowns);

  /* ═══════════════════════════════════
     DRAWING — pointer events on CANVAS
     ═══════════════════════════════════ */
  canvas.addEventListener('pointerdown', (e) => {
    if (!isActive || tool === 'select') return;

    // Text tool — place an input box
    if (tool === 'text') {
      e.preventDefault();
      createTextInput(e.clientX, e.clientY);
      return;
    }

    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    isDrawing = true;
    undoneStack = [];

    if (tool === 'shape' || tool === 'line') {
      dragStart = { x: e.clientX, y: e.clientY };
      currentPath = null;
    } else {
      // pen or eraser
      currentPath = {
        tool,
        color: tool === 'eraser' ? null : color,
        size:  tool === 'eraser' ? brushSize * 3 : brushSize,
        points: [{ x: e.clientX, y: e.clientY }],
      };
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!isDrawing) return;
    e.preventDefault();

    if (tool === 'shape' && dragStart) {
      const x = Math.min(dragStart.x, e.clientX);
      const y = Math.min(dragStart.y, e.clientY);
      const w = Math.abs(e.clientX - dragStart.x);
      const h = Math.abs(e.clientY - dragStart.y);
      currentPath = { tool: 'shape', shape: shapeType, x, y, w, h, color, size: brushSize };
      redraw();
      renderPath(ctx, currentPath);
    } else if (tool === 'line' && dragStart) {
      currentPath = { tool: 'line', lineStyle: lineType, x1: dragStart.x, y1: dragStart.y, x2: e.clientX, y2: e.clientY, color, size: brushSize };
      redraw();
      renderPath(ctx, currentPath);
    } else if (currentPath && currentPath.points) {
      currentPath.points.push({ x: e.clientX, y: e.clientY });
      redraw();
      renderPath(ctx, currentPath);
    }
  });

  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', endStroke);

  function endStroke(e) {
    if (!isDrawing) return;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    isDrawing = false;

    if (currentPath) {
      let keep = true;
      if (currentPath.tool === 'shape') {
        keep = currentPath.w >= 3 && currentPath.h >= 3;
      } else if (currentPath.tool === 'line') {
        const dx = currentPath.x2 - currentPath.x1;
        const dy = currentPath.y2 - currentPath.y1;
        keep = Math.sqrt(dx * dx + dy * dy) >= 5;
      } else if (currentPath.points) {
        keep = currentPath.points.length > 0;
      } else {
        keep = false;
      }
      if (keep) paths.push(currentPath);
    }

    currentPath = null;
    dragStart = null;
    redraw();
  }

  // Block touch scroll on canvas while drawing
  canvas.addEventListener('touchstart', (e) => { if (isActive && tool !== 'select') e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchmove',  (e) => { if (isActive && tool !== 'select') e.preventDefault(); }, { passive: false });

  /* ═══════════════════════════════════
     TEXT INPUT
     ═══════════════════════════════════ */
  function createTextInput(x, y) {
    finalizeTextInput();
    const fontSize = Math.max(14, brushSize * 3);

    const ta = document.createElement('textarea');
    ta.id = 'doodler-text-input';
    ta.style.cssText = `
      position:fixed; left:${x}px; top:${y}px; z-index:2147483647;
      font-size:${fontSize}px; color:${color};
      background:rgba(255,255,255,0.06);
      border:1.5px dashed rgba(99,102,241,0.5);
      outline:none; resize:none;
      padding:4px 6px; min-width:60px;
      min-height:${fontSize + 10}px;
      font-family:sans-serif; line-height:1.3;
      border-radius:4px;
      box-shadow:0 2px 8px rgba(0,0,0,0.2);
    `;
    document.documentElement.appendChild(ta);
    ta.focus();
    activeTextInput = ta;

    // Auto-grow
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
      ta.style.width  = 'auto';
      ta.style.width  = Math.max(60, ta.scrollWidth + 14) + 'px';
    });

    ta.addEventListener('blur', () => finalizeTextInput());

    ta.addEventListener('keydown', (ke) => {
      if (ke.key === 'Enter' && !ke.shiftKey) { ke.preventDefault(); finalizeTextInput(); }
      if (ke.key === 'Escape') { ta.value = ''; finalizeTextInput(); }
      ke.stopPropagation(); // don't trigger doodler shortcuts
    });
  }

  function finalizeTextInput() {
    if (!activeTextInput) return;
    const ta = activeTextInput;
    activeTextInput = null;

    const text = ta.value.trim();
    if (text) {
      const fontSize = parseInt(ta.style.fontSize);
      const x = parseFloat(ta.style.left) + 6;  // match padding
      const y = parseFloat(ta.style.top)  + 4;
      paths.push({ tool: 'text', text, x, y, color: ta.style.color, fontSize });
      undoneStack = [];
      redraw();
    }
    ta.remove();
  }

  /* ═══════════════════════════════════
     ARROWHEAD HELPER
     ═══════════════════════════════════ */
  function drawArrowhead(c, fromX, fromY, toX, toY, size) {
    const headLen = Math.max(size * 4, 12);
    const angle = Math.atan2(toY - fromY, toX - fromX);
    c.save();
    c.setLineDash([]);
    c.fillStyle = c.strokeStyle;
    c.beginPath();
    c.moveTo(toX, toY);
    c.lineTo(
      toX - headLen * Math.cos(angle - Math.PI / 6),
      toY - headLen * Math.sin(angle - Math.PI / 6)
    );
    c.lineTo(
      toX - headLen * Math.cos(angle + Math.PI / 6),
      toY - headLen * Math.sin(angle + Math.PI / 6)
    );
    c.closePath();
    c.fill();
    c.restore();
  }

  /* ═══════════════════════════════════
     PATH RENDERING  (works on any ctx)
     ═══════════════════════════════════ */
  function renderPath(c, p) {
    c.save();

    /* ── Text ── */
    if (p.tool === 'text') {
      c.font = `${p.fontSize}px sans-serif`;
      c.fillStyle = p.color;
      c.textBaseline = 'top';
      const lines = p.text.split('\n');
      const lh = p.fontSize * 1.3;
      for (let i = 0; i < lines.length; i++) c.fillText(lines[i], p.x, p.y + i * lh);
      c.restore();
      return;
    }

    /* ── Shape ── */
    if (p.tool === 'shape') {
      c.strokeStyle = p.color;
      c.lineWidth   = p.size;
      c.lineJoin    = 'round';
      c.lineCap     = 'round';

      if (p.shape === 'circle') {
        c.beginPath();
        const rx = Math.abs(p.w) / 2, ry = Math.abs(p.h) / 2;
        c.ellipse(p.x + p.w / 2, p.y + p.h / 2, rx || 0.1, ry || 0.1, 0, 0, Math.PI * 2);
        c.stroke();

      } else if (p.shape === 'triangle') {
        c.beginPath();
        c.moveTo(p.x + p.w / 2, p.y);
        c.lineTo(p.x + p.w, p.y + p.h);
        c.lineTo(p.x, p.y + p.h);
        c.closePath();
        c.stroke();

      } else if (p.shape === 'diamond') {
        c.beginPath();
        c.moveTo(p.x + p.w / 2, p.y);
        c.lineTo(p.x + p.w, p.y + p.h / 2);
        c.lineTo(p.x + p.w / 2, p.y + p.h);
        c.lineTo(p.x, p.y + p.h / 2);
        c.closePath();
        c.stroke();

      } else if (p.shape === 'star') {
        const cx = p.x + p.w / 2;
        const cy = p.y + p.h / 2;
        const outerR = Math.min(Math.abs(p.w), Math.abs(p.h)) / 2;
        const innerR = outerR * 0.4;
        c.beginPath();
        for (let i = 0; i < 10; i++) {
          const angle = -Math.PI / 2 + (Math.PI / 5) * i;
          const r = i % 2 === 0 ? outerR : innerR;
          const px = cx + r * Math.cos(angle);
          const py = cy + r * Math.sin(angle);
          if (i === 0) c.moveTo(px, py);
          else c.lineTo(px, py);
        }
        c.closePath();
        c.stroke();

      } else if (p.shape === 'roundrect') {
        const radius = Math.min(12, Math.min(Math.abs(p.w), Math.abs(p.h)) / 4);
        c.beginPath();
        c.roundRect(p.x, p.y, p.w, p.h, radius);
        c.stroke();

      } else {
        // Default: rectangle
        c.strokeRect(p.x, p.y, p.w, p.h);
      }
      c.restore();
      return;
    }

    /* ── Line (with styles) ── */
    if (p.tool === 'line') {
      c.strokeStyle = p.color;
      c.lineWidth   = p.size;
      c.lineCap     = 'round';

      const style = p.lineStyle || 'solid';

      // Set dash pattern
      if (style === 'dashed') {
        c.setLineDash([p.size * 3, p.size * 2]);
      } else if (style === 'dotted') {
        c.setLineDash([1, p.size * 2.5]);
      } else {
        c.setLineDash([]);
      }

      c.beginPath();
      c.moveTo(p.x1, p.y1);
      c.lineTo(p.x2, p.y2);
      c.stroke();

      // Reset dash before drawing arrowheads
      c.setLineDash([]);

      // Arrowheads
      if (style === 'arrow' || style === 'double-arrow') {
        drawArrowhead(c, p.x1, p.y1, p.x2, p.y2, p.size);
      }
      if (style === 'double-arrow') {
        drawArrowhead(c, p.x2, p.y2, p.x1, p.y1, p.size);
      }

      c.restore();
      return;
    }

    /* ── Pen / Eraser ── */
    if (!p.points || p.points.length < 2) { c.restore(); return; }
    c.lineWidth = p.size;
    c.lineCap   = 'round';
    c.lineJoin  = 'round';
    if (p.tool === 'eraser') {
      c.globalCompositeOperation = 'destination-out';
      c.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      c.globalCompositeOperation = 'source-over';
      c.strokeStyle = p.color;
    }
    c.beginPath();
    c.moveTo(p.points[0].x, p.points[0].y);
    for (let i = 1; i < p.points.length - 1; i++) {
      const mx = (p.points[i].x + p.points[i + 1].x) / 2;
      const my = (p.points[i].y + p.points[i + 1].y) / 2;
      c.quadraticCurveTo(p.points[i].x, p.points[i].y, mx, my);
    }
    c.lineTo(p.points.at(-1).x, p.points.at(-1).y);
    c.stroke();
    c.restore();
  }

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of paths) renderPath(ctx, p);
  }

  /* ═══════════════════════════════════
     ACTIONS
     ═══════════════════════════════════ */
  function undo() {
    if (!paths.length) return;
    undoneStack.push(paths.pop());
    redraw();
    showToast('Undo', 'info');
  }
  function redo() {
    if (!undoneStack.length) return;
    paths.push(undoneStack.pop());
    redraw();
    showToast('Redo', 'info');
  }
  function clearAll() {
    if (!paths.length) return;
    undoneStack.push(...paths);
    paths = [];
    redraw();
    showToast('Cleared — undo to restore', 'info');
  }

  /* ═══════════════════════════════════
     SAVE / LOAD
     ═══════════════════════════════════ */
  function pageKey() {
    return 'doodle_' + location.href.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 200);
  }

  function save() {
    const data = JSON.stringify(paths);
    chrome.storage.local.set({ [pageKey()]: data }, () => {
      if (chrome.runtime.lastError) {
        showToast('Save failed: ' + chrome.runtime.lastError.message, 'warn');
      } else {
        showToast(`Saved ${paths.length} strokes`, 'success');
      }
    });
  }

  function load() {
    chrome.storage.local.get(pageKey(), (result) => {
      const raw = result[pageKey()];
      if (raw) {
        try {
          paths = JSON.parse(raw);
          undoneStack = [];
          redraw();
          if (paths.length) showToast(`Loaded ${paths.length} strokes`, 'info');
        } catch (_) {}
      }
    });
  }

  /* ═══════════════════════════════════
     EXPORT DOODLE (transparent PNG)
     ═══════════════════════════════════ */
  function exportDoodle() {
    if (!paths.length) { showToast('Draw something first', 'warn'); return; }
    const dpr = window.devicePixelRatio || 1;
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const cx2 = c.getContext('2d');
    cx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const p of paths) renderPath(cx2, p);
    triggerDownload(c.toDataURL('image/png'), `doodle-${Date.now()}.png`);
    showToast('Doodle PNG saved', 'success');
  }

  /* ═══════════════════════════════════
     SCREENSHOT — full page or cropped
     ═══════════════════════════════════ */
  function exportScreenshot(cropRect) {
    if (!paths.length) { showToast('Draw something first', 'warn'); return; }
    showToast('Capturing…', 'info');

    const hideEls = [canvas, toolbar, toast, badge, selOverlay];
    hideEls.forEach((el) => (el.style.visibility = 'hidden'));

    requestAnimationFrame(() => {
      setTimeout(() => {
        chrome.runtime.sendMessage({ action: 'captureTab' }, (shotUrl) => {
          hideEls.forEach((el) => (el.style.visibility = ''));

          if (chrome.runtime.lastError || !shotUrl) {
            showToast('Capture failed — check permissions', 'warn');
            return;
          }

          const img = new Image();
          img.onload = () => {
            let outW = img.width, outH = img.height;
            let srcX = 0, srcY = 0, srcW = img.width, srcH = img.height;
            let offsetX = 0, offsetY = 0;

            if (cropRect) {
              const rx = img.width  / window.innerWidth;
              const ry = img.height / window.innerHeight;
              srcX = Math.round(cropRect.x * rx);
              srcY = Math.round(cropRect.y * ry);
              srcW = Math.round(cropRect.w * rx);
              srcH = Math.round(cropRect.h * ry);
              outW = srcW; outH = srcH;
              offsetX = -cropRect.x;
              offsetY = -cropRect.y;
            }

            // Final output canvas
            const c  = document.createElement('canvas');
            c.width  = outW; c.height = outH;
            const cx2 = c.getContext('2d');

            // 1 — Draw page image (full or cropped region)
            cx2.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH);

            // 2 — Render doodle to a separate transparent layer
            const dLayer = document.createElement('canvas');
            dLayer.width = outW; dLayer.height = outH;
            const dc = dLayer.getContext('2d');

            const sx = outW / (cropRect ? cropRect.w : window.innerWidth);
            const sy = outH / (cropRect ? cropRect.h : window.innerHeight);
            dc.setTransform(sx, 0, 0, sy, offsetX * sx, offsetY * sy);
            for (const p of paths) renderPath(dc, p);

            // 3 — Composite doodle layer on top of page
            cx2.setTransform(1, 0, 0, 1, 0, 0);
            cx2.drawImage(dLayer, 0, 0);

            const tag = cropRect ? 'region' : 'page';
            triggerDownload(c.toDataURL('image/png'), `${tag}-doodle-${Date.now()}.png`);
            showToast(cropRect ? 'Region saved' : 'Full page saved', 'success');
          };
          img.onerror = () => showToast('Screenshot processing failed', 'warn');
          img.src = shotUrl;
        });
      }, 200);
    });
  }

  /* ═══════════════════════════════════
     REGION SELECTION (snipping tool)
     ═══════════════════════════════════ */
  let selX0, selY0, isSelecting = false;

  function startRegionSelect() {
    if (!paths.length) { showToast('Draw something first', 'warn'); return; }
    canvas.classList.remove('active');
    canvas.style.pointerEvents = 'none';
    toolbar.classList.remove('visible');
    badge.classList.remove('visible');
    selOverlay.classList.add('active');
    showToast('Drag to select area · Esc to cancel', 'info');
  }

  function endRegionSelect() {
    isSelecting = false;
    selOverlay.classList.remove('active');
    selBox.style.display = 'none';
    if (isActive) {
      canvas.classList.add('active');
      toolbar.classList.add('visible');
      badge.classList.add('visible');
      setTool(tool);
    }
  }

  selOverlay.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    isSelecting = true;
    selX0 = e.clientX;
    selY0 = e.clientY;
    selBox.style.left   = selX0 + 'px';
    selBox.style.top    = selY0 + 'px';
    selBox.style.width  = '0';
    selBox.style.height = '0';
    selBox.style.display = 'block';
    selOverlay.setPointerCapture(e.pointerId);
  });

  selOverlay.addEventListener('pointermove', (e) => {
    if (!isSelecting) return;
    e.preventDefault();
    const x = Math.min(e.clientX, selX0);
    const y = Math.min(e.clientY, selY0);
    const w = Math.abs(e.clientX - selX0);
    const h = Math.abs(e.clientY - selY0);
    selBox.style.left   = x + 'px';
    selBox.style.top    = y + 'px';
    selBox.style.width  = w + 'px';
    selBox.style.height = h + 'px';
  });

  selOverlay.addEventListener('pointerup', (e) => {
    if (!isSelecting) return;
    try { selOverlay.releasePointerCapture(e.pointerId); } catch (_) {}

    const x = Math.min(e.clientX, selX0);
    const y = Math.min(e.clientY, selY0);
    const w = Math.abs(e.clientX - selX0);
    const h = Math.abs(e.clientY - selY0);

    endRegionSelect();

    if (w < 10 || h < 10) {
      showToast('Selection too small — try again', 'warn');
      return;
    }
    exportScreenshot({ x, y, w, h });
  });

  /* ═══════════════════════════════════
     HELPERS
     ═══════════════════════════════════ */
  function triggerDownload(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  let toastTimer = null;
  function showToast(msg, type) {
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.className = 'doodler-toast-show doodler-toast-' + type;
    toastTimer = setTimeout(() => { toast.className = ''; }, 2500);
  }

  /* ═══════════════════════════════════
     SCROLL PASSTHROUGH
     ═══════════════════════════════════ */
  canvas.addEventListener('wheel', (e) => {
    const pe = canvas.style.pointerEvents;
    canvas.style.pointerEvents = 'none';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    canvas.style.pointerEvents = pe;

    if (el) {
      let target = el;
      while (target && target !== document.documentElement) {
        const overflow  = getComputedStyle(target).overflowY;
        const scrollable = (overflow === 'auto' || overflow === 'scroll') && target.scrollHeight > target.clientHeight;
        if (scrollable) {
          target.scrollTop += e.deltaY;
          return;
        }
        target = target.parentElement;
      }
    }
    window.scrollBy(e.deltaX, e.deltaY);
  }, { passive: true });

  /* ═══════════════════════════════════
     ACTIVATE / DEACTIVATE
     ═══════════════════════════════════ */
  function activate() {
    isActive = true;
    canvas.classList.add('active');
    toolbar.classList.add('visible');
    badge.classList.add('visible');
    setTool(tool);
    load();
    updateSSTick();
    updateShapeTick();
    updateLineTick();
  }

  function deactivate() {
    isActive = false;
    isDrawing = false;
    currentPath = null;
    dragStart = null;
    finalizeTextInput();
    canvas.classList.remove('active');
    canvas.style.pointerEvents = 'none';
    toolbar.classList.remove('visible');
    badge.classList.remove('visible');
    selOverlay.classList.remove('active');
    selBox.style.display = 'none';
    closeDropdowns();
  }

  /* ═══════════════════════════════════
     KEYBOARD SHORTCUTS (capture phase)
     ═══════════════════════════════════ */
  document.addEventListener('keydown', (e) => {
    if (activeTextInput && document.activeElement === activeTextInput) return;
    if (document.activeElement === sizeNum) return;

    if (e.key === 'Escape' && selOverlay.classList.contains('active')) {
      endRegionSelect();
      showToast('Cancelled', 'info');
      return;
    }
    if (!isActive) return;

    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'z' && !e.shiftKey)                     { e.preventDefault(); undo(); }
    if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    if (mod && e.key === 's')                                     { e.preventDefault(); save(); }
    if (e.key === 'Escape') {
      deactivate();
      chrome.runtime.sendMessage({ action: 'doodleDeactivated' });
    }
  }, true);

  /* ═══════════════════════════════════
     MESSAGE LISTENER
     ═══════════════════════════════════ */
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg.action === 'toggle') {
      isActive ? deactivate() : activate();
      respond({ active: isActive });
    } else if (msg.action === 'getState') {
      respond({ active: isActive });
    }
    return true;
  });
})();
