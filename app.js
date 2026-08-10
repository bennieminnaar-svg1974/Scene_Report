/* Scene Capture — fully offline, client-side only. No network calls at
   runtime. State lives in IndexedDB (db.js); fields.js defines the forms. */

const appEl = document.getElementById("app");
let current = null; // in-memory capture object being edited
let signaturePads = {}; // fieldName -> pad instance
let nextPhotoId = 1;

function nowIso() {
  return new Date().toISOString();
}

function blankCapture(reportType) {
  const config = REPORT_CONFIG[reportType];
  const report = {};
  config.sections.forEach((s) => s.fields.forEach((f) => (report[f.name] = "")));
  const caseObj = {};
  CASE_FIELDS.forEach((f) => (caseObj[f.name] = ""));
  const scene = {};
  SCENE_FIELDS.forEach((f) => (scene[f.name] = ""));
  return {
    report_type: reportType,
    company: "BCPS",
    evidence_descr: "",
    case: caseObj,
    scene: scene,
    report: report,
    photos: [],
    status: "draft",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

/* ---------- Image downscale (canvas, before storing in IndexedDB) ---------- */

function downscaleImage(file, maxDim = 1600, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          resolve(blob);
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/* ---------- Rendering ---------- */

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function renderHome() {
  listCaptures().then((captures) => {
    const unexported = captures.filter((c) => c.status === "draft");
    appEl.innerHTML = "";
    appEl.appendChild(el(`
      <div>
        <h1>Scene Capture</h1>
        ${unexported.length ? `
        <div class="warning-banner">
          <strong>${unexported.length} unexported draft${unexported.length > 1 ? "s" : ""}.</strong>
          Export soon after taking photos — don't remove this app's home-screen icon while anything is unexported
          (on iPhone, removing it deletes its data with no way to undo).
        </div>` : ""}
        <div class="button-row">
          <button class="btn" data-action="new" data-type="general_image">+ General Image</button>
          <button class="btn" data-action="new" data-type="mobile">+ Mobile</button>
          <button class="btn" data-action="new" data-type="storage_media">+ Storage Media</button>
        </div>
        <h2>Captures</h2>
        <div id="capture-list"></div>
      </div>
    `));
    const list = document.getElementById("capture-list");
    if (!captures.length) {
      list.appendChild(el(`<p class="hint">No captures yet.</p>`));
    }
    captures.forEach((c) => {
      const label = REPORT_CONFIG[c.report_type].label;
      const item = el(`
        <div class="capture-card">
          <div>
            <strong>${c.evidence_descr || "(no evidence number yet)"}</strong>
            <span class="badge">${label}</span>
            <span class="badge ${c.status === "exported" ? "badge-green" : "badge-amber"}">${c.status}</span>
            <div class="hint">${c.photos.length} photo(s) &middot; updated ${new Date(c.updated_at).toLocaleString()}</div>
          </div>
          <div class="button-row">
            <button class="btn btn-secondary" data-action="edit" data-id="${c.id}">Edit</button>
            <button class="btn btn-secondary" data-action="export" data-id="${c.id}">Export</button>
            <button class="btn btn-danger" data-action="delete" data-id="${c.id}">Delete</button>
          </div>
        </div>
      `);
      list.appendChild(item);
    });
    list.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", onCaptureListAction);
    });
    appEl.querySelectorAll('[data-action="new"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        current = blankCapture(btn.dataset.type);
        renderForm();
      });
    });
    storageEstimate().then((est) => {
      if (est && est.quota) {
        const pct = Math.round((est.usage / est.quota) * 100);
        if (pct > 70) {
          const warn = el(`<p class="warning-banner">Phone storage is ${pct}% used by this app's captures. Export and delete finished ones soon.</p>`);
          appEl.insertBefore(warn, document.getElementById("capture-list"));
        }
      }
    });
  });
}

function onCaptureListAction(e) {
  const id = Number(e.target.dataset.id);
  const action = e.target.dataset.action;
  if (action === "edit") {
    getCapture(id).then((c) => {
      current = c;
      renderForm();
    });
  } else if (action === "export") {
    exportCapture(id);
  } else if (action === "delete") {
    if (confirm("Delete this capture? This cannot be undone.")) {
      deleteCapture(id).then(renderHome);
    }
  }
}

function fieldHtml(f, value) {
  const id = `f_${f.name}`;
  const hint = f.hint ? `<span class="hint">${f.hint}</span>` : "";
  if (f.type === "select") {
    const opts = f.options
      .map((o) => `<option value="${o}" ${o === value ? "selected" : ""}>${o}</option>`)
      .join("");
    return `<div class="field"><label for="${id}">${f.label}</label>${hint}
      <select id="${id}" data-field="${f.name}"><option value=""></option>${opts}</select></div>`;
  }
  if (f.type === "textarea") {
    return `<div class="field field-wide"><label for="${id}">${f.label}</label>${hint}
      <textarea id="${id}" data-field="${f.name}" rows="2">${value || ""}</textarea></div>`;
  }
  if (f.type === "signature") {
    return `<div class="field field-wide signature-field">
      <label>${f.label}</label>
      <canvas id="${id}_canvas" class="signature-canvas" width="600" height="150"></canvas>
      <input type="hidden" id="${id}" data-field="${f.name}" value="${value || ""}">
      <button type="button" class="btn btn-secondary btn-small" data-clear-sig="${f.name}">Clear Signature</button>
    </div>`;
  }
  return `<div class="field"><label for="${id}">${f.label}</label>${hint}
    <input type="${f.type}" id="${id}" data-field="${f.name}" value="${value || ""}"></div>`;
}

function sectionHtml(title, fields, values) {
  return `
  <div>
    <h3 class="section-heading">${title}</h3>
    <div class="form-grid">
      ${fields.map((f) => fieldHtml(f, values[f.name])).join("")}
    </div>
  </div>
  `;
}

function renderForm() {
  const config = REPORT_CONFIG[current.report_type];
  appEl.innerHTML = "";
  const wrap = el(`<div></div>`);
  wrap.appendChild(el(`<h1>${config.label} Capture</h1>`));
  wrap.appendChild(el(`
    <div class="form-grid">
      <div class="field">
        <label for="f_company">Company</label>
        <select id="f_company" data-toplevel="company">
          ${COMPANY_OPTIONS.map((o) => `<option value="${o}" ${o === current.company ? "selected" : ""}>${o}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="f_evidence_descr">Evidence Number</label>
        <span class="hint">${config.evidenceHint}</span>
        <input type="text" id="f_evidence_descr" data-toplevel="evidence_descr" value="${current.evidence_descr || ""}">
      </div>
    </div>
  `));
  wrap.appendChild(el(sectionHtml("Case Information", CASE_FIELDS, current.case)));
  wrap.appendChild(el(sectionHtml("Premises / Scene Details", SCENE_FIELDS, current.scene)));
  config.sections.forEach((s) => {
    wrap.appendChild(el(sectionHtml(s.title, s.fields, current.report)));
  });

  // Photos section
  const photoSection = el(`
    <div>
      <h3 class="section-heading">Photographs</h3>
      <div class="photo-thumbs" id="photo-thumbs"></div>
      <input type="file" id="photo-input" accept="image/*" capture="environment" multiple>
      <p class="hint">Photos are automatically resized to keep the export file a manageable size.</p>
    </div>
  `);
  wrap.appendChild(photoSection);

  const actions = el(`
    <div class="button-row sticky-actions">
      <button class="btn" id="save-btn">Save Draft</button>
      <button class="btn btn-secondary" id="export-btn">Save &amp; Export</button>
      <button class="btn btn-secondary" id="back-btn">Back</button>
    </div>
  `);
  wrap.appendChild(actions);
  appEl.appendChild(wrap);

  renderPhotoThumbs();

  document.getElementById("photo-input").addEventListener("change", onPhotoSelected);
  appEl.querySelectorAll("[data-clear-sig]").forEach((btn) => {
    btn.addEventListener("click", () => signaturePads[btn.dataset.clearSig]?.clear());
  });
  document.getElementById("save-btn").addEventListener("click", () => saveForm(false));
  document.getElementById("export-btn").addEventListener("click", () => saveForm(true));
  document.getElementById("back-btn").addEventListener("click", () => {
    if (confirm("Discard unsaved changes and go back?")) renderHome();
  });

  // Initialize signature pads after canvases exist in the DOM
  VERIFICATION_FIELDS.filter((f) => f.type === "signature").forEach((f) => {
    signaturePads[f.name] = initSignaturePad(`f_${f.name}_canvas`, `f_${f.name}`, current.report[f.name] || "");
  });
}

function renderPhotoThumbs() {
  const container = document.getElementById("photo-thumbs");
  container.innerHTML = "";
  if (!current.photos.length) {
    container.appendChild(el(`<p class="hint">No photographs yet.</p>`));
  }
  current.photos.forEach((p) => {
    const url = URL.createObjectURL(p.blob);
    const thumb = el(`
      <div class="photo-thumb">
        <img src="${url}" alt="${p.caption}">
        <div class="photo-caption">${p.caption}</div>
        <button type="button" class="btn btn-danger btn-small" data-remove-photo="${p.id}">Remove</button>
      </div>
    `);
    container.appendChild(thumb);
  });
  container.querySelectorAll("[data-remove-photo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.removePhoto);
      current.photos = current.photos.filter((p) => p.id !== id);
      renderPhotoThumbs();
    });
  });
}

async function onPhotoSelected(e) {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    const blob = await downscaleImage(file);
    current.photos.push({ id: nextPhotoId++, blob, caption: file.name, filename: file.name });
  }
  e.target.value = "";
  renderPhotoThumbs();
}

function collectFormIntoCurrent() {
  appEl.querySelectorAll("[data-toplevel]").forEach((inp) => {
    current[inp.dataset.toplevel] = inp.value.trim();
  });
  appEl.querySelectorAll("[data-field]").forEach((inp) => {
    const name = inp.dataset.field;
    const value = inp.type === "hidden" ? inp.value : inp.value.trim();
    if (name in current.case) current.case[name] = value;
    else if (name in current.scene) current.scene[name] = value;
    else current.report[name] = value;
  });
}

async function saveForm(thenExport) {
  collectFormIntoCurrent();
  if (!current.evidence_descr) {
    alert("Evidence Number is required before saving.");
    return;
  }
  current.updated_at = nowIso();
  const id = await saveCapture(current);
  current.id = id;
  if (thenExport) {
    await exportCapture(id);
  } else {
    alert("Draft saved.");
    renderHome();
  }
}

/* ---------- Export ---------- */

async function exportCapture(id) {
  const capture = current && current.id === id ? current : await getCapture(id);
  const photos = [];
  for (const p of capture.photos) {
    photos.push({
      filename: p.filename,
      caption: p.caption,
      data_base64: await blobToBase64(p.blob),
    });
  }
  const bundle = [{
    schema_version: 1,
    report_type: capture.report_type,
    company: capture.company,
    evidence_descr: capture.evidence_descr,
    case: capture.case,
    scene: capture.scene,
    report: capture.report,
    photos: photos,
    captured_at: capture.created_at,
    exported_at: nowIso(),
  }];

  const blob = new Blob([JSON.stringify(bundle)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeName = (capture.evidence_descr || "capture").replace(/[^A-Za-z0-9_-]/g, "_");
  a.href = url;
  a.download = `${safeName}_export.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  capture.status = "exported";
  capture.exported_at = nowIso();
  capture.updated_at = nowIso();
  await saveCapture(capture);
  renderHome();
}

/* ---------- Boot ---------- */

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW registration failed", err));
  });
}

renderHome();
