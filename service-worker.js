"use strict";

const cacheName = "saegwerk-offline-v2";
const assets = ["./index.html", "./style.css", "./solver.js", "./app.js", "./manifest.webmanifest",
    "./icon-180.png", "./icon-192.png", "./icon-512.png"];
const scope = self.registration.scope;

self.addEventListener("install", (event) =>
{
    event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(
        assets.map((path) => new Request(new URL(path, scope), {cache: "reload"})))));
});
self.addEventListener("activate", (event) =>
{
    event.waitUntil((async () =>
    {
        for (const key of await caches.keys())
        {
            if (key.startsWith("saegwerk-offline-") && key !== cacheName)
            {
                await caches.delete(key);
            }
        }
        await self.clients.claim();
    })());
});
self.addEventListener("fetch", (event) =>
{
    if (event.request.method !== "GET" || !event.request.url.startsWith(scope))
    {
        return;
    }
    event.respondWith((async () =>
    {
        const cache = await caches.open(cacheName);
        const url = new URL(event.request.url);
        url.search = "";
        if (url.href === scope)
        {
            url.href = new URL("index.html", scope).href;
        }
        return (await cache.match(url.href)) || fetch(event.request);
    })());
});

