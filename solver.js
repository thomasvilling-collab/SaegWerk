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

// A two-stage breakdown: first square a rectangular cant, saw it into boards,
// then turn each board by 90 degrees and rip it into the main products.
function solveBlockCuts({diameter, middle, length, kerf, reserve, products})
{
    const usable = diameter - 2 * reserve;
    const radius = usable / 2;
    const product = products[0];
    let best = null;
    for (const [pieceWidth, pieceHeight] of [[product.width, product.height], [product.height, product.width]])
    {
        for (let boardCount = 1; boardCount * (pieceHeight + kerf) <= usable + kerf; boardCount++)
        {
            const blockHeight = boardCount * pieceHeight + (boardCount - 1) * kerf;
            for (let piecesPerBoard = 1; piecesPerBoard * (pieceWidth + kerf) <= usable + kerf; piecesPerBoard++)
            {
                const blockWidth = piecesPerBoard * pieceWidth + (piecesPerBoard - 1) * kerf;
                if (Math.hypot(blockWidth / 2, blockHeight / 2) > radius + 1e-9)
                {
                    continue;
                }
                const count = boardCount * piecesPerBoard;
                // Count the four cuts to square the cant, the board cuts, and
                // the rip cuts after turning each board.
                const cuts = 4 + (boardCount - 1) + boardCount * (piecesPerBoard - 1);
                if (!best || count > best.count || (count === best.count &&
                    (cuts < best.cuts || (cuts === best.cuts &&
                        (blockWidth < best.blockWidth || (blockWidth === best.blockWidth && boardCount < best.boardCount))))))
                {
                    best = {pieceWidth, pieceHeight, boardCount, piecesPerBoard,
                        blockWidth, blockHeight, count, cuts};
                }
            }
        }
    }
    if (!best)
    {
        return null;
    }
    const sideVariants = products.flatMap((item, index) =>
    {
        const straight = {...item, index};
        return item.flexible || item.width === item.height ? [straight] :
            [straight, {...straight, width: item.height, height: item.width}];
    });
    const sidesByHeight = new Map();
    for (const variant of sideVariants)
    {
        const group = sidesByHeight.get(variant.height) || [];
        group.push(variant);
        sidesByHeight.set(variant.height, group);
    }
    const maxWidth = usable + kerf;
    function betterSide(a, b)
    {
        return !b || a.mainCount > b.mainCount || (a.mainCount === b.mainCount &&
            ((a.flankArea || 0) > (b.flankArea || 0) || ((a.flankArea || 0) === (b.flankArea || 0) &&
                (a.area > b.area || (a.area === b.area && a.count < b.count)))));
    }
    const sideGroups = Array.from(sidesByHeight, ([height, variants]) =>
    {
        const fixed = variants.filter((item) => !item.flexible);
        const board = variants.filter((item) => item.flexible).sort((a, b) => a.width - b.width)[0];
        const withoutBoard = [ {area: 0, mainCount: 0, count: 0, used: 0, previous: null} ];
        for (let width = 1; width <= maxWidth; width++)
        {
            withoutBoard[width] = withoutBoard[width - 1];
            for (const item of fixed)
            {
                const remaining = width - item.width - kerf;
                if (remaining < 0) continue;
                const prior = withoutBoard[remaining];
                const next = {area: prior.area + item.width * height,
                    mainCount: prior.mainCount + Number(item.index === 0), count: prior.count + 1,
                    used: prior.used + item.width + kerf,
                    piece: {width: item.width, height, index: item.index}, previous: prior};
                if (betterSide(next, withoutBoard[width])) withoutBoard[width] = next;
            }
        }
        const options = withoutBoard.slice();
        if (board)
        {
            let bestPrior = null;
            let bestScore = null;
            for (let width = 1; width <= maxWidth; width++)
            {
                const prior = withoutBoard[width - board.width - kerf];
                if (prior)
                {
                    const score = prior.area - prior.used * height;
                    if (!bestPrior || prior.mainCount > bestPrior.mainCount ||
                        (prior.mainCount === bestPrior.mainCount && score > bestScore.score))
                    {
                        bestPrior = prior;
                        bestScore = {score};
                    }
                }
                if (!bestPrior) continue;
                const boardWidth = width - bestPrior.used - kerf;
                if (boardWidth < board.width) continue;
                const next = {area: bestPrior.area + boardWidth * height,
                    mainCount: bestPrior.mainCount + Number(board.index === 0), count: bestPrior.count + 1,
                    used: width, piece: {width: boardWidth, height, index: board.index}, previous: bestPrior};
                if (betterSide(next, options[width])) options[width] = next;
            }
        }
        return {height, options};
    });
    function unpack(pattern)
    {
        const pieces = [];
        for (let item = pattern; item && item.piece; item = item.previous) pieces.push(item.piece);
        return pieces.reverse();
    }
    const sidePlan = [{area: 0, flankArea: 0, flankCount: 0, mainCount: 0, count: 0, previous: null}];
    const blockTop = radius - best.blockHeight / 2;
    const blockBottom = radius + best.blockHeight / 2;
    for (let bottom = 1; bottom <= usable; bottom++)
    {
        sidePlan[bottom] = sidePlan[bottom - 1];
        for (const group of sideGroups)
        {
            const top = bottom - group.height;
            if (top < 0) continue;
            const outer = Math.max(Math.abs(top - radius), Math.abs(bottom - radius));
            const halfWidth = Math.floor(Math.sqrt(Math.max(0, radius * radius - outer * outer)) + 1e-9);
            const besideBlock = top < blockBottom + kerf && bottom > blockTop - kerf;
            const slotWidth = besideBlock ? Math.max(0, Math.floor(halfWidth - best.blockWidth / 2 - kerf)) : 2 * halfWidth;
            if (!slotWidth) continue;
            const pattern = group.options[slotWidth];
            if (!pattern || !pattern.count) continue;
            const rowArea = pattern.area * (besideBlock ? 2 : 1);
            const previousEnd = Math.max(0, top - kerf);
            const prior = sidePlan[previousEnd];
            const next = {area: prior.area + rowArea,
                flankArea: prior.flankArea + (besideBlock ? rowArea : 0),
                flankCount: prior.flankCount + (besideBlock ? pattern.count * 2 : 0),
                mainCount: prior.mainCount + pattern.mainCount * (besideBlock ? 2 : 1),
                count: prior.count + pattern.count * (besideBlock ? 2 : 1),
                top, height: group.height, halfWidth, slotWidth, besideBlock, pattern,
                previous: prior};
            if (betterSide(next, sidePlan[bottom])) sidePlan[bottom] = next;
        }
    }
    const sideRows = [];
    for (let current = sidePlan[usable]; current && current.top !== undefined; current = current.previous)
    {
        const pieces = unpack(current.pattern);
        const occupied = current.pattern.used - kerf;
        const y = current.top - radius;
        if (current.besideBlock)
        {
            const leftStart = -best.blockWidth / 2 - kerf - occupied;
            let leftX = leftStart;
            let rightX = best.blockWidth / 2 + kerf;
            const left = [];
            const right = [];
            for (const piece of pieces)
            {
                left.push({...piece, x: leftX, y});
                right.push({...piece, x: rightX, y});
                leftX += piece.width + kerf;
                rightX += piece.width + kerf;
            }
            sideRows.push({pieces: [...left, ...right], leftPieces: left, rightPieces: right,
                besideBlock: true, piecesPerSide: pieces.length});
        }
        else
        {
            let x = -occupied / 2;
            const row = [];
            for (const piece of pieces)
            {
                row.push({...piece, x, y});
                x += piece.width + kerf;
            }
            sideRows.push({pieces: row, besideBlock: false, piecesPerSide: row.length});
        }
    }
    sideRows.reverse();
    const faces = {first: [], second: [], oppositeFirst: [], last: []};
    for (const sideRow of sideRows)
    {
        if (sideRow.besideBlock)
        {
            faces.second.push(...sideRow.rightPieces);
            faces.last.push(...sideRow.leftPieces);
        }
        else if (sideRow.pieces[0].y + sideRow.pieces[0].height <= -best.blockHeight / 2)
        {
            faces.first.push(...sideRow.pieces);
        }
        else
        {
            faces.oppositeFirst.push(...sideRow.pieces);
        }
    }
    const rows = [];
    const firstX = -(best.blockWidth - kerf) / 2;
    const firstY = -(best.blockHeight - kerf) / 2;
    for (let board = 0; board < best.boardCount; board++)
    {
        const pieces = [];
        for (let piece = 0; piece < best.piecesPerBoard; piece++)
        {
            pieces.push({width: best.pieceWidth, height: best.pieceHeight, index: 0,
                x: firstX + piece * (best.pieceWidth + kerf),
                y: firstY + board * (best.pieceHeight + kerf)});
        }
        rows.push(pieces);
    }
    rows.push(...sideRows.map((sideRow) => sideRow.pieces));
    let sideVolume = 0;
    let sideCuts = 0;
    for (const sideRow of sideRows)
    {
        sideCuts += Math.max(0, sideRow.piecesPerSide - 1) * (sideRow.besideBlock ? 2 : 1);
        for (const piece of sideRow.pieces)
        {
            sideVolume += piece.width * piece.height * length / 1e6;
        }
    }
    const timberVolume = best.count * product.width * product.height * length / 1e6 + sideVolume;
    const logVolume = Math.PI * (middle / 2000) ** 2 * length;
    return {rows, timberVolume, logVolume, count: best.count + sidePlan[usable].count,
        mainCount: best.count + sidePlan[usable].mainCount,
        yieldPercent: 100 * timberVolume / logVolume,
        block: {...best, sideMainCount: sidePlan[usable].mainCount,
            sideCount: sidePlan[usable].count - sidePlan[usable].mainCount,
            flankCount: sidePlan[usable].flankCount,
            faceCounts: {first: faces.first.length, second: faces.second.length,
                oppositeFirst: faces.oppositeFirst.length, last: faces.last.length},
            facePieces: faces,
            cuts: best.cuts + sideCuts}};
}

if (typeof module !== "undefined")
{
    module.exports = { solveCuts, solveBlockCuts };
}

