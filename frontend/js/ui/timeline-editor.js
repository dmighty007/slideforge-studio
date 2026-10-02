/**
 * Timeline Editor UI
 * Interactive timeline panel for scrubbing, keyframe management, and animation editing
 */

class TimelineEditor {
    constructor(containerId = "timeline-editor-panel") {
        this.containerId = containerId;
        this.isVisible = false;
        this.playheadTime = 0;
        this.totalDuration = 0;
        this.zoomLevel = 1;
        this.selectedAnimation = null;
        this.onPlayheadChange = null;
    }

    /**
     * Initialize timeline editor
     */
    initialize() {
        this._createDOM();
        this._attachEventListeners();
    }

    /**
     * Create DOM structure
     */
    _createDOM() {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        container.innerHTML = `
      <div class="timeline-editor-wrapper">
        <!-- Controls -->
        <div class="timeline-controls">
          <div class="playback-controls">
            <button id="timeline-play" class="timeline-btn timeline-btn-play" title="Play">
              <i class="fa-solid fa-play"></i>
            </button>
            <button id="timeline-pause" class="timeline-btn timeline-btn-pause" title="Pause">
              <i class="fa-solid fa-pause"></i>
            </button>
            <button id="timeline-stop" class="timeline-btn timeline-btn-stop" title="Stop">
              <i class="fa-solid fa-stop"></i>
            </button>
          </div>

          <div class="timeline-time-display">
            <input id="timeline-current-time" type="number" min="0" value="0" class="time-input">
            <span class="time-unit">ms</span>
            <span class="time-divider">/</span>
            <span id="timeline-total-time" class="time-display">0ms</span>
          </div>

          <div class="timeline-zoom-controls">
            <button id="timeline-zoom-out" class="timeline-btn" title="Zoom Out">
              <i class="fa-solid fa-magnifying-glass-minus"></i>
            </button>
            <span id="timeline-zoom-level" class="zoom-display">100%</span>
            <button id="timeline-zoom-in" class="timeline-btn" title="Zoom In">
              <i class="fa-solid fa-magnifying-glass-plus"></i>
            </button>
            <button id="timeline-zoom-reset" class="timeline-btn" title="Reset Zoom">
              <i class="fa-solid fa-rotate-left"></i>
            </button>
          </div>
        </div>

        <div class="timeline-main-content">
          <!-- Timeline Scrollable Area -->
          <div class="timeline-scroll-container">
            <!-- Timeline header / Ruler -->
            <div class="timeline-header">
              <div class="ruler-spacer"></div>
              <div class="timeline-ruler">
                <div class="ruler-labels"></div>
              </div>
            </div>

            <!-- Timeline tracks -->
            <div class="timeline-tracks">
              <div id="timeline-tracks-list" class="tracks-list">
                <!-- Dynamically populated with animation tracks -->
              </div>
            </div>

            <!-- Vertical Playhead Line -->
            <div class="playhead-indicator"></div>
          </div>

          <!-- Animation properties panel -->
          <div class="timeline-properties" id="timeline-properties">
            <div class="properties-header">
              <h4>Animation Properties</h4>
            </div>
            <div id="timeline-properties-content" class="properties-content">
              <p class="empty-state">Select an animation to edit</p>
            </div>
          </div>
        </div>
      </div>

      <style>
        #timeline-editor-panel {
          height: 250px;
          min-height: 200px;
          max-height: 400px;
          display: flex;
          flex-direction: column;
          box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.08);
          z-index: 99;
        }

        .timeline-editor-wrapper {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--bg-primary, #ffffff);
          border-top: 1px solid var(--divider, #e2e8f0);
          font-family: 'Inter', -apple-system, sans-serif;
        }

        .timeline-controls {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 8px 16px;
          background: var(--bg-secondary, #f8fafc);
          border-bottom: 1px solid var(--divider, #e2e8f0);
        }

        .playback-controls {
          display: flex;
          gap: 6px;
        }

        .timeline-btn {
          width: 32px;
          height: 32px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--divider, #cbd5e1);
          background: var(--bg-primary, #ffffff);
          color: #475569;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        }

        .timeline-btn:hover {
          background: var(--bg-tertiary, #f1f5f9);
          border-color: #94a3b8;
          color: #0f172a;
        }

        .timeline-btn-play.active {
          background: #2563eb;
          color: white !important;
          border-color: #2563eb;
        }

        .timeline-btn-pause.active {
          background: #f59e0b;
          color: white !important;
          border-color: #f59e0b;
        }

        .timeline-time-display {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: #64748b;
          font-weight: 500;
        }

        .time-input {
          width: 70px;
          padding: 4px 8px;
          border: 1px solid var(--divider, #cbd5e1);
          border-radius: 4px;
          font-size: 12px;
          text-align: right;
          font-weight: 600;
          color: #1e293b;
          background: #ffffff;
        }

        .time-input:focus {
          border-color: #2563eb;
          outline: none;
        }

        .time-unit,
        .time-divider {
          font-size: 11px;
          color: #94a3b8;
        }

        .timeline-zoom-controls {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-left: auto;
        }

        .zoom-display {
          font-size: 11px;
          color: #64748b;
          font-weight: 600;
          min-width: 48px;
          text-align: center;
        }

        .timeline-main-content {
          flex: 1;
          display: flex;
          overflow: hidden;
        }

        .timeline-scroll-container {
          flex: 1;
          overflow-x: auto;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          position: relative;
          background: var(--bg-primary, #ffffff);
        }

        .timeline-header {
          display: flex;
          height: 36px;
          border-bottom: 1px solid var(--divider, #e2e8f0);
          position: sticky;
          top: 0;
          z-index: 25;
          width: calc(100% * var(--zoom-factor, 1));
          min-width: 100%;
        }

        .ruler-spacer {
          flex: 0 0 150px;
          background: var(--bg-secondary, #f8fafc);
          border-right: 1px solid var(--divider, #e2e8f0);
          position: sticky;
          left: 0;
          z-index: 21;
        }

        .timeline-ruler {
          flex: 1;
          height: 100%;
          position: relative;
          background: var(--bg-secondary, #f8fafc);
          user-select: none;
          cursor: ew-resize;
        }

        .ruler-labels {
          display: flex;
          height: 100%;
          align-items: center;
          font-size: 10px;
          color: #64748b;
          font-weight: 600;
        }

        .ruler-label {
          border-right: 1px solid rgba(226, 232, 240, 0.8);
          height: 100%;
          display: flex;
          align-items: center;
          padding-left: 6px;
          box-sizing: border-box;
        }

        .playhead-indicator {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 2px;
          background: #4f46e5;
          pointer-events: none;
          z-index: 30;
          left: 150px;
        }

        .playhead-indicator::before {
          content: "";
          position: absolute;
          top: 0;
          left: -6px;
          width: 14px;
          height: 14px;
          background: #4f46e5;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-135deg);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
        }

        .timeline-tracks {
          flex: 1;
          width: calc(100% * var(--zoom-factor, 1));
          min-width: 100%;
        }

        .tracks-list {
          display: flex;
          flex-direction: column;
          background: var(--bg-primary, #ffffff);
        }

        .timeline-track {
          display: flex;
          min-height: 48px;
          border-bottom: 1px solid var(--divider, #f1f5f9);
          background: var(--bg-primary, #ffffff);
          transition: background 0.15s ease;
        }

        .timeline-track:hover {
          background: var(--bg-secondary, #f8fafc);
        }

        .timeline-track.selected {
          background: rgba(37, 99, 235, 0.04);
          border-left: 3px solid #2563eb;
        }

        .track-label {
          flex: 0 0 150px;
          display: flex;
          align-items: center;
          padding: 0 12px;
          background: var(--bg-primary, #ffffff);
          border-right: 1px solid var(--divider, #e2e8f0);
          font-size: 11px;
          font-weight: 600;
          color: #334155;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          position: sticky;
          left: 0;
          z-index: 20;
          box-shadow: 2px 0 5px rgba(0, 0, 0, 0.02);
        }

        .timeline-track.selected .track-label {
          color: #2563eb;
          background: #f0f7ff;
        }

        .track-content {
          flex: 1;
          position: relative;
          min-height: 48px;
        }

        .animation-block {
          position: absolute;
          top: 8px;
          bottom: 8px;
          background: #3b82f6;
          border-radius: 6px;
          cursor: grab;
          transition: transform 0.1s ease, box-shadow 0.1s ease;
          user-select: none;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .animation-block:active {
          cursor: grabbing;
        }

        .animation-block:hover {
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.14);
          transform: translateY(-0.5px);
        }

        .animation-block.selected {
          box-shadow: 0 0 0 2px #ffffff, 0 0 0 4px #2563eb;
          z-index: 10;
        }

        .animation-block-label {
          padding: 6px 10px;
          color: white;
          font-size: 10px;
          font-weight: 700;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          height: 100%;
          box-sizing: border-box;
          display: flex;
          align-items: center;
        }

        .animation-block-drag-handle {
          position: absolute;
          width: 6px;
          top: 0;
          bottom: 0;
          background: rgba(255, 255, 255, 0.2);
          cursor: ew-resize;
          transition: background 0.15s;
        }

        .animation-block-drag-handle:hover {
          background: rgba(255, 255, 255, 0.45);
        }

        .animation-block-drag-handle.start {
          left: 0;
          border-radius: 6px 0 0 6px;
        }

        .animation-block-drag-handle.end {
          right: 0;
          border-radius: 0 6px 6px 0;
        }

        .timeline-properties {
          flex: 0 0 240px;
          border-left: 1px solid var(--divider, #e2e8f0);
          display: flex;
          flex-direction: column;
          background: var(--bg-secondary, #f8fafc);
        }

        .properties-header {
          padding: 10px 14px;
          border-bottom: 1px solid var(--divider, #e2e8f0);
          font-weight: 700;
          font-size: 12px;
          color: #1e293b;
        }

        .properties-header h4 {
          margin: 0;
        }

        .properties-content {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
          font-size: 12px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .properties-content .empty-state {
          text-align: center;
          color: #94a3b8;
          padding: 30px 8px;
          margin: 0;
          font-style: italic;
        }

        .properties-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .properties-group label {
          font-weight: 600;
          color: #64748b;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .properties-group input,
        .properties-group select {
          width: 100%;
          padding: 6px 8px;
          border: 1px solid var(--divider, #cbd5e1);
          border-radius: 4px;
          font-size: 12px;
          color: #1e293b;
          background: #ffffff;
        }

        .properties-group input:focus,
        .properties-group select:focus {
          border-color: #2563eb;
          outline: none;
        }

        /* ── Dark Mode Style Additions ── */
        :root[data-theme="dark"] .timeline-editor-wrapper {
          background: #1e293b;
          border-top: 1px solid #334155;
        }

        :root[data-theme="dark"] .timeline-controls {
          background: #0f172a;
          border-bottom: 1px solid #334155;
        }

        :root[data-theme="dark"] .timeline-btn {
          background: #1e293b;
          border-color: #334155;
          color: #cbd5e1;
        }

        :root[data-theme="dark"] .timeline-btn:hover {
          background: #334155;
          border-color: #38bdf8;
          color: #ffffff;
        }

        :root[data-theme="dark"] .time-input {
          background: #0f172a;
          border-color: #334155;
          color: #ffffff;
        }

        :root[data-theme="dark"] .timeline-scroll-container {
          background: #1e293b;
        }

        :root[data-theme="dark"] .timeline-header {
          border-bottom: 1px solid #334155;
        }

        :root[data-theme="dark"] .ruler-spacer {
          background: #0f172a;
          border-right: 1px solid #334155;
        }

        :root[data-theme="dark"] .timeline-ruler {
          background: #0f172a;
        }

        :root[data-theme="dark"] .ruler-label {
          border-right: 1px solid rgba(51, 65, 85, 0.5);
          color: #94a3b8;
        }

        :root[data-theme="dark"] .timeline-track {
          background: #1e293b;
          border-bottom: 1px solid #0f172a;
        }

        :root[data-theme="dark"] .timeline-track:hover {
          background: #1e293b;
        }

        :root[data-theme="dark"] .timeline-track.selected {
          background: rgba(56, 189, 248, 0.04);
        }

        :root[data-theme="dark"] .track-label {
          background: #1e293b;
          border-right: 1px solid #334155;
          color: #e2e8f0;
        }

        :root[data-theme="dark"] .timeline-track.selected .track-label {
          color: #38bdf8;
          background: #0f172a;
        }

        :root[data-theme="dark"] .timeline-properties {
          background: #0f172a;
          border-left: 1px solid #334155;
        }

        :root[data-theme="dark"] .properties-header {
          border-bottom: 1px solid #334155;
          color: #ffffff;
        }

        :root[data-theme="dark"] .properties-group label {
          color: #94a3b8;
        }

        :root[data-theme="dark"] .properties-group input,
        :root[data-theme="dark"] .properties-group select {
          background: #1e293b;
          border-color: #334155;
          color: #ffffff;
        }
      </style>
    `;
    }

    /**
     * Attach event listeners
     */
    _attachEventListeners() {
        const playBtn = document.getElementById("timeline-play");
        const pauseBtn = document.getElementById("timeline-pause");
        const stopBtn = document.getElementById("timeline-stop");
        const timeInput = document.getElementById("timeline-current-time");
        const zoomIn = document.getElementById("timeline-zoom-in");
        const zoomOut = document.getElementById("timeline-zoom-out");
        const zoomReset = document.getElementById("timeline-zoom-reset");

        if (playBtn) {
            playBtn.addEventListener("click", () => this.play());
        }
        if (pauseBtn) {
            pauseBtn.addEventListener("click", () => this.pause());
        }
        if (stopBtn) {
            stopBtn.addEventListener("click", () => this.stop());
        }
        if (timeInput) {
            timeInput.addEventListener("change", e => {
                const time = Math.max(0, Math.min(this.totalDuration, Number(e.target.value) || 0));
                this.seek(time);
            });
        }
        if (zoomIn) {
            zoomIn.addEventListener("click", () => this.zoomIn());
        }
        if (zoomOut) {
            zoomOut.addEventListener("click", () => this.zoomOut());
        }
        if (zoomReset) {
            zoomReset.addEventListener("click", () => this.resetZoom());
        }

        // Attach new interactive scrubbing on the ruler!
        this._attachRulerScrubbing();
    }

    /**
     * Ruler scrubbing handler
     */
    _attachRulerScrubbing() {
        const ruler = document.querySelector(".timeline-ruler");
        if (!ruler) return;

        const handleScrub = (e) => {
            const rect = ruler.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const width = rect.width;
            if (width <= 0) return;
            const pct = Math.max(0, Math.min(1, clickX / width));
            const time = pct * this.totalDuration;
            this.seek(time);
        };

        ruler.addEventListener("mousedown", (e) => {
            handleScrub(e);
            const onMouseMove = (moveEvent) => {
                handleScrub(moveEvent);
            };
            const onMouseUp = () => {
                window.removeEventListener("mousemove", onMouseMove);
                window.removeEventListener("mouseup", onMouseUp);
            };
            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
        });
    }

    /**
     * Alias for selection changes compatibility
     */
    updateFromSelection() {
        this.updateTimeline();
    }

    /**
     * Update timeline with animations from ALL objects on slide
     */
    updateTimeline() {
        const tracksList = document.getElementById("timeline-tracks-list");
        if (!tracksList) return;

        tracksList.innerHTML = "";

        if (typeof state === "undefined" || typeof currentSlideIndex === "undefined") {
            this._clearTimeline();
            return;
        }

        // Get current slide
        const slide = state.slides[currentSlideIndex];
        if (!slide) {
            this._clearTimeline();
            return;
        }

        // Fetch all elements with animations configured
        const animatedElements = (slide.elements || [])
            .map(element => {
                const config = normalizeElementAnimationConfig(element);
                if (!config || !config.timelines || config.timelines.length === 0) return null;
                return { elementId: element.id, element, config };
            })
            .filter(Boolean);

        // If no animations at all, display a custom empty state
        if (animatedElements.length === 0) {
            tracksList.innerHTML = `
        <div class="properties-content">
          <p class="empty-state">No animations configured on this slide.<br>Select any element and add an animation from the Properties panel on the right.</p>
        </div>
      `;
            this.totalDuration = 1000;
            this._updateScrubberRange();
            this._updateRuler();
            return;
        }

        // Find max total duration of animations
        let maxDuration = 0;
        animatedElements.forEach(({ config }) => {
            config.timelines.forEach(timeline => {
                (timeline.animations || []).forEach(anim => {
                    const duration = Math.max(0, Number(anim.duration) || 0);
                    const startTime = Math.max(0, Number(anim.startTime ?? anim.delay) || 0);
                    maxDuration = Math.max(maxDuration, startTime + duration);
                });
            });
        });

        this.totalDuration = Math.max(1000, maxDuration + 200); // Pad slightly

        // Set zoom variable on the scroll container
        const scrollContainer = document.querySelector(".timeline-scroll-container");
        if (scrollContainer) {
            scrollContainer.style.setProperty("--zoom-factor", this.zoomLevel);
        }

        // Populate track list
        animatedElements.forEach(({ elementId, element, config }) => {
            const trackEl = this._createTrack(elementId, element, config);
            tracksList.appendChild(trackEl);
        });

        this._updateScrubberRange();
        this._updateRuler();
        this.updatePlayheadIndicator();
        this._showAnimationProperties(); // Re-sync properties inspector if selection is active
    }

    /**
     * Create track element for an object's animations
     */
    _createTrack(elementId, element, config) {
        const trackEl = document.createElement("div");
        trackEl.className = "timeline-track";
        
        // Highlight track if selected
        if (typeof state !== "undefined" && state.selectedIds && state.selectedIds.includes(elementId)) {
            trackEl.classList.add("selected");
        }

        const label = document.createElement("div");
        label.className = "track-label";
        label.textContent = element.content ? element.content.replace(/<[^>]*>/g, "") : (element.type || "Element");
        label.title = label.textContent + ` (${elementId})`;

        const content = document.createElement("div");
        content.className = "track-content";

        // Add animation blocks
        config.timelines.forEach((timeline, timelineIdx) => {
            (timeline.animations || []).forEach((anim, animIdx) => {
                const block = this._createAnimationBlock(elementId, anim, timelineIdx, animIdx, config);
                content.appendChild(block);
            });
        });

        trackEl.appendChild(label);
        trackEl.appendChild(content);

        return trackEl;
    }

    /**
     * Create animation block element
     */
    _createAnimationBlock(elementId, animation, timelineIdx, animIdx, config) {
        const block = document.createElement("div");
        block.className = "animation-block";
        
        const startTime = Math.max(0, Number(animation.startTime ?? animation.delay) || 0);
        const duration = Math.max(100, Number(animation.duration) || 100);
        const totalDuration = Math.max(100, Number(this.totalDuration) || 100);

        block.style.left = `${(startTime / totalDuration) * 100}%`;
        block.style.width = `${(duration / totalDuration) * 100}%`;
        block.style.background = this._getAnimationColor(animation.type);

        if (this.selectedAnimation && 
            this.selectedAnimation.elementId === elementId && 
            this.selectedAnimation.timelineIdx === timelineIdx && 
            this.selectedAnimation.animIdx === animIdx) {
            block.classList.add("selected");
        }

        const label = document.createElement("div");
        label.className = "animation-block-label";
        label.textContent = `${animation.type} (${Math.round(duration)}ms)`;

        block.appendChild(label);

        // Add resize drag handles
        const startHandle = document.createElement("div");
        startHandle.className = "animation-block-drag-handle start";
        block.appendChild(startHandle);

        const endHandle = document.createElement("div");
        endHandle.className = "animation-block-drag-handle end";
        block.appendChild(endHandle);

        // Click to select block and highlight associated slide element
        block.addEventListener("click", e => {
            e.stopPropagation();
            if (typeof selectElement === "function") {
                selectElement(elementId, "replace");
            }
            this.selectAnimation(elementId, timelineIdx, animIdx);
        });

        // ── Direct keyframe dragging & resizing logic ──
        
        // 1. Drag block to change start time
        block.addEventListener("mousedown", e => {
            if (e.target.classList.contains("animation-block-drag-handle")) return;
            e.stopPropagation();
            e.preventDefault();

            const trackContent = block.parentElement;
            const trackWidth = trackContent.getBoundingClientRect().width;
            const startX = e.clientX;
            const startVal = Math.max(0, Number(animation.startTime ?? animation.delay) || 0);

            const onMouseMove = (moveEvent) => {
                const deltaX = moveEvent.clientX - startX;
                const deltaPct = deltaX / trackWidth;
                const deltaTime = deltaPct * this.totalDuration;
                
                let newTime = Math.max(0, startVal + deltaTime);
                newTime = Math.round(newTime / 50) * 50; // align to 50ms intervals

                block.style.left = `${(newTime / this.totalDuration) * 100}%`;
                label.textContent = `${animation.type} (${Math.round(duration)}ms) [${newTime}ms]`;
            };

            const onMouseUp = (upEvent) => {
                window.removeEventListener("mousemove", onMouseMove);
                window.removeEventListener("mouseup", onMouseUp);

                const deltaX = upEvent.clientX - startX;
                // A click, not a drag: select the animation. Rebuilding the timeline here removed the block before
                // its click event, so the inspector never opened, and the empty change still took an undo step.
                if (Math.abs(deltaX) < 3) {
                    block.style.left = `${(startVal / this.totalDuration) * 100}%`;
                    if (typeof selectElement === "function") selectElement(elementId, "replace");
                    this.selectAnimation(elementId, timelineIdx, animIdx);
                    return;
                }
                const deltaPct = deltaX / trackWidth;
                const deltaTime = deltaPct * this.totalDuration;
                let newTime = Math.max(0, startVal + deltaTime);
                newTime = Math.round(newTime / 50) * 50;

                if (typeof saveStateToUndo === "function") saveStateToUndo();
                animation.delay = newTime;
                animation.startTime = newTime;
                
                if (typeof renderSlidesFromState === "function") renderSlidesFromState();
                this.updateTimeline();
            };

            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
        });

        // 2. Resize from start (left handle)
        startHandle.addEventListener("mousedown", e => {
            e.stopPropagation();
            e.preventDefault();

            const trackContent = block.parentElement;
            const trackWidth = trackContent.getBoundingClientRect().width;
            const startX = e.clientX;
            const startVal = Math.max(0, Number(animation.startTime ?? animation.delay) || 0);
            const startDuration = Math.max(100, Number(animation.duration) || 100);
            const originalEnd = startVal + startDuration;

            const onMouseMove = (moveEvent) => {
                const deltaX = moveEvent.clientX - startX;
                const deltaPct = deltaX / trackWidth;
                const deltaTime = deltaPct * this.totalDuration;
                
                let newStart = Math.max(0, startVal + deltaTime);
                newStart = Math.round(newStart / 50) * 50;
                newStart = Math.min(newStart, originalEnd - 100);

                const newDuration = originalEnd - newStart;

                block.style.left = `${(newStart / this.totalDuration) * 100}%`;
                block.style.width = `${(newDuration / this.totalDuration) * 100}%`;
                label.textContent = `${animation.type} (${Math.round(newDuration)}ms)`;
            };

            const onMouseUp = (upEvent) => {
                window.removeEventListener("mousemove", onMouseMove);
                window.removeEventListener("mouseup", onMouseUp);

                const deltaX = upEvent.clientX - startX;
                const deltaPct = deltaX / trackWidth;
                const deltaTime = deltaPct * this.totalDuration;
                let newStart = Math.max(0, startVal + deltaTime);
                newStart = Math.round(newStart / 50) * 50;
                newStart = Math.min(newStart, originalEnd - 100);
                const newDuration = originalEnd - newStart;

                if (typeof saveStateToUndo === "function") saveStateToUndo();
                animation.delay = newStart;
                animation.startTime = newStart;
                animation.duration = newDuration;

                if (typeof renderSlidesFromState === "function") renderSlidesFromState();
                this.updateTimeline();
            };

            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
        });

        // 3. Resize from end (right handle)
        endHandle.addEventListener("mousedown", e => {
            e.stopPropagation();
            e.preventDefault();

            const trackContent = block.parentElement;
            const trackWidth = trackContent.getBoundingClientRect().width;
            const startX = e.clientX;
            const startDuration = Math.max(100, Number(animation.duration) || 100);

            const onMouseMove = (moveEvent) => {
                const deltaX = moveEvent.clientX - startX;
                const deltaPct = deltaX / trackWidth;
                const deltaTime = deltaPct * this.totalDuration;
                
                let newDuration = Math.max(100, startDuration + deltaTime);
                newDuration = Math.round(newDuration / 50) * 50;

                block.style.width = `${(newDuration / this.totalDuration) * 100}%`;
                label.textContent = `${animation.type} (${Math.round(newDuration)}ms)`;
            };

            const onMouseUp = (upEvent) => {
                window.removeEventListener("mousemove", onMouseMove);
                window.removeEventListener("mouseup", onMouseUp);

                const deltaX = upEvent.clientX - startX;
                const deltaPct = deltaX / trackWidth;
                const deltaTime = deltaPct * this.totalDuration;
                let newDuration = Math.max(100, startDuration + deltaTime);
                newDuration = Math.round(newDuration / 50) * 50;

                if (typeof saveStateToUndo === "function") saveStateToUndo();
                animation.duration = newDuration;

                if (typeof renderSlidesFromState === "function") renderSlidesFromState();
                this.updateTimeline();
            };

            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
        });

        return block;
    }

    /**
     * Get color for animation type
     */
    _getAnimationColor(type) {
        const colors = {
            fadeIn: "#3b82f6",
            fadeOut: "#ef4444",
            transform: "#8b5cf6",
            scaleInPlace: "#ec4899",
            rotate: "#f59e0b",
            write: "#10b981",
            create: "#14b8a6",
            uncreate: "#6366f1",
            blur: "#06b6d4",
            glow: "#eab308",
            flip3D: "#f97316",
            replacementTransform: "#059669",
            moveAlongPath: "#4f46e5",
            textMorph: "#ec4899"
        };
        return colors[type] || "#64748b";
    }

    /**
     * Update ruler labels
     */
    _updateRuler() {
        const labels = document.querySelector(".ruler-labels");
        if (!labels || this.totalDuration === 0) return;

        labels.innerHTML = "";
        const interval = this._calculateRulerInterval();

        for (let time = 0; time <= this.totalDuration; time += interval) {
            const label = document.createElement("div");
            label.className = "ruler-label";
            label.textContent = `${time}ms`;
            label.style.flex = `0 0 ${(interval / this.totalDuration) * 100}%`;
            labels.appendChild(label);
        }
    }

    /**
     * Calculate appropriate ruler interval
     */
    _calculateRulerInterval() {
        const intervals = [100, 250, 500, 1000, 2000, 5000];
        const targetWidth = 60;
        const ruler = document.querySelector(".timeline-ruler");
        const containerWidth = ruler ? ruler.offsetWidth : 600;
        const pixelsPerMs = (containerWidth / this.totalDuration) * this.zoomLevel;

        for (const interval of intervals) {
            if (pixelsPerMs * interval > targetWidth) {
                return interval;
            }
        }
        return 5000;
    }

    /**
     * Update scrubber range
     */
    _updateScrubberRange() {
        this._updateTimeDisplay();
    }

    /**
     * Update time display
     */
    _updateTimeDisplay() {
        const currentDisplay = document.getElementById("timeline-current-time");
        const totalDisplay = document.getElementById("timeline-total-time");

        if (currentDisplay) {
            currentDisplay.value = Math.round(this.playheadTime);
        }
        if (totalDisplay) {
            totalDisplay.textContent = `${Math.round(this.totalDuration)}ms`;
        }
    }

    /**
     * Update position of playhead vertical line
     */
    updatePlayheadIndicator() {
        const indicator = document.querySelector(".playhead-indicator");
        if (indicator) {
            const pct = this.totalDuration > 0 ? (this.playheadTime / this.totalDuration) * 100 : 0;
            // Align starting 150px layout spacer with tracks
            indicator.style.left = `calc(150px + (100% - 150px) * ${pct / 100})`;
        }
    }

    /**
     * Clear timeline
     */
    _clearTimeline() {
        const tracksList = document.getElementById("timeline-tracks-list");
        if (tracksList) {
            tracksList.innerHTML = '<p class="empty-state">Select objects or add animations to show tracks</p>';
        }
    }

    /**
     * Select animation for editing
     */
    selectAnimation(elementId, timelineIdx, animIdx) {
        this.selectedAnimation = { elementId, timelineIdx, animIdx };
        this._showAnimationProperties();
        this.updateTimeline(); // refresh selection highlighters
    }

    /**
     * Show selected animation properties in properties box
     */
    _showAnimationProperties() {
        const content = document.getElementById("timeline-properties-content");
        if (!content) return;

        if (!this.selectedAnimation) {
            content.innerHTML = '<p class="empty-state">Select an animation to edit</p>';
            return;
        }

        const { elementId, timelineIdx, animIdx } = this.selectedAnimation;
        if (typeof state === "undefined" || typeof currentSlideIndex === "undefined") return;
        const slide = state.slides[currentSlideIndex];
        const element = slide ? slide.elements.find(el => el.id === elementId) : null;

        if (!element) {
            this.selectedAnimation = null;
            content.innerHTML = '<p class="empty-state">Select an animation to edit</p>';
            return;
        }

        const config = normalizeElementAnimationConfig(element);
        const timeline = config.timelines?.[timelineIdx];
        const animation = timeline ? timeline.animations?.[animIdx] : null;

        if (!animation) {
            this.selectedAnimation = null;
            content.innerHTML = '<p class="empty-state">Select an animation to edit</p>';
            return;
        }

        const types = (typeof ANIMATION_TRANSITION_TYPES !== "undefined") ? ANIMATION_TRANSITION_TYPES : [
            "fadeIn", "fadeOut", "transform", "scaleInPlace", "rotate", "write", "create", "uncreate", "blur", "glow", "flip3D"
        ];
        const easings = (typeof ANIMATION_EASINGS !== "undefined") ? ANIMATION_EASINGS : [
            "linear", "easeIn", "easeOut", "easeInOut", "easeOutBack", "easeInBack"
        ];

        content.innerHTML = "";
        
        // 1. Type
        const groupType = document.createElement("div");
        groupType.className = "properties-group";
        groupType.innerHTML = `
          <label>Type</label>
          <select id="prop-anim-type">
            ${types.map(t => `<option value="${t}" ${animation.type === t ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        `;
        content.appendChild(groupType);

        // 2. Start (Trigger)
        const groupTrigger = document.createElement("div");
        groupTrigger.className = "properties-group";
        groupTrigger.innerHTML = `
          <label>Trigger</label>
          <select id="prop-anim-trigger">
            <option value="on-slide" ${(animation.trigger || "on-slide") === "on-slide" ? "selected" : ""}>After slide appears</option>
            <option value="on-click" ${animation.trigger === "on-click" ? "selected" : ""}>On Click</option>
          </select>
        `;
        content.appendChild(groupTrigger);

        // 3. Duration
        const groupDuration = document.createElement("div");
        groupDuration.className = "properties-group";
        groupDuration.innerHTML = `
          <label>Duration (ms)</label>
          <input type="number" id="prop-anim-duration" value="${escapeHtml(String(animation.duration || 600))}" min="50" step="50">
        `;
        content.appendChild(groupDuration);

        // 4. Delay
        const groupDelay = document.createElement("div");
        groupDelay.className = "properties-group";
        groupDelay.innerHTML = `
          <label>Delay (ms)</label>
          <input type="number" id="prop-anim-delay" value="${escapeHtml(String(animation.delay || 0))}" min="0" step="50">
        `;
        content.appendChild(groupDelay);

        // 5. Easing
        const groupEasing = document.createElement("div");
        groupEasing.className = "properties-group";
        groupEasing.innerHTML = `
          <label>Easing</label>
          <select id="prop-anim-easing">
            ${easings.map(e => `<option value="${e}" ${animation.easing === e ? "selected" : ""}>${e}</option>`).join("")}
          </select>
        `;
        content.appendChild(groupEasing);

        // Bind Change listeners directly!
        const bindChange = (id, prop, isNumber = false) => {
            const el = content.querySelector(id);
            if (el) {
                el.addEventListener("change", (e) => {
                    const val = isNumber ? Number(e.target.value) : e.target.value;
                    if (typeof updateAnimationProperty === "function") {
                        updateAnimationProperty(elementId, timelineIdx, animIdx, prop, val);
                    } else {
                        if (typeof saveStateToUndo === "function") saveStateToUndo();
                        animation[prop] = val;
                        if (prop === "delay") animation.startTime = val;
                        if (typeof renderSlidesFromState === "function") renderSlidesFromState();
                    }
                    this.updateTimeline();
                });
            }
        };

        bindChange("#prop-anim-type", "type");
        bindChange("#prop-anim-trigger", "trigger");
        bindChange("#prop-anim-duration", "duration", true);
        bindChange("#prop-anim-delay", "delay", true);
        bindChange("#prop-anim-easing", "easing");
    }

    // Playback controls
    play() {
        const engine = getAnimationEngine();
        if (typeof state !== "undefined" && typeof currentSlideIndex !== "undefined") {
            engine.restoreElements();
            engine.loadSlide(state.slides?.[currentSlideIndex]);
            engine.seek(this.playheadTime || 0);
        }
        engine.play();
        this._startPlayheadTracking();
        this._updatePlayButton();
    }

    pause() {
        const engine = getAnimationEngine();
        engine.pause();
        this._stopPlayheadTracking();
        this._updatePlayButton();
    }

    stop() {
        const engine = getAnimationEngine();
        engine.pause();
        // Back to the slide as it is edited. Seeking to 0 left every object in its pre-entrance state (invisible,
        // or shifted) on the canvas.
        engine.restoreElements();
        this.playheadTime = 0;
        this._stopPlayheadTracking();
        this._updateTimeDisplay();
        this.updatePlayheadIndicator();
        this._updatePlayButton();
    }

    seek(time) {
        const engine = getAnimationEngine();
        if (typeof state !== "undefined" && typeof currentSlideIndex !== "undefined") {
            engine.loadSlide(state.slides?.[currentSlideIndex]);
        }
        engine.seek(time);
        this.playheadTime = time;
        this._updateTimeDisplay();
        this.updatePlayheadIndicator();
    }

    _startPlayheadTracking() {
        this._stopPlayheadTracking();
        const engine = getAnimationEngine();
        const tick = () => {
            if (engine.isPlaying) {
                this.playheadTime = Number(engine.playheadTime ?? engine.currentTime) || 0;
                this._updateTimeDisplay();
                this.updatePlayheadIndicator();
                this._playheadFrame = requestAnimationFrame(tick);
            } else {
                this._updatePlayButton();
            }
        };
        this._playheadFrame = requestAnimationFrame(tick);
    }

    _stopPlayheadTracking() {
        if (this._playheadFrame) {
            cancelAnimationFrame(this._playheadFrame);
            this._playheadFrame = null;
        }
    }

    // Zoom controls
    zoomIn() {
        this.zoomLevel = Math.min(4, this.zoomLevel * 1.25);
        this._updateZoomDisplay();
        this.updateTimeline();
    }

    zoomOut() {
        this.zoomLevel = Math.max(0.5, this.zoomLevel / 1.25);
        this._updateZoomDisplay();
        this.updateTimeline();
    }

    resetZoom() {
        this.zoomLevel = 1;
        this._updateZoomDisplay();
        this.updateTimeline();
    }

    _updateZoomDisplay() {
        const display = document.getElementById("timeline-zoom-level");
        if (display) {
            display.textContent = `${Math.round(this.zoomLevel * 100)}%`;
        }
    }

    _updatePlayButton() {
        const engine = getAnimationEngine();
        const playBtn = document.getElementById("timeline-play");
        const pauseBtn = document.getElementById("timeline-pause");

        if (playBtn) {
            playBtn.classList.toggle("active", engine.isPlaying);
        }
        if (pauseBtn) {
            pauseBtn.classList.toggle("active", !engine.isPlaying);
        }
    }
}

// Global timeline editor instance
let _timelineEditor = null;

function getTimelineEditor() {
    if (!_timelineEditor) {
        _timelineEditor = new TimelineEditor();
        _timelineEditor.initialize();
    }
    return _timelineEditor;
}

// The timeline follows the slide being edited (it kept showing the first slide's animations). Called after a
// slide change; any preview left on the old slide is put back first.
function refreshTimelineForSlide() {
    if (!_timelineEditor || !_timelineEditor.isVisible) return;
    if (_timelineEditor._shownSlide === currentSlideIndex) return;
    _timelineEditor._shownSlide = currentSlideIndex;
    try {
        const engine = getAnimationEngine();
        engine.pause();
        engine.restoreElements();
    } catch (_err) {}
    _timelineEditor._stopPlayheadTracking();
    _timelineEditor.playheadTime = 0;
    _timelineEditor.selectedAnimation = null;
    _timelineEditor.updateTimeline();
    _timelineEditor._updateTimeDisplay();
    _timelineEditor.updatePlayheadIndicator();
    _timelineEditor._updatePlayButton();
}

function toggleTimelineEditor() {
    const editor = getTimelineEditor();
    editor.isVisible = !editor.isVisible;
    const container = document.getElementById("timeline-editor-panel");
    const button = document.getElementById("toggle-timeline-editor");
    if (container) {
        container.style.display = editor.isVisible ? "flex" : "none";
    }
    if (button) {
        button.setAttribute("aria-pressed", editor.isVisible ? "true" : "false");
        button.title = editor.isVisible ? "Hide Animation Timeline Editor" : "Animation Timeline Editor";
    }
    if (editor.isVisible) {
        editor._shownSlide = currentSlideIndex;
        editor.updateTimeline();
    } else {
        editor.stop(); // closing the panel leaves no half-played preview on the slide
    }
}

window.refreshTimelineForSlide = refreshTimelineForSlide;

// Export
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        TimelineEditor,
        getTimelineEditor,
        toggleTimelineEditor,
    };
}
