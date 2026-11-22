"use strict";

function solveCuts({diameter, middle, length, kerf, reserve, products, priority})
{
    const usable = diameter - 2 * reserve;
    const radius = usable / 2;
    const variants = products.flatMap((product, index) =>
    {
        const straight = { ...product, index };
        if (product.flexible || product.width === product.height)
        {
            return [straight];
        }
        return [straight, { ...straight, width: product.height, height: product.width }];
    });
    const rowsByHeight = new Map();
    for (const variant of variants)
    {
        const group = rowsByHeight.get(variant.height) || [];
        group.push(variant);
        rowsByHeight.set(variant.height, group);
    }
    const empty = { area: 0, mainCount: 0, count: 0, end: 0, previous: null };

    function better(a, b)
    {
        if (!b)
        {
            return true;
        }
        if (priority === "main" && a.mainCount !== b.mainCount)
        {
            return a.mainCount > b.mainCount;
        }
        return a.area > b.area || (a.area === b.area && (a.mainCount > b.mainCount ||
            (a.mainCount === b.mainCount && a.count < b.count)));
    }

    // For each available row width, find the best packing with and without main products.
    function rowOptions(height, variants)
    {
        const without = [empty];
        const withMain = [null];
        const fixed = variants.filter((item) => !item.flexible);
        const board = variants.filter((item) => item.flexible).sort((a, b) => a.width - b.width)[0];
        for (let width = 1; width <= usable + kerf; width++)
        {
            without[width] = without[width - 1];
            withMain[width] = withMain[width - 1];
            for (const item of fixed)
            {
                const remaining = width - item.width - kerf;
                if (remaining < 0)
                {
                    continue;
                }
                for (const prior of [without[remaining], withMain[remaining]])
                {
                    if (!prior)
                    {
                        continue;
                    }
                    const next = {
                        area: prior.area + item.width * height,
                        mainCount: prior.mainCount + Number(item.index === 0),
                        count: prior.count + 1,
                        used: (prior.used || 0) + item.width + kerf,
                        piece: { width: item.width, height, index: item.index },
                        previous: prior
                    };
                    const target = next.mainCount ? withMain : without;
                    if (better(next, target[width]))
                    {
                        target[width] = next;
                    }
                }
            }
        }
        if (!board)
        {
            return {without, withMain};
        }

        // A variable-width board can fill the remaining width beside fixed pieces.
        function addBoard(fixedOptions)
        {
            const options = fixedOptions.slice();
            let bestPrior = null;
            let bestScore = null;
            for (let width = board.width + kerf; width <= usable + kerf; width++)
            {
                const prior = fixedOptions[width - board.width - kerf];
                if (prior)
                {
                    const score = { ...prior, area: prior.area - (prior.used || 0) * height };
                    if (better(score, bestScore))
                    {
                        bestPrior = prior;
                        bestScore = score;
                    }
                }
                if (!bestPrior)
                {
                    continue;
                }
                const boardWidth = width - (bestPrior.used || 0) - kerf;
                const next = {
                    area: bestPrior.area + boardWidth * height,
                    mainCount: bestPrior.mainCount,
                    count: bestPrior.count + 1,
                    used: width,
                    piece: { width: boardWidth, height, index: board.index },
                    previous: bestPrior
                };
                if (better(next, options[width]))
                {
                    options[width] = next;
                }
            }
            return options;
        }
        return {without: addBoard(without), withMain: addBoard(withMain)};
    }

    const groups = Array.from(rowsByHeight, ([height, items]) => ({
        height, ...rowOptions(height, items)
    }));
    const without = [empty];
    const withMain = [null];
    for (let bottom = 1; bottom <= usable; bottom++)
    {
        without[bottom] = without[bottom - 1];
        withMain[bottom] = withMain[bottom - 1];
        for (const group of groups)
        {
            const top = bottom - group.height;
            if (top < 0)
            {
                continue;
            }
            const outer = Math.max(Math.abs(top - radius), Math.abs(bottom - radius));
            const width = Math.floor(2 * Math.sqrt(radius * radius - outer * outer) + 1e-9);
            const previousEnd = Math.max(0, top - kerf);
            for (const row of [group.without[width + kerf], group.withMain[width + kerf]])
            {
                if (!row || !row.count)
                {
                    continue;
                }
                for (const prior of [without[previousEnd], withMain[previousEnd]])
                {
                    if (!prior)
                    {
                        continue;
                    }
                    const candidate = {
                        area: prior.area + row.area,
                        mainCount: prior.mainCount + row.mainCount,
                        count: prior.count + row.count,
                        top,
                        row,
                        previous: prior
                    };
                    const target = candidate.mainCount ? withMain : without;
                    if (better(candidate, target[bottom]))
                    {
                        target[bottom] = candidate;
                    }
                }
            }
        }
    }

    const best = withMain[usable];
    if (!best)
    {
        return null;
    }

    const rows = [];
    for (let current = best; current.row; current = current.previous)
    {
        const pieces = [];
        let x = -(current.row.used - kerf) / 2;
        for (let item = current.row; item.piece; item = item.previous)
        {
            pieces.push({ ...item.piece, x, y: current.top - radius });
            x += item.piece.width + kerf;
        }
        rows.push(pieces);
    }
    rows.reverse();

    const timberVolume = best.area * length / 1e6;
    const logVolume = Math.PI * (middle / 2000) ** 2 * length;
    return {
        rows, timberVolume, logVolume, count: best.count, mainCount: best.mainCount,
        yieldPercent: 100 * timberVolume / logVolume
    };
}

// Wood-Mizer: finish two adjacent faces, then their opposite faces.
function solveBlockCuts({diameter, middle, length, kerf, reserve, products})
{
    const usable = diameter - 2 * reserve;
    const radius = usable / 2;
    const main = products[0];
    const epsilon = 1e-9;
    let bestCount = 0;
    let cores = [];
    const orientations = main.width === main.height
        ? [[main.width, main.height]] : [[main.width, main.height], [main.height, main.width]];
    for (const [pieceWidth, pieceHeight] of orientations)
    {
        for (let boardCount = 1; boardCount * (pieceHeight + kerf) <= usable + kerf; boardCount++)
        {
            const blockHeight = boardCount * (pieceHeight + kerf) - kerf;
            const maxWidth = 2 * Math.sqrt(Math.max(0, radius * radius - (blockHeight / 2) ** 2));
            const piecesPerBoard = Math.floor((maxWidth + kerf + epsilon) / (pieceWidth + kerf));
            const count = boardCount * piecesPerBoard;
            if (!count || count < bestCount)
                continue;
            if (count > bestCount)
            {
                bestCount = count;
                cores = [];
            }
            cores.push({pieceWidth, pieceHeight, boardCount, piecesPerBoard,
                blockWidth: piecesPerBoard * (pieceWidth + kerf) - kerf, blockHeight, count});
        }
    }
    if (!cores.length)
        return null;

    const groups = new Map();
    products.slice(1).forEach((product, offset) =>
    {
        const item = {...product, index: offset + 1};
        const variants = item.flexible || item.width === item.height
            ? [item] : [item, {...item, width: item.height, height: item.width}];
        for (const variant of variants)
        {
            const group = groups.get(variant.height) || [];
            group.push(variant);
            groups.set(variant.height, group);
        }
    });
    const maxCapacity = usable + kerf;
    const sideOptions = Array.from(groups, ([height, variants]) =>
    {
        const empty = {width: 0, used: 0, count: 0};
        const fixed = variants.filter(variant => !variant.flexible);
        const flexible = variants.filter(variant => variant.flexible).sort((a, b) => a.width - b.width)[0];
        const packed = [empty];
        const better = (a, b) => a.width > b.width || (a.width === b.width && a.count < b.count);
        for (let capacity = 1; capacity <= maxCapacity; capacity++)
        {
            packed[capacity] = packed[capacity - 1];
            for (const item of fixed)
            {
                const before = packed[capacity - item.width - kerf];
                if (!before)
                    continue;
                const candidate = {width: before.width + item.width, used: before.used + item.width + kerf,
                    count: before.count + 1, item, before};
                if (better(candidate, packed[capacity]))
                    packed[capacity] = candidate;
            }
        }
        if (!flexible)
            return {height, packed};
        const filled = packed.slice();
        let bestPrefix;
        for (let capacity = flexible.width + kerf; capacity <= maxCapacity; capacity++)
        {
            const before = packed[capacity - flexible.width - kerf];
            if (!bestPrefix || before.count < bestPrefix.count)
                bestPrefix = before;
            const width = capacity - bestPrefix.used - kerf;
            const candidate = {width: bestPrefix.width + width, used: capacity, count: bestPrefix.count + 1,
                item: {...flexible, width}, before: bestPrefix};
            if (better(candidate, filled[capacity]))
                filled[capacity] = candidate;
        }
        return {height, packed: filled};
    });

    function boardAt(face, inner, option)
    {
        const outer = inner + option.height;
        if (outer >= radius)
            return null;
        const half = Math.sqrt(radius * radius - outer * outer);
        const min = Math.max(-half, face.min);
        const max = Math.min(half, face.max);
        const capacity = Math.floor(max - min + epsilon);
        if (capacity <= 0)
            return null;
        const pattern = option.packed[capacity + kerf];
        if (!pattern.count)
            return null;
        return {inner, outer, option, pattern, start: (min + max - (pattern.used - kerf)) / 2,
            area: pattern.width * option.height};
    }

    function sidePlan(face)
    {
        let best = {boards: [], area: 0, extraCuts: 0};
        for (const option of sideOptions)
        {
            const innerBoard = boardAt(face, face.edge + kerf, option);
            if (!innerBoard)
                continue;
            const tryBoards = (outerBoard) =>
            {
                const boards = outerBoard ? [outerBoard, innerBoard] : [innerBoard];
                const area = innerBoard.area + (outerBoard?.area || 0);
                const extraCuts = boards.reduce((sum, board) => sum + board.pattern.count, 0);
                if (area > best.area || (area === best.area && extraCuts < best.extraCuts))
                    best = {boards, area, extraCuts};
            };
            tryBoards(null);
            if (face.limit === 2)
                for (const outerOption of sideOptions)
                {
                    const outerBoard = boardAt(face, innerBoard.outer + kerf, outerOption);
                    if (outerBoard)
                        tryBoards(outerBoard);
                }
        }
        return best;
    }

    let best;
    for (const core of cores)
    {
        const x = core.blockWidth / 2;
        const y = core.blockHeight / 2;
        const faces = [
            {name: "Fläche 1 oben", axis: "y", sign: -1, edge: y, min: -diameter / 2, max: diameter / 2, limit: 1},
            {name: "Fläche 2 rechts", axis: "x", sign: 1, edge: x, min: -y, max: diameter / 2, limit: 1},
            {name: "Fläche 3 unten", axis: "y", sign: 1, edge: y, min: -diameter / 2, max: x, limit: 2},
            {name: "Fläche 4 links", axis: "x", sign: -1, edge: x, min: -y, max: y, limit: 2}
        ].map(face => ({...face, ...sidePlan(face)}));
        const sideArea = faces.reduce((sum, face) => sum + face.area, 0);
        const cuts = 4 + core.boardCount - 1 + core.piecesPerBoard - 1 +
            faces.reduce((sum, face) => sum + face.extraCuts, 0);
        if (!best || sideArea > best.sideArea || (sideArea === best.sideArea && cuts < best.cuts))
            best = {...core, faces, sideArea, cuts};
    }

    const rows = [];
    const cutSequence = [];
    const addFaceCut = (face, depth, operation, quarterTurn = false) =>
    {
        cutSequence.push({face: face.name, axis: face.axis, offset: face.sign * depth,
            span: [face.min, face.max], operation, quarterTurn});
    };
    for (const [index, face] of best.faces.entries())
    {
        if (!face.boards.length)
        {
            addFaceCut(face, face.edge + kerf / 2, "Fläche plan sägen und Blockkante herstellen", index > 0);
            continue;
        }
        addFaceCut(face, face.boards[0].outer + kerf / 2, "Fläche plan sägen", index > 0);
        for (const board of face.boards)
        {
            const pieces = [];
            let axisPosition = board.start;
            const normalPosition = face.sign < 0 ? -board.outer : board.inner;
            for (let entry = board.pattern; entry.item; entry = entry.before)
            {
                const {width, height, index: productIndex} = entry.item;
                const common = {index: productIndex, boardWidth: width, boardThickness: height};
                pieces.push(face.axis === "y"
                    ? {...common, x: axisPosition, y: normalPosition, width, height}
                    : {...common, x: normalPosition, y: axisPosition, width: height, height: width});
                axisPosition += width + kerf;
            }
            rows.push(pieces);
            addFaceCut(face, board.inner - kerf / 2,
                "Seitenbohle lösen (" + board.option.height + " mm stark)");
        }
    }
    const x = -best.blockWidth / 2;
    const y = -best.blockHeight / 2;
    for (let board = 0; board < best.boardCount; board++)
    {
        const row = [];
        for (let piece = 0; piece < best.piecesPerBoard; piece++)
            row.push({width: best.pieceWidth, height: best.pieceHeight, index: 0,
                x: x + piece * (best.pieceWidth + kerf), y: y + board * (best.pieceHeight + kerf)});
        rows.push(row);
        if (board > 0)
            cutSequence.push({face: "Hauptproduktblock", operation: "Bohle " + (board + 1) + " abtrennen",
                axis: "y", offset: row[0].y - kerf / 2, span: [x, -x], alignCore: board === 1});
    }
    for (let piece = 1; piece < best.piecesPerBoard; piece++)
        cutSequence.push({face: "Hauptproduktbohlen", operation: "Bohlen auftrennen", axis: "Bohlenbreite",
            offset: x + piece * (best.pieceWidth + kerf) - kerf / 2,
            boardRange: [1, best.boardCount], turnBoards: piece === 1});

    const timberVolume = (best.count * main.width * main.height + best.sideArea) * length / 1e6;
    const logVolume = Math.PI * (middle / 2000) ** 2 * length;
    const count = rows.reduce((sum, row) => sum + row.length, 0);
    return {rows, timberVolume, logVolume, count, mainCount: best.count,
        yieldPercent: 100 * timberVolume / logVolume, block: {
            pieceWidth: best.pieceWidth, pieceHeight: best.pieceHeight, boardCount: best.boardCount,
            piecesPerBoard: best.piecesPerBoard, blockWidth: best.blockWidth, blockHeight: best.blockHeight,
            sideCount: count - best.count, cutSequence}};
}

if (typeof module !== "undefined")
{
    module.exports = { solveCuts, solveBlockCuts };
}

