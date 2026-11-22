"use strict";

(() => {
    const get = id => document.getElementById(id);
    const form = get("actual-cut-form");
    const rows = get("actual-cut-rows");
    const stems = get("cut-stems");
    const status = get("cut-status");
    const fields = ["pieces", "thicknessMm", "widthMm", "lengthMm"];
    let batch;
    let report;

    const readRows = () => Array.from(rows.children, row =>
        Object.fromEntries(fields.map(field => [field, Number(row.querySelector(`[name="${field}"]`).value)])));
    function changed()
    {
        report = null;
        get("cut-transfer").hidden = true;
        const volume = readRows().reduce((total, row) =>
            total + row.pieces * row.thicknessMm * row.widthMm * row.lengthMm / 1e9, 0);
        get("actual-cut-volume").textContent = `Ist-Volumen: ${volume.toLocaleString("de-DE", {maximumFractionDigits: 4})} m³`;
    }
    function addRow()
    {
        const row = get("actual-cut-template").content.firstElementChild.cloneNode(true);
        row.querySelector("[data-remove]").onclick = () => { row.remove(); changed(); };
        rows.append(row);
        changed();
    }
    get("cut-batch-file").onchange = async event => {
        const file = event.target.files[0];
        if (!file)
            return;
        try
        {
            if (file.size > 2 * 1024 * 1024)
                throw new Error("Die Schnittchargendatei ist zu groß.");
            const value = JSON.parse(await file.text());
            if (value.format !== "BelegWerk-Schnittcharge" || value.version !== 1 ||
                typeof value.id !== "string" || !Array.isArray(value.stems) || !value.stems.length ||
                value.stems.some(stem => typeof stem.id !== "string" || typeof stem.label !== "string"))
                throw new Error("Die Datei ist keine gültige BelegWerk-Schnittcharge.");
            batch = value;
            get("cut-batch-name").textContent = value.name;
            stems.querySelectorAll("label").forEach(label => label.remove());
            for (const stem of value.stems)
            {
                const label = document.createElement("label");
                const check = document.createElement("input");
                check.type = "checkbox";
                check.value = stem.id;
                label.append(check, document.createTextNode(stem.label));
                stems.append(label);
            }
            stems.hidden = false;
            form.hidden = false;
            rows.replaceChildren();
            addRow();
            status.textContent = "Wähle die tatsächlich eingeschnittenen Stämme.";
        }
        catch (error)
        {
            status.textContent = error.message;
        }
        event.target.value = "";
    };
    get("add-actual-cut").onclick = addRow;
    form.oninput = stems.onchange = changed;
    form.onsubmit = event => {
        event.preventDefault();
        const stemIds = Array.from(stems.querySelectorAll("input:checked"), input => input.value);
        const products = readRows();
        if (!stemIds.length || !products.length)
        {
            status.textContent = "Wähle Stämme und erfasse mindestens eine tatsächliche Maßgruppe.";
            return;
        }
        if (!report)
        {
            const bytes = crypto.getRandomValues(new Uint8Array(16));
            const id = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
            report = {format: "SägWerk-Schnittware", version: 1, id, batchId: batch.id, stemIds, products};
        }
        get("cut-transfer").hidden = false;
        status.textContent = "Ist-Ergebnis bestätigt. Du kannst es sichern oder an BelegWerk senden.";
    };
    get("cut-download").onclick = () => {
        if (!report)
            return;
        const href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], {type: "application/json"}));
        const link = document.createElement("a");
        link.href = href;
        link.download = `Schnittware-${report.id}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
    };
    get("cut-send").onclick = () => {
        try
        {
            if (!report)
                return;
            const address = new URL(get("cut-lan-address").value.trim());
            const octets = address.hostname.split(".").map(Number);
            const privateAddress = octets.length === 4 && (octets[0] === 10 ||
                (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
                (octets[0] === 192 && octets[1] === 168));
            if (address.protocol !== "http:" || !privateAddress || address.username || address.password ||
                !["/schnittcharge", "/schnittware"].includes(address.pathname) || !address.searchParams.get("code"))
                throw new Error("Bitte die WLAN-Adresse aus dem BelegWerk-Dialog eintragen.");
            address.pathname = "/schnittware";
            const post = document.createElement("form");
            post.method = "POST";
            post.action = address.href;
            post.target = "_blank";
            const payload = document.createElement("input");
            payload.type = "hidden";
            payload.name = "payload";
            payload.value = JSON.stringify(report);
            post.append(payload);
            document.body.append(post);
            post.submit();
            post.remove();
            status.textContent = "Das Empfangsfenster zeigt, ob BelegWerk die Schnittware gespeichert hat.";
        }
        catch (error)
        {
            status.textContent = error.message;
        }
    };
})();
