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

if (typeof module !== "undefined")
{
    module.exports = { solveCuts };
}

