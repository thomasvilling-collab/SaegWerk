"use strict";

const element = (id) => document.getElementById(id);
const sides = element("sides");
const form = element("plan-form");
const number = (value, digits = 0) => value.toLocaleString("de-DE", {maximumFractionDigits: digits});
const defaults = { fields: {}, sides: [{shape: "board", width: "70", height: "25"}] };
const fieldIds = ["diameter", "middle", "length", "kerf", "reserve", "main-width", "main-height", "priority", "size-mode", "shrinkage"];
let lastPlan = null;

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
}

function display(plan, options)
{
    element("result").hidden = false;
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
            const width = product.flexible ? Math.floor(piece.width * options.remaining / 1000) : finished.width;
            const dimensions = width + " × " + finished.height;
            const cutDimensions = (product.flexible ? piece.width : product.width) + " × " + product.height;
            const key = label + " " + dimensions + " " + cutDimensions;
            const group = grouped.get(key) || {label, dimensions, cutDimensions, count: 0, index: piece.index, width};
            group.count++;
            grouped.set(key, group);
            descriptions.push(label + ", " + piece.width + " × " + piece.height + " mm ab " + number(piece.x, 1) + " mm");
        }
        const item = document.createElement("li");
        item.textContent = "Von " + number(row[0].y, 1) + " bis " +
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
        const plan = solveCuts(options);
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
form.noValidate = true;
calculate(false);
if ("serviceWorker" in navigator && ["http:", "https:"].includes(location.protocol))
{
    navigator.serviceWorker.register("./service-worker.js").catch(console.error);
}

