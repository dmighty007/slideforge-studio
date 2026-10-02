// Properties panel section for connector elements.

function buildConnectorPanel(panel, data) {
  const connectorGrp = createGroup("Connector");
  connectorGrp.innerHTML += `
                <div class="grid grid-cols-2 gap-3">
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Type</label>
                        <select id="prop-connector-type" class="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:border-accent">
                            <option value="line" ${data.connectorType === "line" ? "selected" : ""}>Line</option>
                            <option value="curve" ${data.connectorType === "curve" ? "selected" : ""}>Curve</option>
                            <option value="poly" ${data.connectorType === "poly" ? "selected" : ""}>Polyline</option>
                        </select>
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Stroke</label>
                        <input type="number" id="prop-connector-width" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" min="1" max="24" value="${Math.max(1, Number(data.styles?.strokeWidth) || 4)}">
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Start</label>
                        <select id="prop-connector-start" class="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:border-accent">
                            <option value="none" ${(data.connectorStart || "none") === "none" ? "selected" : ""}>None</option>
                            <option value="arrow" ${data.connectorStart === "arrow" ? "selected" : ""}>Arrow</option>
                            <option value="triangle" ${data.connectorStart === "triangle" ? "selected" : ""}>Triangle</option>
                            <option value="chevron" ${data.connectorStart === "chevron" ? "selected" : ""}>Chevron</option>
                            <option value="line" ${data.connectorStart === "line" ? "selected" : ""}>Line</option>
                            <option value="dot" ${data.connectorStart === "dot" ? "selected" : ""}>Dot</option>
                            <option value="diamond" ${data.connectorStart === "diamond" ? "selected" : ""}>Diamond</option>
                            <option value="square" ${data.connectorStart === "square" ? "selected" : ""}>Square</option>
                        </select>
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">End</label>
                        <select id="prop-connector-end" class="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:border-accent">
                            <option value="none" ${data.connectorEnd === "none" ? "selected" : ""}>None</option>
                            <option value="arrow" ${(data.connectorEnd || "arrow") === "arrow" ? "selected" : ""}>Arrow</option>
                            <option value="triangle" ${data.connectorEnd === "triangle" ? "selected" : ""}>Triangle</option>
                            <option value="chevron" ${data.connectorEnd === "chevron" ? "selected" : ""}>Chevron</option>
                            <option value="line" ${data.connectorEnd === "line" ? "selected" : ""}>Line</option>
                            <option value="dot" ${data.connectorEnd === "dot" ? "selected" : ""}>Dot</option>
                            <option value="diamond" ${data.connectorEnd === "diamond" ? "selected" : ""}>Diamond</option>
                            <option value="square" ${data.connectorEnd === "square" ? "selected" : ""}>Square</option>
                        </select>
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Color</label>
                        <input type="color" id="prop-connector-color" class="w-full h-8 cursor-pointer rounded-md p-0" value="${_normalizeColorForInput(data.styles?.color, "#2563eb")}">
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Head W</label>
                        <input type="number" id="prop-connector-head-width" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" min="4" max="40" value="${Math.max(4, Number(data.connectorHeadWidth) || 14)}">
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Head L</label>
                        <input type="number" id="prop-connector-head-length" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" min="4" max="40" value="${Math.max(4, Number(data.connectorHeadLength) || 14)}">
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Nodes</label>
                        <div class="flex gap-2">
                            <button id="prop-connector-add-node" class="flex-1 py-2 rounded-lg bg-white border border-slate-300 text-slate-600 text-xs font-semibold hover:bg-slate-50">Add</button>
                            <button id="prop-connector-remove-node" class="flex-1 py-2 rounded-lg bg-white border border-slate-300 text-slate-600 text-xs font-semibold hover:bg-slate-50">Remove</button>
                        </div>
                    </div>
                </div>
                <p class="text-xs text-slate-600 leading-snug mt-2">Select the connector, then drag its points on the canvas to reshape it.</p>
            `;
  panel.appendChild(connectorGrp);
}

function bindConnectorPanel(data, onCommit) {
  const connectorType = document.getElementById("prop-connector-type");
  const connectorWidth = document.getElementById("prop-connector-width");
  const connectorStart = document.getElementById("prop-connector-start");
  const connectorEnd = document.getElementById("prop-connector-end");
  const connectorColor = document.getElementById("prop-connector-color");
  const connectorHeadWidth = document.getElementById(
    "prop-connector-head-width",
  );
  const connectorHeadLength = document.getElementById(
    "prop-connector-head-length",
  );
  const addNode = document.getElementById("prop-connector-add-node");
  const removeNode = document.getElementById(
    "prop-connector-remove-node",
  );

  if (connectorType) {
    connectorType.onchange = (e) => {
      onCommit(() => {
        const nextType =
          e.target.value === "curve" || e.target.value === "poly"
            ? e.target.value
            : "line";
        let nextPoints = getConnectorPoints(data).map((point) => ({
          ...point,
        }));
        if (nextType === "line") {
          nextPoints = [nextPoints[0], nextPoints[nextPoints.length - 1]];
        } else if (nextType === "curve" && nextPoints.length < 3) {
          const start = nextPoints[0];
          const end = nextPoints[nextPoints.length - 1];
          nextPoints = [
            start,
            {
              x: Math.round((start.x + end.x) / 2),
              y: Math.round(Math.min(start.y, end.y) - 60),
            },
            end,
          ];
        } else if (nextType === "poly" && nextPoints.length < 3) {
          const start = nextPoints[0];
          const end = nextPoints[nextPoints.length - 1];
          nextPoints = [
            start,
            { x: Math.round((start.x + end.x) / 2), y: start.y },
            end,
          ];
        }
        data.connectorType = nextType;
        data.points = nextPoints;
        normalizeConnectorGeometry(data);
        updateElementState(data.id, {
          connectorType: nextType,
          points: data.points,
          x: data.x,
          y: data.y,
          width: data.width,
          height: data.height,
        });
        syncConnectorDom?.(data.id);
      });
    };
  }

  if (connectorWidth) {
    const commitStrokeWidth = () =>
      onCommit(() => {
        const nextWidth = Math.max(
          1,
          Math.min(24, Number(connectorWidth.value) || 4),
        );
        updateElementStyleState(data.id, { strokeWidth: nextWidth });
        data.styles.strokeWidth = nextWidth;
        syncConnectorDom?.(data.id);
      });
    connectorWidth.onchange = commitStrokeWidth;
    connectorWidth.onblur = commitStrokeWidth;
  }

  if (connectorStart) {
    connectorStart.onchange = (e) =>
      onCommit(() => {
        updateElementState(data.id, { connectorStart: e.target.value });
        data.connectorStart = e.target.value;
        syncConnectorDom?.(data.id);
      });
  }

  if (connectorEnd) {
    connectorEnd.onchange = (e) =>
      onCommit(() => {
        updateElementState(data.id, { connectorEnd: e.target.value });
        data.connectorEnd = e.target.value;
        syncConnectorDom?.(data.id);
      });
  }

  if (connectorColor) {
    bindUndoableContinuousInput(connectorColor, (e) => {
      updateElementStyleState(data.id, { color: e.target.value });
      data.styles.color = e.target.value;
      syncConnectorDom?.(data.id);
    });
  }

  if (connectorHeadWidth) {
    const commitHW = () =>
      onCommit(() => {
        const v = Math.max(
          4,
          Math.min(40, Number(connectorHeadWidth.value) || 14),
        );
        updateElementState(data.id, { connectorHeadWidth: v });
        data.connectorHeadWidth = v;
        syncConnectorDom?.(data.id);
      });
    connectorHeadWidth.onchange = commitHW;
    connectorHeadWidth.onblur = commitHW;
  }

  if (connectorHeadLength) {
    const commitHL = () =>
      onCommit(() => {
        const v = Math.max(
          4,
          Math.min(40, Number(connectorHeadLength.value) || 14),
        );
        updateElementState(data.id, { connectorHeadLength: v });
        data.connectorHeadLength = v;
        syncConnectorDom?.(data.id);
      });
    connectorHeadLength.onchange = commitHL;
    connectorHeadLength.onblur = commitHL;
  }

  if (addNode) {
    addNode.onclick = () =>
      onCommit(() => {
        if ((data.connectorType || "line") === "line") return;
        const points = getConnectorPoints(data).map((point) => ({
          ...point,
        }));
        const prev = points[points.length - 2];
        const last = points[points.length - 1];
        points.splice(points.length - 1, 0, {
          x: Math.round((prev.x + last.x) / 2),
          y: Math.round(
            (prev.y + last.y) / 2 -
              (data.connectorType === "curve" ? 36 : 0),
          ),
        });
        data.points = points;
        normalizeConnectorGeometry(data);
        updateElementState(data.id, {
          points: data.points,
          x: data.x,
          y: data.y,
          width: data.width,
          height: data.height,
        });
        syncConnectorDom?.(data.id);
      });
  }

  if (removeNode) {
    removeNode.onclick = () =>
      onCommit(() => {
        const minPoints =
          (data.connectorType || "line") === "line" ? 2 : 3;
        const points = getConnectorPoints(data).map((point) => ({
          ...point,
        }));
        if (points.length <= minPoints) return;
        points.splice(points.length - 2, 1);
        data.points = points;
        normalizeConnectorGeometry(data);
        updateElementState(data.id, {
          points: data.points,
          x: data.x,
          y: data.y,
          width: data.width,
          height: data.height,
        });
        syncConnectorDom?.(data.id);
      });
  }
}
