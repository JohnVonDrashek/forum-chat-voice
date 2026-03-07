/**
 * Gothic image crop modal.
 */

export function showCropModal(imageSrc) {
  return new Promise((resolve) => {
    let crop = { x: 0, y: 0 }
    let zoom = 1
    let dragging = false
    let dragStart = { x: 0, y: 0 }
    let img = null
    let containerSize = 288

    const overlay = document.createElement('div')
    overlay.className = 'crop-overlay'
    overlay.innerHTML = `
      <div class="crop-dialog">
        <h3>~ Crop Avatar ~</h3>
        <div class="crop-area" id="crop-area">
          <img id="crop-img" src="${imageSrc}" style="position:absolute;user-select:none;pointer-events:none" draggable="false" />
        </div>
        <div class="crop-zoom">
          <span>Zoom</span>
          <input type="range" id="crop-zoom" min="1" max="3" step="0.05" value="1" />
        </div>
        <div class="crop-actions">
          <button id="crop-cancel" class="btn btn-small">Cancel</button>
          <button id="crop-save" class="btn btn-primary btn-small">Save</button>
        </div>
      </div>
    `

    document.body.appendChild(overlay)

    const cropArea = overlay.querySelector('#crop-area')
    const cropImg = overlay.querySelector('#crop-img')
    const zoomInput = overlay.querySelector('#crop-zoom')

    img = new Image()
    img.onload = () => updateImageTransform()
    img.src = imageSrc

    function updateImageTransform() {
      if (!img.naturalWidth) return
      const aspect = img.naturalWidth / img.naturalHeight
      let w, h
      if (aspect >= 1) { h = containerSize * zoom; w = h * aspect }
      else { w = containerSize * zoom; h = w / aspect }

      const maxX = 0, minX = containerSize - w
      const maxY = 0, minY = containerSize - h
      crop.x = Math.min(maxX, Math.max(minX, crop.x))
      crop.y = Math.min(maxY, Math.max(minY, crop.y))

      cropImg.style.width = w + 'px'
      cropImg.style.height = h + 'px'
      cropImg.style.left = crop.x + 'px'
      cropImg.style.top = crop.y + 'px'
    }

    cropArea.addEventListener('mousedown', (e) => {
      dragging = true
      dragStart = { x: e.clientX - crop.x, y: e.clientY - crop.y }
      cropArea.style.cursor = 'grabbing'
    })
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)

    cropArea.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        dragging = true
        dragStart = { x: e.touches[0].clientX - crop.x, y: e.touches[0].clientY - crop.y }
      }
    })
    cropArea.addEventListener('touchmove', (e) => {
      if (dragging && e.touches.length === 1) {
        e.preventDefault()
        crop.x = e.touches[0].clientX - dragStart.x
        crop.y = e.touches[0].clientY - dragStart.y
        updateImageTransform()
      }
    }, { passive: false })
    cropArea.addEventListener('touchend', () => { dragging = false })

    function onMouseMove(e) {
      if (!dragging) return
      crop.x = e.clientX - dragStart.x
      crop.y = e.clientY - dragStart.y
      updateImageTransform()
    }

    function onMouseUp() {
      dragging = false
      cropArea.style.cursor = 'grab'
    }

    zoomInput.addEventListener('input', () => {
      const oldZoom = zoom
      zoom = parseFloat(zoomInput.value)
      const cx = containerSize / 2, cy = containerSize / 2
      crop.x = cx - (cx - crop.x) * (zoom / oldZoom)
      crop.y = cy - (cy - crop.y) * (zoom / oldZoom)
      updateImageTransform()
    })

    function cleanup() {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keydown', onKeyDown)
      overlay.remove()
    }

    overlay.querySelector('#crop-cancel').addEventListener('click', () => { cleanup(); resolve(null) })
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { cleanup(); resolve(null) } })

    function onKeyDown(e) { if (e.key === 'Escape') { cleanup(); resolve(null) } }
    document.addEventListener('keydown', onKeyDown)

    overlay.querySelector('#crop-save').addEventListener('click', () => {
      if (!img.naturalWidth) return
      const aspect = img.naturalWidth / img.naturalHeight
      let displayW, displayH
      if (aspect >= 1) { displayH = containerSize * zoom; displayW = displayH * aspect }
      else { displayW = containerSize * zoom; displayH = displayW / aspect }

      const scaleX = img.naturalWidth / displayW
      const scaleY = img.naturalHeight / displayH
      const sx = -crop.x * scaleX, sy = -crop.y * scaleY
      const sw = containerSize * scaleX, sh = containerSize * scaleY

      const canvas = document.createElement('canvas')
      canvas.width = 256; canvas.height = 256
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 256, 256)
      canvas.toBlob((blob) => { cleanup(); resolve(blob) }, 'image/png')
    })
  })
}
