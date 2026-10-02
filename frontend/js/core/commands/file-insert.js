// Commands: inserting files (images, video, PDF, HTML, molecules) and uploading assets.

async function optimizeImageToWebP(file, maxWidth = 3840, maxHeight = 2160, quality = 0.9) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            let width = img.width;
            let height = img.height;
            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = width * ratio;
                height = height * ratio;
            }
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);
            resolve({
                dataUrl: canvas.toDataURL("image/webp", quality),
                origWidth: img.width,
                origHeight: img.height,
            });
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Image conversion failed"));
        };
        img.src = url;
    });
}

async function handleImageFileInsert(event) {
    const file = event.target.files?.[0];
    const targetImageId = event.target.dataset?.targetImageId || "";
    if (event.target.dataset) delete event.target.dataset.targetImageId;
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
        setProjectSaveHint?.("Please choose a valid image file", "danger");
        return;
    }

    try {
        const { dataUrl, origWidth, origHeight } = await optimizeImageToWebP(file);
        const activeIndex = ensureActiveSlideSync();
        const slide = state.slides[activeIndex];
        const existingImage = targetImageId
            ? slide?.elements?.find(el => el.id === targetImageId && el.type === "image")
            : null;
        saveStateToUndo();
        const id = existingImage?.id || generateId("el");
        const placement = _getImageInsertPlacement(origWidth, origHeight, { center: true });
        const imageAspectRatio = placement.ratio;
        const width = existingImage ? parseFloat(existingImage.width) || placement.width : placement.width;
        const height = existingImage
            ? existingImage.lockAspectRatio !== false
                ? Math.round(width / imageAspectRatio)
                : parseFloat(existingImage.height) || placement.height
            : placement.height;
        const nextImageData = {
            id,
            type: "image",
            x: existingImage?.x ?? placement.x,
            y: existingImage?.y ?? placement.y,
            width: `${Math.round(width)}px`,
            height: `${Math.round(height)}px`,
            lockAspectRatio: existingImage?.lockAspectRatio ?? true,
            imageAspectRatio,
            content: dataUrl,
            styles: {
                ...(existingImage?.styles || {}),
                zIndex: existingImage?.styles?.zIndex ?? getNextZIndex(),
                borderRadius: existingImage?.styles?.borderRadius ?? "8px",
            },
            ...(existingImage ? { heightSetManually: true } : {}),
        };
        if (existingImage) {
            Object.assign(existingImage, nextImageData);
        } else {
            state.slides[activeIndex].elements.push(placeInContentPlaceholder(state.slides[activeIndex], nextImageData));
        }
        renderSlidesFromState();
        selectElement(id);
    } catch (err) {
        console.error("Image insert error:", err);
        setProjectSaveHint?.("Failed to process image", "danger");
    }
}

function handleVideoFileInsert(event) {
    const file = event.target.files?.[0];
    const targetVideoId = event.target.dataset?.targetVideoId || "";
    if (event.target.dataset) delete event.target.dataset.targetVideoId;
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("video/")) {
        setProjectSaveHint?.("Please choose a valid video file", "danger");
        return;
    }

    _insertUploadedVideo(file, { targetId: targetVideoId }).catch(err => {
        console.error("Video insert error:", err);
        setProjectSaveHint?.(err?.message || "Failed to process video", "danger");
    });
}

async function handlePdfFileInsert(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (
        file.type !== "application/pdf" &&
        !String(file.name || "")
            .toLowerCase()
            .endsWith(".pdf")
    ) {
        setProjectSaveHint?.("Please choose a valid PDF file", "danger");
        return;
    }

    if (typeof setProjectSaveHint === "function") {
        setProjectSaveHint("Uploading PDF…", "warn");
    }

    let content;
    try {
        const upload = await _uploadAssetFile(file);
        content = upload.url;
    } catch (err) {
        if (!_isSessionOnlyAssetFallbackError(err)) throw err;
        content = _createSessionObjectUrl(file);
        if (typeof setProjectSaveHint === "function") {
            setProjectSaveHint("PDF stored for this session only", "warn");
        }
    }

    const activeIndex = ensureActiveSlideSync();
    saveStateToUndo();
    const id = generateId("el");
    state.slides[activeIndex].elements.push(placeInContentPlaceholder(state.slides[activeIndex], {
        id,
        type: "pdf",
        x: 100,
        y: 100,
        // Large enough to read a page; it is scaled down to the slide's content area when placed.
        width: "820px",
        height: "540px",
        content,
        pdfInteractive: true,
        pdfEditorMode: "navigate",
        pdfAnnotations: [],
        pdfSelectedAnnotationId: "",
        localMimeType: "application/pdf",
        styles: { zIndex: getNextZIndex(), borderRadius: "8px", backgroundColor: "#ffffff" },
    }));
    renderSlidesFromState();
    selectElement(id);
    schedulePresentationAutosave?.(150);
}

async function _uploadAssetFile(file, { presentationId = currentPresentationId } = {}) {
    if (typeof isBackendApiAvailable === "function" && !isBackendApiAvailable()) {
        throw new Error("Backend API unavailable");
    }
    const formData = new FormData();
    formData.append("file", file, file.name || "asset");
    if (presentationId) formData.append("presentationId", presentationId);

    const response = await _apiFetch("/api/assets/upload/", {
        method: "POST",
        body: formData,
    });

    let payload = {};
    try {
        payload = await response.json();
    } catch (_err) {}

    if (!response.ok) {
        throw new Error(payload.error || `Upload failed (${response.status})`);
    }
    return payload;
}

const _sessionObjectUrls = new Set();

function _isSessionOnlyAssetFallbackError(err) {
    const message = err?.message || "";
    return (
        message === "Backend API unavailable" ||
        message === "Authentication required" ||
        /401|403|404|NetworkError|Network error|Failed to fetch|fetch resource/i.test(message)
    );
}

function _createSessionObjectUrl(file) {
    const url = URL.createObjectURL(file);
    _sessionObjectUrls.add(url);
    return url;
}

function _uploadAssetFileWithProgress(file, onProgress, { presentationId = currentPresentationId } = {}) {
    return new Promise((resolve, reject) => {
        if (typeof isBackendApiAvailable === "function" && !isBackendApiAvailable()) {
            reject(new Error("Backend API unavailable"));
            return;
        }

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/assets/upload/");

        const csrfToken = document.cookie.match(/csrftoken=([^;]+)/)?.[1];
        if (csrfToken) {
            xhr.setRequestHeader("X-CSRFToken", csrfToken);
        }

        xhr.upload.onprogress = e => {
            if (e.lengthComputable) {
                const percent = (e.loaded / e.total) * 100;
                onProgress(percent);
            }
        };

        xhr.onload = () => {
            let payload = {};
            try {
                payload = JSON.parse(xhr.responseText);
            } catch (_err) {}

            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(payload);
            } else {
                reject(new Error(payload.error || `Upload failed (${xhr.status})`));
            }
        };

        xhr.onerror = () => reject(new Error("Network error"));

        const formData = new FormData();
        formData.append("file", file, file.name || "asset");
        if (presentationId) {
            formData.append("presentationId", presentationId);
        }
        xhr.send(formData);
    });
}

async function _insertUploadedVideo(file, { targetId = "" } = {}) {
    const activeIndex = ensureActiveSlideSync();
    const slide = state.slides[activeIndex];
    if (!slide) return;
    const existingVideo = targetId ? slide.elements.find(el => el.id === targetId && el.type === "video") : null;
    saveStateToUndo();
    const id = existingVideo?.id || generateId("el");

    const nextVideoData = {
        id,
        type: "video",
        x: existingVideo?.x ?? 100,
        y: existingVideo?.y ?? 100,
        width: existingVideo?.width ?? "480px",
        height: existingVideo?.height ?? "270px",
        content: "",
        videoType: "local",
        localMimeType: file.type || "video/mp4",
        muted: existingVideo?.muted ?? true,
        autoplay: existingVideo?.autoplay ?? false,
        loop: existingVideo?.loop ?? false,
        uploading: true,
        uploadProgress: 0,
        styles: {
            ...(existingVideo?.styles || {}),
            zIndex: existingVideo?.styles?.zIndex ?? getNextZIndex(),
            borderRadius: existingVideo?.styles?.borderRadius ?? "8px",
        },
        animation: existingVideo?.animation ?? null,
    };
    if (existingVideo) {
        Object.assign(existingVideo, nextVideoData);
    } else {
        slide.elements.push(placeInContentPlaceholder(slide, nextVideoData));
    }

    renderSlidesFromState();
    selectElement(id);

    if (typeof setProjectSaveHint === "function") {
        setProjectSaveHint("Uploading video to media...", "warn");
    }

    _uploadAssetFileWithProgress(file, progress => {
        const slide = state.slides[activeIndex];
        if (!slide) return;
        const elData = slide.elements.find(e => e.id === id);
        if (elData) {
            elData.uploadProgress = progress;
            const badge = document.querySelector(`#${id} .upload-progress-badge`);
            const bar = document.querySelector(`#${id} .upload-progress-bar`);
            if (badge) badge.textContent = `Uploading... ${Math.round(progress)}%`;
            if (bar) bar.style.width = `${progress}%`;
        }
    })
        .then(upload => {
            const slide = state.slides[activeIndex];
            if (!slide) return;
            const elData = slide.elements.find(e => e.id === id);
            if (elData) {
                elData.content = upload.url;
                elData.localMimeType = upload.contentType || elData.localMimeType;
                elData.videoType = "local";
                delete elData.uploading;
                delete elData.uploadProgress;
                renderSlidesFromState();
                selectElement(id);
                schedulePresentationAutosave?.(150);
                if (typeof setProjectSaveHint === "function") {
                    setProjectSaveHint("Video uploaded successfully", "success");
                }
            }
        })
        .catch(err => {
            console.error("Video background upload failed:", err);
            const slide = state.slides[activeIndex];
            if (!slide) return;
            const elData = slide.elements.find(e => e.id === id);
            if (elData) {
                delete elData.uploading;
                delete elData.uploadProgress;
                if (_isSessionOnlyAssetFallbackError(err)) {
                    elData.content = _createSessionObjectUrl(file);
                    elData.videoType = "local";
                    elData.localMimeType = file.type || "video/mp4";
                }
                renderSlidesFromState();
                selectElement(id);
                schedulePresentationAutosave?.(150);
            }
            if (typeof setProjectSaveHint === "function") {
                const isTooLarge =
                    err?.message?.toLowerCase().includes("too large") ||
                    String(err).toLowerCase().includes("too large");
                if (_isSessionOnlyAssetFallbackError(err)) {
                    setProjectSaveHint("Video stored for this session only", "warn");
                } else {
                    setProjectSaveHint(
                        isTooLarge ? "Video exceeds maximum size (500MB)" : "Video upload failed",
                        "error",
                    );
                }
            }
        });
}

function _dataUrlToFile(dataUrl, filename = "video.mp4") {
    const parts = String(dataUrl || "").split(",", 2);
    if (parts.length < 2) throw new Error("Invalid data URL");
    const mime = parts[0].match(/^data:([^;]+);base64$/)?.[1] || "application/octet-stream";
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], filename, { type: mime });
}

async function migrateInlineVideoAssets() {
    if (typeof isBackendApiAvailable === "function" && !isBackendApiAvailable()) return false;
    if (window.__inlineVideoMigrationPromise) return window.__inlineVideoMigrationPromise;

    window.__inlineVideoMigrationPromise = (async () => {
        const candidates = [];
        (state.slides || []).forEach((slide, slideIndex) => {
            (slide.elements || []).forEach((el, elementIndex) => {
                if (el?.type === "video" && typeof el.content === "string" && el.content.startsWith("data:video/")) {
                    candidates.push({ slideIndex, elementIndex, el });
                }
            });
        });

        if (!candidates.length) return false;

        if (typeof setProjectSaveHint === "function") {
            setProjectSaveHint("Optimizing local videos…", "warn");
        }

        let changed = false;
        for (const candidate of candidates) {
            const filename = `${candidate.el.id || "video"}${candidate.el.content.includes("data:video/webm") ? ".webm" : ".mp4"}`;
            const file = _dataUrlToFile(candidate.el.content, filename);
            const upload = await _uploadAssetFile(file);
            const target = state.slides[candidate.slideIndex]?.elements?.[candidate.elementIndex];
            if (!target) continue;
            target.content = upload.url;
            target.videoType = "local";
            changed = true;
        }

        if (changed) {
            renderSlidesFromState?.();
            schedulePresentationAutosave?.(150);
            if (typeof setProjectSaveHint === "function") {
                setProjectSaveHint("Local videos optimized", "success");
            }
        }
        return changed;
    })();

    try {
        return await window.__inlineVideoMigrationPromise;
    } finally {
        window.__inlineVideoMigrationPromise = null;
    }
}

function handleHtmlFileInsert(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = ev => {
        const htmlContent = String(ev.target.result || "");
        const activeIndex = ensureActiveSlideSync();
        saveStateToUndo();
        const id = generateId("el");
        state.slides[activeIndex].elements.push(placeWhereFree(state.slides[activeIndex], {
            id,
            type: "html",
            htmlInteractive: true,
            htmlMode: "responsive",
            x: 120,
            y: 120,
            width: "520px",
            height: "320px",
            content: htmlContent,
            styles: {
                zIndex: getNextZIndex(),
                borderRadius: "8px",
                backgroundColor: "#111827",
                border: "1px solid #334155",
            },
        }));
        renderSlidesFromState();
        selectElement(id);
    };
    reader.readAsText(file);
}

async function _readMoleculeFileText(file) {
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = ev => resolve(String(ev.target.result || ""));
        reader.onerror = () => reject(reader.error || new Error("Could not read molecule file"));
        reader.readAsText(file);
    });
}

async function _detectMoleculeFileTrajectory(file) {
    if (!file || typeof file.stream !== "function") return false;
    const decoder = new TextDecoder();
    const reader = file.stream().getReader();
    let buffered = "";
    let modelCount = 0;
    let endCount = 0;
    let atomOneCount = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            buffered += decoder.decode(value || new Uint8Array(), { stream: !done });
            const lines = buffered.split(/\r?\n/);
            buffered = done ? "" : lines.pop() || "";
            for (const line of lines) {
                if (/^MODEL\b/.test(line)) {
                    modelCount += 1;
                    if (modelCount > 1) return true;
                } else if (/^ENDMDL\b/.test(line) && modelCount > 0) {
                    return true;
                } else if (/^END\s*$/.test(line)) {
                    endCount += 1;
                    if (endCount > 1 && atomOneCount > 1) return true;
                } else if (/^ATOM\s+1\b/.test(line)) {
                    atomOneCount += 1;
                    if (endCount > 0 && atomOneCount > 1) return true;
                }
            }
            if (done) break;
        }
    } finally {
        reader.releaseLock?.();
    }
    return false;
}

function _upsertMoleculeElement(moleculeData) {
    const activeIndex = ensureActiveSlideSync();
    saveStateToUndo();
    const selectedMoleculeId = state.selectedIds?.find(selectedId =>
        state.slides[activeIndex].elements.some(el => el.id === selectedId && el.type === "molecule"),
    );
    let targetMoleculeId = selectedMoleculeId;
    if (selectedMoleculeId) {
        const target = state.slides[activeIndex].elements.find(el => el.id === selectedMoleculeId);
        Object.assign(target, moleculeData);
    } else {
        const id = generateId("el");
        targetMoleculeId = id;
        state.slides[activeIndex].elements.push(placeInContentPlaceholder(state.slides[activeIndex], {
            id,
            type: "molecule",
            ...moleculeData,
            x: 100,
            y: 90,
            width: "620px",
            height: "420px",
            styles: {
                zIndex: getNextZIndex(),
                borderRadius: "8px",
                backgroundColor: "#020617",
                border: "1px solid #334155",
            },
        }));
    }
    renderSlidesFromState();
    if (targetMoleculeId) selectElement(targetMoleculeId);
    return Boolean(selectedMoleculeId);
}

const MOLECULE_TRAJECTORY_FORMATS = new Set(["xtc", "trr", "dcd", "nc", "ncdf"]);

// A binary trajectory (.xtc, .trr, .dcd, .nc) for the selected molecule: its frames are played over that
// structure, which must have the same atoms in the same order.
async function handleMoleculeTrajectoryInsert(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const slide = state.slides[ensureActiveSlideSync()];
    const target = slide.elements.find(el => el.type === "molecule" && state.selectedIds?.includes(el.id));
    if (!target) {
        setProjectSaveHint?.("Select a molecule first, then add its trajectory", "warn");
        return;
    }
    const ext = String(file.name || "").split(".").pop().toLowerCase();
    if (!MOLECULE_TRAJECTORY_FORMATS.has(ext)) {
        setProjectSaveHint?.("Choose a trajectory file: XTC, TRR, DCD or NetCDF (.nc)", "danger");
        return;
    }
    try {
        setProjectSaveHint?.("Adding trajectory…", "warn");
        let url = "";
        try {
            url = (await _uploadAssetFile(file)).url;
        } catch (err) {
            if (!_isSessionOnlyAssetFallbackError(err)) throw err;
            url = _createSessionObjectUrl(file);
        }
        saveStateToUndo();
        target.moleculeTrajectory = { url, format: ext === "ncdf" ? "nc" : ext, name: file.name };
        target.moleculeIsTrajectory = true;
        renderSlidesFromState();
        selectElement(target.id);
        schedulePresentationAutosave?.(150);
        setProjectSaveHint?.(`Trajectory ${file.name} added`, "success");
    } catch (err) {
        console.error(err);
        setProjectSaveHint?.(err?.message || "Could not add the trajectory", "danger");
    }
}

function removeMoleculeTrajectory(elementId) {
    const el = state.slides[currentSlideIndex]?.elements.find(item => item.id === elementId);
    if (!el?.moleculeTrajectory) return;
    saveStateToUndo();
    delete el.moleculeTrajectory;
    el.moleculeIsTrajectory = typeof isMoleculeTrajectoryData === "function" ? isMoleculeTrajectoryData(el.content) : false;
    renderSlidesFromState();
    selectElement(el.id);
    schedulePresentationAutosave?.(150);
}

async function handleMoleculeFileInsert(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const inlineMaxBytes =
        typeof MOLECULE_INLINE_CONTENT_LIMIT === "number" ? MOLECULE_INLINE_CONTENT_LIMIT : 2 * 1024 * 1024;
    const largeMaxBytes =
        typeof MOLECULE_LARGE_CONTENT_LIMIT === "number" ? MOLECULE_LARGE_CONTENT_LIMIT : 64 * 1024 * 1024;
    const rawExt = String(file.name || "")
        .split(".")
        .pop()
        .toLowerCase();
    const allowedFormats =
        typeof MOLECULE_SUPPORTED_FORMATS !== "undefined"
            ? MOLECULE_SUPPORTED_FORMATS
            : new Set(["pdb", "ent", "gro", "mol2", "xyz", "sdf", "cif", "mmcif"]);
    if (!allowedFormats.has(rawExt)) {
        setProjectSaveHint?.(
            "Choose a supported molecule file: PDB, ENT, GRO, MOL2, XYZ, SDF, CIF, or mmCIF",
            "danger",
        );
        return;
    }
    if (file.size > largeMaxBytes) {
        setProjectSaveHint?.("Molecule file is too large. Limit: 64 MB.", "danger");
        return;
    }

    try {
        if (file.size > inlineMaxBytes) setProjectSaveHint?.("Preparing large molecule asset...", "warn");
        const ext = rawExt || "pdb";
        let data = "";
        let sourceUrl = "";
        let isTrajectory = false;
        if (file.size <= inlineMaxBytes) {
            data = await _readMoleculeFileText(file);
            isTrajectory =
                typeof isMoleculeTrajectoryData === "function"
                    ? isMoleculeTrajectoryData(data)
                    : /^MODEL\b/m.test(data) && /^ENDMDL\b/m.test(data);
        } else {
            isTrajectory = await _detectMoleculeFileTrajectory(file);
            try {
                const upload = await _uploadAssetFile(file);
                sourceUrl = upload.url;
            } catch (err) {
                if (!_isSessionOnlyAssetFallbackError(err)) throw err;
                sourceUrl = _createSessionObjectUrl(file);
                setProjectSaveHint?.("Large molecule stored for this session only", "warn");
            }
        }
        const moleculeData =
            typeof createMoleculeElementData === "function"
                ? createMoleculeElementData({
                      data,
                      name: file.name,
                      format: ext,
                      isTrajectory,
                      sourceUrl,
                  })
                : {
                      content: sourceUrl || data,
                      moleculeName: file.name,
                      moleculeFormat: ext,
                      moleculeIsTrajectory: isTrajectory,
                      moleculeSourceType: sourceUrl ? "url" : "inline",
                  };
        const replaced = _upsertMoleculeElement(moleculeData);
        setProjectSaveHint?.(
            `${moleculeData.moleculeIsTrajectory ? "Trajectory" : "PDB structure"} ${replaced ? "replaced" : "added"}`,
            "success",
        );
    } catch (err) {
        console.error(err);
        setProjectSaveHint?.(err?.message || "Could not import molecule file", "danger");
    }
}
