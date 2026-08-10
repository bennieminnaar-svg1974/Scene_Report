function initSignaturePad(canvasId, hiddenInputId, existingDataUri) {
  const canvas = document.getElementById(canvasId);
  const hiddenInput = document.getElementById(hiddenInputId);
  const ctx = canvas.getContext("2d");
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#000";

  let drawing = false;
  let lastX = 0;
  let lastY = 0;
  let hasStroke = false;

  function pos(evt) {
    const rect = canvas.getBoundingClientRect();
    const t = evt.touches && evt.touches.length ? evt.touches[0] : evt;
    return [
      ((t.clientX - rect.left) / rect.width) * canvas.width,
      ((t.clientY - rect.top) / rect.height) * canvas.height,
    ];
  }

  function start(evt) {
    drawing = true;
    [lastX, lastY] = pos(evt);
    evt.preventDefault();
  }

  function move(evt) {
    if (!drawing) return;
    const [x, y] = pos(evt);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    [lastX, lastY] = [x, y];
    hasStroke = true;
    save();
    evt.preventDefault();
  }

  function end(evt) {
    drawing = false;
    if (evt) evt.preventDefault();
  }

  function save() {
    if (hiddenInput) hiddenInput.value = canvas.toDataURL("image/png");
  }

  function clear() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStroke = false;
    if (hiddenInput) hiddenInput.value = "";
  }

  canvas.addEventListener("mousedown", start);
  canvas.addEventListener("mousemove", move);
  window.addEventListener("mouseup", end);
  canvas.addEventListener("touchstart", start, { passive: false });
  canvas.addEventListener("touchmove", move, { passive: false });
  canvas.addEventListener("touchend", end, { passive: false });

  if (existingDataUri) {
    const img = new Image();
    img.onload = function () {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      hasStroke = true;
    };
    img.src = existingDataUri;
  }

  return { clear, isEmpty: () => !hasStroke };
}
