"use strict";

const element = (id) => document.getElementById(id);
const sides = element("sides");
const form = element("plan-form");
const number = (value, digits = 0) => value.toLocaleString("de-DE", {maximumFractionDigits: digits});
const defaults = { fields: {}, sides: [{shape: "board", width: "70", height: "25"}] };
const fieldIds = ["diameter", "middle", "length", "kerf", "reserve", "main-width", "main-height", "priority", "size-mode", "shrinkage"];
let lastPlan = null;
let pendingWorker = null;
let applyingUpdate = false;

function addSide(data = {})
{
    const row = element("side-template").content.firstElementChild.cloneNode(true);
    const shape = row.querySelector(".shape");
    shape.value = data.shape === "fixed" ? "fixed" : "board";
    row.querySelector(".width").value = data.width ?? "70";
    row.querySelector(".height").value = data.height ?? "25";
    function updateLabel()
    {
        row.querySelector(".width-label").textContent = shape.value === "board" ? "Mindestbreite" : "Breite";
    }
    shape.addEventListener("change", updateLabel);
    row.querySelector(".remove").addEventListener("click", () =>
    {
        row.remove();
        element("add").disabled = false;
        invalidate();
        element("add").focus();
    });
    updateLabel();
    sides.append(row);
    element("add").disabled = sides.children.length >= 12;
    return shape;
}

function readState()
{
    return {
        fields: Object.fromEntries(fieldIds.map((id) => [id, element(id).value])),
        sides: Array.from(sides.children, (row) => ({
            shape: row.querySelector(".shape").value,
            width: row.querySelector(".width").value,
            height: row.querySelector(".height").value
        }))
    };
}

function storeState()
{
    try
    {
        localStorage.setItem("saegwerk.inputs.v1", JSON.stringify(readState()));
    }
    catch
    {
        // Planning remains available when local storage is disabled.
    }
}

function invalidate()
{
    element("result").hidden = true;
    element("form-status").hidden = true;
    lastPlan = null;
    storeState();
}

function measure(raw, label, min, max, scale = 1)
{
    const normalized = raw.trim().replace(",", ".");
    const value = Number(normalized);
    const converted = Math.round(value * scale);
    if (!/^\d+(?:\.\d+)?$/.test(normalized) || value < min || value > max ||
        Math.abs(value * scale - converted) > 1e-7)
    {
        throw new Error(label + " muss zwischen " + number(min, 3) + " und " + number(max, 3) +
            " liegen. " + (scale === 1 ? "Bitte ganze Millimeter eingeben." :
                scale === 10 ? "Bitte höchstens eine Nachkommastelle eingeben." : "Bitte höchstens drei Nachkommastellen eingeben."));
    }
    return converted;
}

function settings()
{
    const {fields, sides: sideInputs} = readState();
    const diameter = measure(fields.diameter, "Der Zopfdurchmesser", 2, 150, 10);
    const middle = measure(fields.middle, "Der Mitteldurchmesser", 2, 150, 10);
    const length = measure(fields.length, "Die Stammlänge", 0.1, 30, 1000) / 1000;
    const kerf = measure(fields.kerf, "Die Schnittfuge", 0, 20);
    const reserve = measure(fields.reserve, "Die Randzugabe", 0, 100);
    const dryMode = fields["size-mode"] === "dry";
    if (dryMode)
    {
        element("shrinkage").closest("details").open = true;
    }
    const shrinkage = dryMode ? measure(fields.shrinkage, "Der Trocknungsschwund", 0, 30, 10) : 0;
    const remaining = 1000 - shrinkage;
    if (middle < diameter)
    {
        throw new Error("Der Mitteldurchmesser muss mindestens so groß wie der Zopfdurchmesser sein.");
    }
    if (diameter - 2 * reserve < 10)
    {
        element("reserve").closest("details").open = true;
        throw new Error("Die Randzugabe lässt weniger als 10 mm nutzbaren Zopfdurchmesser übrig.");
    }
    const dimension = (raw, label) => measure(raw, label, 10, 1500);
    const products = [{
        width: dimension(fields["main-width"], "Die Breite des Hauptprodukts"),
        height: dimension(fields["main-height"], "Die Stärke des Hauptprodukts"),
        flexible: false
    }];
    for (const [index, product] of sideInputs.entries())
    {
        products.push({
            width: dimension(product.width, "Die Breite von Nebenprodukt " + (index + 1)),
            height: dimension(product.height, "Die Stärke von Nebenprodukt " + (index + 1)),
            flexible: product.shape === "board"
        });
    }
    const cutProducts = products.map((product) => ({
        ...product,
        width: Math.ceil(product.width * 1000 / remaining),
        height: Math.ceil(product.height * 1000 / remaining)
    }));
    return {diameter, middle, length, kerf, reserve, products: cutProducts,
        finishedProducts: products, dryMode, remaining, priority: fields.priority};
}

function drawPlan(plan, options)
{
    const canvas = element("diagram");
    const size = Math.round(canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 3));
    if (!size)
    {
        return;
    }
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const scale = (size * 0.93) / options.diameter;
    ctx.translate(size / 2, size / 2);
    ctx.scale(scale, scale);

    function circle(radius, color, stroke)
    {
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.4 / scale;
        ctx.stroke();
    }
    circle(options.diameter / 2, "#f0dec0", "#9a7750");
    if (options.reserve)
    {
        circle(options.diameter / 2 - options.reserve, "#f7ead1", "#bf9a6b");
    }
    for (const row of plan.rows)
    {
        for (const piece of row)
        {
            const {x, y, width, height, index} = piece;
            ctx.fillStyle = index ? "#dba967" : "#286349";
            ctx.fillRect(x, y, width, height);
            ctx.lineWidth = 0.9 / scale;
            ctx.strokeStyle = index ? "#65451e" : "#153e30";
            ctx.strokeRect(x, y, width, height);
            const label = width + " × " + height;
            ctx.font = "600 " + 13 / scale + "px system-ui";
            if (height * scale >= 20 && ctx.measureText(label).width < width - 8 / scale)
            {
                ctx.fillStyle = index ? "#342514" : "#ffffff";
                ctx.textBaseline = "middle";
                ctx.textAlign = "center";
                ctx.fillText(label, x + width / 2, y + height / 2);
            }
        }
    }
    if (plan.block && element("show-cut-numbers").checked)
    {
        const cutRadius = options.diameter / 2;
        const pixelUnit = Math.min(window.devicePixelRatio || 1, 3) / scale;
        const markers = [];
        function chooseMarker(x, y, index)
        {
            const candidates = [];
            const minimumDistance = 23 * pixelUnit;
            for (let ring = 0; ring <= 8; ring++)
            {
                const distance = ring * 18 * pixelUnit;
                for (let ray = 0; ray < 16; ray++)
                {
                    const angle = (ray + index * 0.381966) * 2 * Math.PI / 16;
                    const candidate = {x: x + Math.cos(angle) * distance,
                        y: y + Math.sin(angle) * distance};
                    if (Math.hypot(candidate.x, candidate.y) > cutRadius - 12 * pixelUnit) continue;
                    const clearance = markers.length ? Math.min(...markers.map((marker) =>
                        Math.hypot(candidate.x - marker.x, candidate.y - marker.y))) : Infinity;
                    if (clearance >= minimumDistance) return candidate;
                    candidates.push({...candidate, clearance: clearance - distance / 100});
                }
            }
            candidates.sort((a, b) => b.clearance - a.clearance);
            return candidates[0] || {x, y};
        }
        for (const [index, cut] of plan.block.cutSequence.entries())
        {
            let x1;
            let y1;
            let x2;
            let y2;
            let labelX;
            let labelY;
            if (cut.axis === "y")
            {
                const half = Math.sqrt(Math.max(0, cutRadius * cutRadius - cut.offset * cut.offset));
                x1 = Math.max(-half, cut.span[0]);
                x2 = Math.min(half, cut.span[1]);
                y1 = y2 = cut.offset;
                labelX = x1 + 13 * pixelUnit;
                labelY = cut.offset;
            }
            else if (cut.axis === "x")
            {
                const half = Math.sqrt(Math.max(0, cutRadius * cutRadius - cut.offset * cut.offset));
                x1 = x2 = cut.offset;
                y1 = Math.max(-half, cut.span[0]);
                y2 = Math.min(half, cut.span[1]);
                labelX = cut.offset;
                labelY = y1 + 13 * pixelUnit;
            }
            else
            {
                const block = plan.block;
                const [firstBoard, lastBoard] = cut.boardRange || [1, 1];
                const top = -block.blockHeight / 2 + (firstBoard - 1) *
                    (block.pieceHeight + options.kerf);
                const bottom = -block.blockHeight / 2 + (lastBoard - 1) *
                    (block.pieceHeight + options.kerf) + block.pieceHeight;
                x1 = x2 = cut.offset;
                y1 = top;
                y2 = bottom;
                labelX = cut.offset;
                labelY = (top + bottom) / 2;
            }
            ctx.beginPath();
            ctx.setLineDash([5 * pixelUnit, 3 * pixelUnit]);
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineWidth = 1.5 * pixelUnit;
            ctx.strokeStyle = "#b03b2e";
            ctx.stroke();
            ctx.setLineDash([]);
            markers.push({number: index + 1, ...chooseMarker(labelX, labelY, index)});
        }
        for (const marker of markers)
        {
            ctx.beginPath();
            ctx.arc(marker.x, marker.y, 10 * pixelUnit, 0, 2 * Math.PI);
            ctx.fillStyle = "#fffdf5";
            ctx.fill();
            ctx.lineWidth = 1.5 * pixelUnit;
            ctx.strokeStyle = "#9c2f24";
            ctx.stroke();
            ctx.fillStyle = "#78251e";
            ctx.font = "700 " + 10 * pixelUnit + "px system-ui";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(String(marker.number), marker.x, marker.y);
        }
    }
}

function display(plan, options)
{
    element("result").hidden = false;
    element("cut-number-control").hidden = !plan.block;
    const blockMethod = element("block-method");
    const blockSteps = element("block-steps");
    const blockFinishing = element("block-finishing");
    element("block-description").hidden = !plan.block;
    if (plan.block)
    {
        blockMethod.textContent = "Vier Flächen nacheinander bearbeiten: oben, rechts, unten, links. " +
            "Auf Fläche 1 und 2 je höchstens eine Seitenbohle lösen, auf Fläche 3 und 4 je bis zu zwei. " +
            "Anschließend den Hauptproduktblock in Bohlen sägen und diese um 90° gedreht auftrennen. " +
            "Hauptproduktblock: " + plan.block.blockWidth + " × " + plan.block.blockHeight +
            " mm. Stücke aus Seitenware: " + plan.block.sideCount + ".";
        blockSteps.replaceChildren(...plan.block.cutSequence.map((cut) =>
        {
            const item = document.createElement("li");
            const offset = cut.axis === "Bohlenbreite" ?
                "Bohlenbreite, " + number(cut.offset, 1) + " mm ab Blockmitte" :
                cut.axis + " = " + number(cut.offset, 1) + " mm ab Stammmitte";
            const turn = cut.quarterTurn ? "Stamm um 90° drehen. " :
                cut.turnBoards ? "Hauptproduktbohlen um 90° drehen. " :
                cut.alignCore ? "Block zum Bohlensägen ausrichten. " : "";
            const opening = cut.openingMeasures;
            const measures = opening ? " Schnittbreite: " + number(opening.widthMm, 1) +
                " mm · Segmenthöhe: " + number(opening.segmentHeightMm, 1) + " mm." : "";
            item.textContent = turn + cut.face + " — " + cut.operation + " bei " + offset +
                (cut.detail ? ". Schnittmaß: " + cut.detail : ".") + measures;
            return item;
        }));
        blockFinishing.textContent = "Nachbearbeitung, nicht nummeriert: Seitenware auf die endgültigen Breiten und Stärken auftrennen.";
    }
    element("result-diameter").textContent = "Zopf Ø " + number(options.diameter / 10, 1) + " cm";
    element("pieces").textContent = number(plan.count);
    element("volume").textContent = number(plan.timberVolume, 4) + " m³";
    element("yield").textContent = number(plan.yieldPercent, 1) + " %";
    element("log-volume").textContent = "Stammvolumen " + number(plan.logVolume, 4) +
        " fm · Länge je Stück " + number(options.length, 3) + " m";
    element("dimension-heading").textContent = options.dryMode ? "Sollmaß trocken in mm" : "Maße in mm";
    element("cut-dimensions").hidden = !options.dryMode;
    const grouped = new Map();
    const rowList = element("row-list");
    rowList.replaceChildren();
    for (const row of plan.rows)
    {
        const descriptions = [];
        for (const piece of row)
        {
            const product = options.products[piece.index];
            const label = piece.index ? (product.flexible ? "Brett" : "Nebenprodukt") + " " + piece.index : "Hauptprodukt";
            const finished = options.finishedProducts[piece.index];
            const boardWidth = piece.boardWidth ?? piece.width;
            const width = product.flexible ? Math.floor(boardWidth * options.remaining / 1000) : finished.width;
            const dimensions = width + " × " + finished.height;
            const cutDimensions = (product.flexible ? boardWidth : product.width) + " × " + product.height;
            const key = label + " " + dimensions + " " + cutDimensions;
            const group = grouped.get(key) || {label, dimensions, cutDimensions, count: 0, index: piece.index, width};
            group.count++;
            grouped.set(key, group);
            descriptions.push(label + ", " + piece.width + " × " + piece.height + " mm ab " +
                number(piece.x, 1) + " mm" + (plan.block ? " / y " + number(piece.y, 1) + " mm" : ""));
        }
        const item = document.createElement("li");
        item.textContent = plan.block ? descriptions.join(" · ") : "Von " + number(row[0].y, 1) + " bis " +
            number(row[0].y + row[0].height, 1) + " mm: " + descriptions.join(" · ");
        rowList.append(item);
    }
    const body = element("piece-list");
    body.replaceChildren();
    for (const row of Array.from(grouped.values()).sort((a, b) => a.index - b.index || b.width - a.width))
    {
        const tr = document.createElement("tr");
        const cells = [row.label, row.dimensions];
        if (options.dryMode)
        {
            cells.push(row.cutDimensions);
        }
        cells.push(number(row.count));
        for (const value of cells)
        {
            const td = document.createElement("td");
            td.textContent = value;
            tr.append(td);
        }
        body.append(tr);
    }
    lastPlan = {plan, options};
    drawPlan(plan, options);
}

function calculate(focus)
{
    try
    {
        const options = settings();
        const plan = options.priority === "block" ? solveBlockCuts(options) : solveCuts(options);
        if (!plan)
        {
            throw new Error("Das Hauptprodukt passt mit diesen Maßen nicht in den nutzbaren Zopf.");
        }
        element("form-status").hidden = true;
        display(plan, options);
        if (focus)
        {
            element("result-title").focus();
        }
    }
    catch (error)
    {
        element("result").hidden = true;
        lastPlan = null;
        const status = element("form-status");
        status.textContent = error.message;
        status.hidden = false;
    }
}

element("add").addEventListener("click", () =>
{
    addSide().focus();
    invalidate();
});
function updateShrinkageControl()
{
    element("shrinkage").disabled = element("size-mode").value !== "dry";
}

element("size-mode").addEventListener("input", updateShrinkageControl);
function updatePriorityHint()
{
    element("priority-hint").textContent = element("priority").value === "block" ?
        "Wood-Mizer: vier Flächen mit drei 90°-Drehungen. Bei gleicher Anzahl Hauptprodukte entscheidet die Ausbeute der Seitenware." :
        "Beide Varianten verlangen mindestens ein Hauptprodukt.";
}
element("priority").addEventListener("input", updatePriorityHint);
form.addEventListener("input", invalidate);
form.addEventListener("submit", (event) =>
{
    event.preventDefault();
    storeState();
    calculate(true);
});
window.addEventListener("resize", () =>
{
    if (lastPlan)
    {
        drawPlan(lastPlan.plan, lastPlan.options);
    }
});
let restored = defaults;
try
{
    const saved = JSON.parse(localStorage.getItem("saegwerk.inputs.v1"));
    if (saved?.fields && Array.isArray(saved.sides))
    {
        restored = saved;
        if (!saved.fields["size-mode"] && saved.fields.kerf === "3")
        {
            saved.fields.kerf = "2";
        }
    }
}
catch
{
    // Use the initial example if saved inputs cannot be loaded.
}
for (const id of fieldIds)
{
    if (typeof restored.fields[id] === "string")
    {
        element(id).value = restored.fields[id];
    }
}
for (const side of restored.sides.slice(0, 12))
{
    if (side && typeof side === "object")
    {
        addSide(side);
    }
}
updateShrinkageControl();
updatePriorityHint();
const cutNumberToggle = element("show-cut-numbers");
try
{
    cutNumberToggle.checked = localStorage.getItem("saegwerk.showCutNumbers.v1") !== "false";
}
catch
{
    // Keep cut numbers visible if the preference cannot be stored.
}
cutNumberToggle.addEventListener("change", () =>
{
    try
    {
        localStorage.setItem("saegwerk.showCutNumbers.v1", String(cutNumberToggle.checked));
    }
    catch
    {
        // The preference only controls the drawing.
    }
    if (lastPlan)
    {
        drawPlan(lastPlan.plan, lastPlan.options);
    }
});
form.noValidate = true;
calculate(false);
function showUpdate(worker)
{
    pendingWorker = worker;
    element("update-panel").hidden = !worker;
    element("update-status").textContent = worker ? "Eine neue Version ist bereit." : "";
}

element("apply-update").addEventListener("click", () =>
{
    if (!pendingWorker || applyingUpdate)
    {
        return;
    }
    if (!window.confirm("SägWerk jetzt aktualisieren? Bitte andere geöffnete SägWerk-Fenster vorher schließen."))
    {
        return;
    }
    applyingUpdate = true;
    element("apply-update").disabled = true;
    element("update-status").textContent = "Update wird übernommen …";
    pendingWorker.postMessage({type: "ACTIVATE_UPDATE"});
});

if ("serviceWorker" in navigator && ["http:", "https:"].includes(location.protocol))
{
    navigator.serviceWorker.addEventListener("controllerchange", () =>
    {
        if (applyingUpdate)
        {
            window.location.reload();
        }
    });
    navigator.serviceWorker.register("./service-worker.js", {scope: "./", updateViaCache: "none"}).then((registration) =>
    {
        if (registration.waiting && navigator.serviceWorker.controller)
        {
            showUpdate(registration.waiting);
        }
        registration.addEventListener("updatefound", () =>
        {
            const worker = registration.installing;
            if (!worker)
            {
                return;
            }
            worker.addEventListener("statechange", () =>
            {
                if (worker.state === "installed" && navigator.serviceWorker.controller)
                {
                    showUpdate(worker);
                }
            });
        });
        if (navigator.onLine)
        {
            registration.update().catch(() => {});
        }
    }).catch(console.error);
}

