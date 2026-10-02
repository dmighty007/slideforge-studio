// Properties panel section for image elements.

function buildImagePanel(panel, data) {
  if (data.excalidraw) {
    // A drawing: edit it in Excalidraw; its picture URL and crop controls do not apply.
    const drawingGrp = createGroup("Drawing");
    drawingGrp.innerHTML += `
                <button id="prop-edit-drawing" onclick="editDrawing('${data.id}')" class="w-full py-2 rounded bg-slate-900 border border-slate-700 text-xs text-slate-100 hover:bg-slate-800 transition-colors">
                    <i class="fa-solid fa-pen-ruler mr-1"></i> Edit drawing
                </button>
                <p class="text-[11px] text-gray-500 leading-relaxed mt-2">Or double-click the drawing on the slide.</p>
                <div class="flex gap-2 mt-3">
                    <div class="flex-1 flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold tracking-wider">Width</label>
                        <input type="number" id="prop-img-w" class="w-full text-xs" value="${parseFloat(data.width) || 0}">
                    </div>
                    <div class="flex-1 flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold tracking-wider">Height</label>
                        <input type="number" id="prop-img-h" class="w-full text-xs" value="${parseFloat(data.height) || 0}">
                    </div>
                </div>
                <label class="flex items-center gap-2 cursor-pointer group/chk mt-3">
                    <input type="checkbox" id="prop-img-lock-aspect" ${data.lockAspectRatio ? "checked" : ""} class="aspect-lock-checkbox prop-native-checkbox">
                    <span class="text-xs text-gray-400">Lock Aspect Ratio</span>
                </label>`;
    panel.appendChild(drawingGrp);
    return;
  }
  const imgGrp = createGroup("Image");
  // An embedded or uploaded picture is described, not shown as its raw address (a long data: string); the
  // field stays free for pasting a web address to replace it.
  const content = String(data.content || "");
  const embedded = content.match(/^data:image\/([a-z0-9.+-]+)/i);
  const source = embedded
    ? `Embedded picture · ${embedded[1].replace("svg+xml", "svg").toUpperCase()}`
    : /^\/(media|extracted_figures)\//.test(content)
      ? "Uploaded picture"
      : "";
  imgGrp.appendChild(
    createField(
      source ? "Picture" : "URL",
      source
        ? `<div class="prop-image-source"><i class="fa-regular fa-image"></i><span>${escapeHtml(source)}</span></div>
           <input type="text" id="prop-img" class="w-full mt-1" value="" placeholder="Paste an image web address to replace it">`
        : `<input type="text" id="prop-img" class="w-full" value="${escapeHtml(content)}">`,
    ),
  );
  imgGrp.innerHTML += `
                <button onclick="const input=document.getElementById('image-file-upload'); input.dataset.targetImageId='${data.id}'; input.click()" class="w-full mt-2 py-2 rounded bg-slate-900 border border-slate-700 text-xs text-slate-100 hover:bg-slate-800 transition-colors">
                    <i class="fa-solid fa-upload mr-1"></i> Replace Image File
                </button>
                <div class="flex gap-2 mt-2">
                    <div class="flex-1 flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold tracking-wider">Width</label>
                        <input type="number" id="prop-img-w" class="w-full text-xs" value="${parseFloat(data.width) || 0}">
                    </div>
                    <div class="flex-1 flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold tracking-wider">Height</label>
                        <input type="number" id="prop-img-h" class="w-full text-xs" value="${parseFloat(data.height) || 0}">
                    </div>
                </div>
                <label class="flex items-center gap-2 cursor-pointer group/chk mt-3 mb-2">
                    <input type="checkbox" id="prop-img-lock-aspect" ${data.lockAspectRatio ? "checked" : ""} class="aspect-lock-checkbox prop-native-checkbox">
                    <span class="text-xs text-gray-400">Lock Aspect Ratio</span>
                </label>
                <div class="h-px bg-slate-200 my-3"></div>
                <p class="text-[11px] text-gray-500 leading-relaxed">
                    Crop mode lets you drag the image area and trim with the edge handles.
                </p>
                <div class="flex gap-2 mt-2">
                    <button id="prop-crop" class="flex-1 py-2 rounded bg-slate-900 border border-slate-700 text-xs text-slate-100 hover:bg-slate-800 transition-colors" onclick="enterCropMode('${data.id}')"><i class="fa-solid fa-crop-simple mr-1"></i> Crop Image</button>
                    <button id="prop-crop-reset" class="flex-1 py-2 rounded bg-white border border-slate-300 text-xs text-slate-700 hover:bg-slate-50 transition-colors">Reset</button>
                </div>
            `;
  panel.appendChild(imgGrp);
}

function bindImagePanel(data, onCommit) {
  const imageUrl = document.getElementById("prop-img");
  if (imageUrl) {
    const commitImage = async () => {
      const nextUrl = imageUrl.value.trim();
      if (!nextUrl) return;
      let dimensions = null;
      if (typeof _getImageSourceDimensions === "function") {
        try {
          dimensions = await _getImageSourceDimensions(nextUrl);
        } catch (_err) {}
      }
      onCommit(() => {
        const updates = { content: nextUrl };
        if (dimensions?.width && dimensions?.height) {
          const ratio = dimensions.width / Math.max(1, dimensions.height);
          updates.imageAspectRatio = ratio;
          updates.lockAspectRatio = data.lockAspectRatio ?? true;
          if (data.lockAspectRatio !== false) {
            const currentW =
              parseFloat(data.width) ||
              parseFloat(document.getElementById(data.id)?.style.width) ||
              300;
            const nextH = currentW / ratio;
            updates.height = `${nextH}px`;
            updates.heightSetManually = true;
            data.height = updates.height;
          }
          data.imageAspectRatio = ratio;
        }
        updateElementState(data.id, updates);
        const dom = document.getElementById(data.id);
        const img = dom?.querySelector("img");
        if (img) img.src = nextUrl;
        if (dom && updates.height) dom.style.height = updates.height;
      });
    };
    imageUrl.onchange = commitImage;
    imageUrl.onblur = commitImage;
  }

  const imgW = document.getElementById("prop-img-w");
  const imgH = document.getElementById("prop-img-h");
  const imgLock = document.getElementById("prop-img-lock-aspect");

  if (imgLock) {
    imgLock.onchange = (e) => {
      saveStateToUndo();
      const locked = e.target.checked;
      const ratio = data.cropTransform
        ? (parseFloat(data.width) || 1) /
          Math.max(1, parseFloat(data.height) || 1)
        : typeof getImageAspectRatio === "function"
          ? getImageAspectRatio(data)
          : (parseFloat(data.width) || 1) /
            Math.max(1, parseFloat(data.height) || 1);
      updateElementState(data.id, {
        lockAspectRatio: locked,
        imageAspectRatio: ratio,
      });
      data.lockAspectRatio = locked;
      data.imageAspectRatio = ratio;
    };
  }

  if (imgW && imgH) {
    const commitDim = (isWidth) => {
      onCommit(() => {
        let newW = parseFloat(imgW.value);
        let newH = parseFloat(imgH.value);
        if (isNaN(newW) || newW < 10) newW = 10;
        if (isNaN(newH) || newH < 10) newH = 10;

        if (data.lockAspectRatio) {
          const ratio = data.cropTransform
            ? (parseFloat(data.width) || newW) /
              Math.max(1, parseFloat(data.height) || newH)
            : typeof getImageAspectRatio === "function"
              ? getImageAspectRatio(data)
              : (parseFloat(data.width) || newW) /
                Math.max(1, parseFloat(data.height) || newH);
          if (isWidth) {
            newH = newW / ratio;
            imgH.value = Math.round(newH);
          } else {
            newW = newH * ratio;
            imgW.value = Math.round(newW);
          }
        }

        const updates = {
          width: newW + "px",
          height: newH + "px",
          heightSetManually: true,
        };
        if (data.lockAspectRatio)
          updates.imageAspectRatio = data.cropTransform
            ? newW / Math.max(1, newH)
            : typeof getImageAspectRatio === "function"
              ? getImageAspectRatio(data)
              : newW / Math.max(1, newH);
        updateElementState(data.id, updates);
        data.width = newW + "px";
        data.height = newH + "px";
        data.heightSetManually = true;
        if (updates.imageAspectRatio)
          data.imageAspectRatio = updates.imageAspectRatio;
        const dom = document.getElementById(data.id);
        if (dom) {
          dom.style.width = newW + "px";
          dom.style.height = newH + "px";
        }
        updateGroupBound();
      });
    };
    imgW.onchange = () => commitDim(true);
    imgW.onblur = () => commitDim(true);
    imgH.onchange = () => commitDim(false);
    imgH.onblur = () => commitDim(false);
  }

  const cropResetBtn = document.getElementById("prop-crop-reset");
  if (cropResetBtn) {
    cropResetBtn.onclick = () => {
      onCommit(() => {
        delete data.cropTransform;
        updateElementState(data.id, { cropTransform: null });
        if (window.renderSlidesFromState) window.renderSlidesFromState();
        buildPropertiesPanel();
      });
    };
  }
}
