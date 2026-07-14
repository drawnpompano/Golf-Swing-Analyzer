/* Canvas annotation engine: freehand, line, angle, circle and arrow tools
   drawn on an overlay canvas synced to the video's rendered size. */
class AnnotationCanvas {
  constructor(canvas, { onChange } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange || (() => {});

    this.tool = 'pointer';
    this.color = '#ff3b30';
    this.strokeWidth = 4;
    this.showGuide = false;

    this.shapes = [];
    this.draft = null;      // shape currently being drawn
    this.angleStage = 0;    // 0 = idle, 1 = first ray done awaiting second
    this.pendingAngle = null;

    this.cssWidth = 0;
    this.cssHeight = 0;
    this.dpr = window.devicePixelRatio || 1;

    this._bindPointerEvents();
  }

  setTool(tool) {
    this.tool = tool;
    this.angleStage = 0;
    this.pendingAngle = null;
    this.draft = null;
    this.render();
  }

  setColor(color) { this.color = color; }
  setStrokeWidth(w) { this.strokeWidth = Number(w); }

  setGuideVisible(visible) {
    this.showGuide = visible;
    this.render();
  }

  resize(width, height) {
    this.cssWidth = width;
    this.cssHeight = height;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(height * this.dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.render();
  }

  loadShapes(shapes) {
    this.shapes = Array.isArray(shapes) ? shapes.map((s) => ({ ...s })) : [];
    this.draft = null;
    this.angleStage = 0;
    this.pendingAngle = null;
    this.render();
  }

  getShapes() {
    return this.shapes;
  }

  undo() {
    this.shapes.pop();
    this.render();
    this.onChange(this.shapes);
  }

  clear() {
    this.shapes = [];
    this.render();
    this.onChange(this.shapes);
  }

  _pos(evt) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top
    };
  }

  _bindPointerEvents() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this._onDown(e));
    c.addEventListener('pointermove', (e) => this._onMove(e));
    c.addEventListener('pointerup', (e) => this._onUp(e));
    c.addEventListener('pointercancel', () => { this.draft = null; this.render(); });
  }

  _onDown(e) {
    if (this.tool === 'pointer') return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const p = this._pos(e);
    const base = { color: this.color, width: this.strokeWidth };

    if (this.tool === 'freehand') {
      this.draft = { type: 'freehand', points: [p], ...base };
    } else if (this.tool === 'line') {
      this.draft = { type: 'line', a: p, b: p, ...base };
    } else if (this.tool === 'arrow') {
      this.draft = { type: 'arrow', a: p, b: p, ...base };
    } else if (this.tool === 'circle') {
      this.draft = { type: 'circle', center: p, radius: 0, ...base };
    } else if (this.tool === 'angle') {
      if (this.angleStage === 0) {
        this.pendingAngle = { type: 'angle', vertex: p, end1: p, end2: p, ...base };
        this.draft = this.pendingAngle;
        this.angleStage = 1;
      } else if (this.angleStage === 2) {
        // second ray always starts at the shared vertex
        this.pendingAngle.end2 = { ...this.pendingAngle.vertex };
        this.draft = this.pendingAngle;
      }
    }
    this.render();
  }

  _onMove(e) {
    if (!this.draft) return;
    e.preventDefault();
    const p = this._pos(e);

    if (this.draft.type === 'freehand') {
      this.draft.points.push(p);
    } else if (this.draft.type === 'line' || this.draft.type === 'arrow') {
      this.draft.b = p;
    } else if (this.draft.type === 'circle') {
      const dx = p.x - this.draft.center.x;
      const dy = p.y - this.draft.center.y;
      this.draft.radius = Math.hypot(dx, dy);
    } else if (this.draft.type === 'angle') {
      if (this.angleStage === 1) this.draft.end1 = p;
      else this.draft.end2 = p;
    }
    this.render();
  }

  _onUp(e) {
    if (!this.draft) return;
    e.preventDefault();

    if (this.draft.type === 'angle') {
      if (this.angleStage === 1) {
        this.angleStage = 2;
        this.draft = null; // wait for second pointerdown
        this.render();
        return;
      }
      // finished second ray
      this.shapes.push(this.pendingAngle);
      this.pendingAngle = null;
      this.draft = null;
      this.angleStage = 0;
      this.render();
      this.onChange(this.shapes);
      return;
    }

    if (this.draft.type === 'circle' && this.draft.radius < 4) {
      this.draft.radius = 6; // tap creates a small dot marker
    }
    if (
      (this.draft.type === 'line' || this.draft.type === 'arrow') &&
      Math.hypot(this.draft.b.x - this.draft.a.x, this.draft.b.y - this.draft.a.y) < 3
    ) {
      this.draft = null;
      this.render();
      return;
    }

    this.shapes.push(this.draft);
    this.draft = null;
    this.render();
    this.onChange(this.shapes);
  }

  // Draws committed shapes onto an arbitrary context at an arbitrary scale
  // (used to composite a full-resolution snapshot export).
  renderToContext(ctx, scale = 1) {
    for (const shape of this.shapes) this._strokeShape(shape, ctx, scale);
  }

  _scalePt(pt, scale) {
    return scale === 1 ? pt : { x: pt.x * scale, y: pt.y * scale };
  }

  _strokeShape(shape, ctx = this.ctx, scale = 1) {
    ctx.strokeStyle = shape.color;
    ctx.fillStyle = shape.color;
    ctx.lineWidth = shape.width * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const S = (pt) => this._scalePt(pt, scale);

    if (shape.type === 'freehand') {
      ctx.beginPath();
      shape.points.forEach((pt, i) => {
        const p = S(pt);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    } else if (shape.type === 'line') {
      const a = S(shape.a), b = S(shape.b);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else if (shape.type === 'arrow') {
      this._drawArrow(S(shape.a), S(shape.b), shape.width * scale, ctx);
    } else if (shape.type === 'circle') {
      const center = S(shape.center);
      ctx.beginPath();
      ctx.arc(center.x, center.y, Math.max(shape.radius * scale, 2), 0, Math.PI * 2);
      ctx.stroke();
    } else if (shape.type === 'angle') {
      this._drawAngle(
        { vertex: S(shape.vertex), end1: S(shape.end1), end2: S(shape.end2), width: shape.width * scale },
        ctx
      );
    }
  }

  _drawArrow(a, b, width, ctx = this.ctx) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const headLen = 10 + width * 2;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(
      b.x - headLen * Math.cos(angle - Math.PI / 7),
      b.y - headLen * Math.sin(angle - Math.PI / 7)
    );
    ctx.lineTo(
      b.x - headLen * Math.cos(angle + Math.PI / 7),
      b.y - headLen * Math.sin(angle + Math.PI / 7)
    );
    ctx.closePath();
    ctx.fill();
  }

  _drawAngle(shape, ctx = this.ctx) {
    const { vertex, end1, end2 } = shape;

    ctx.beginPath();
    ctx.moveTo(vertex.x, vertex.y);
    ctx.lineTo(end1.x, end1.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(vertex.x, vertex.y);
    ctx.lineTo(end2.x, end2.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(vertex.x, vertex.y, 4, 0, Math.PI * 2);
    ctx.fill();

    const v1 = { x: end1.x - vertex.x, y: end1.y - vertex.y };
    const v2 = { x: end2.x - vertex.x, y: end2.y - vertex.y };
    const len1 = Math.hypot(v1.x, v1.y) || 1;
    const len2 = Math.hypot(v2.x, v2.y) || 1;

    if (len1 > 6 && len2 > 6) {
      const dot = (v1.x * v2.x + v1.y * v2.y) / (len1 * len2);
      const deg = (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;

      const arcRadius = Math.min(36, len1 * 0.4, len2 * 0.4);
      const a1 = Math.atan2(v1.y, v1.x);
      const a2 = Math.atan2(v2.y, v2.x);
      ctx.save();
      ctx.lineWidth = Math.max(1.5, shape.width / 2.5);
      ctx.beginPath();
      ctx.arc(vertex.x, vertex.y, arcRadius, a1, a2, false);
      ctx.stroke();
      ctx.restore();

      const bisector = Math.atan2((v1.y / len1) + (v2.y / len2), (v1.x / len1) + (v2.x / len2));
      const labelDist = arcRadius + 18;
      const lx = vertex.x + Math.cos(bisector) * labelDist;
      const ly = vertex.y + Math.sin(bisector) * labelDist;

      const text = `${deg.toFixed(1)}°`;
      ctx.font = '600 15px -apple-system, sans-serif';
      const metrics = ctx.measureText(text);
      const padX = 6, padY = 4;
      ctx.fillStyle = 'rgba(11,31,25,0.85)';
      ctx.fillRect(lx - metrics.width / 2 - padX, ly - 15 / 2 - padY, metrics.width + padX * 2, 15 + padY * 2);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, lx, ly);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }
  }

  _drawGuide() {
    const ctx = this.ctx;
    const w = this.cssWidth, h = this.cssHeight;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    if (this.showGuide) this._drawGuide();
    for (const shape of this.shapes) this._strokeShape(shape);
    if (this.draft) this._strokeShape(this.draft);
  }
}
