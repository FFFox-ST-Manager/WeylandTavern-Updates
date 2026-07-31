// lib/helixQuota.js
//
// Remaining-daily-messages lookup for the meta battery mode, using the same HelixMind quota
// endpoint and HMKey global variable as WT-HelixUsage's tracker. Results are cached for a
// couple of minutes — the status bar re-renders every 30s and must never turn that cadence
// into API hammering.

// Match WT-HelixUsage's real endpoint and response format. The earlier quota endpoint used a
// different service schema, so it could never supply WeyPhone with a valid battery number.
// After the HelixMind backend migration the per-key quota lives at /v1/usage/quota, which
// returns the used/limit counts directly instead of a list of timestamped records.
export const QUOTA_ENDPOINT = 'https://helixmind.online/v1/usage/quota';
export const QUOTA_CACHE_MS = 2 * 60_000;
export const QUOTA_FETCH_TIMEOUT_MS = 8_000;

let cachedRemaining = null;
let cachedLimit = null;
let cachedAt = 0;
let cachedKey = null;
let inFlight = null; // { key, promise }

/** The HelixMind API key WT-HelixUsage stores as a global variable. */
export function getHelixKey(context) {
    const key = context?.variables?.global?.get?.('HMKey');
    return (typeof key === 'string' && key.trim() !== '') ? key.trim() : null;
}

/**
 * @param {string} apiKey
 * @param {typeof fetch} [fetchFn] injectable for tests
 * @returns {Promise<number|null>} remaining daily messages, or null when unknowable
 *   (request failed, or the account has no finite limit)
 */
export async function fetchMessageQuota(apiKey, fetchFn = fetch, { timeoutMs = QUOTA_FETCH_TIMEOUT_MS, now = Date.now } = {}) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        const response = await fetchFn(QUOTA_ENDPOINT, {
            headers: { Authorization: `Bearer ${apiKey}` },
            ...(controller ? { signal: controller.signal } : {}),
        });
        if (!response.ok) return null;
        const payload = await response.json();
        // New backend shape: { global_rpd: { used, limit }, global_rpm: {...}, ... }.
        // This replaces the old { limit, data[] } response, where remaining had to be
        // derived by counting timestamped records inside a rolling 24h window.
        const rpd = payload?.global_rpd;
        const limit = Number(rpd?.limit);
        const used = Number(rpd?.used);
        // limit <= 0 is treated as unusable (and covers a possible unlimited-key signal)
        // until a live unlimited response confirms how the new backend represents "no cap".
        if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(used)) return null;
        return { remaining: Math.max(0, limit - used), limit };
    } catch {
        return null;
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

/** The last fetched remaining-message count (may be stale up to QUOTA_CACHE_MS; null = unknown). */
export function getCachedRemaining() {
    return cachedRemaining;
}

/** Backward-compatible numeric helper used by older callers. */
export async function fetchRemainingMessages(apiKey, fetchFn = fetch, options = {}) {
    return (await fetchMessageQuota(apiKey, fetchFn, options))?.remaining ?? null;
}

/** Current tracker state for Settings copy; never exposes the key itself. */
export function getQuotaSnapshot(context) {
    const apiKey = getHelixKey(context);
    if (!apiKey) return { status: 'no-key', remaining: null, limit: null };
    if (cachedKey !== apiKey) return { status: 'idle', remaining: null, limit: null };
    if (inFlight?.key === apiKey) return { status: 'loading', remaining: cachedRemaining, limit: cachedLimit };
    if (typeof cachedRemaining === 'number' && typeof cachedLimit === 'number') {
        return { status: 'ready', remaining: cachedRemaining, limit: cachedLimit };
    }
    if (cachedAt > 0) return { status: 'unavailable', remaining: null, limit: null };
    return { status: 'idle', remaining: null, limit: null };
}

/**
 * Throttled background refresh. Safe to call from every status-bar render: within the cache
 * window (or with a fetch already in flight, or no key set) it's a no-op. `onUpdate` fires
 * only when a fetch actually completes with a changed value — the caller re-renders then.
 * @param {object} context SillyTavern context (for the HMKey global)
 * @param {() => void} [onUpdate]
 */
export function refreshRemainingMessages(context, onUpdate, { fetchFn = fetch, now = Date.now } = {}) {
    const apiKey = getHelixKey(context);
    if (!apiKey) {
        cachedKey = null;
        cachedRemaining = null;
        cachedLimit = null;
        cachedAt = 0;
        return;
    }
    if (apiKey !== cachedKey) {
        cachedKey = apiKey;
        cachedRemaining = null;
        cachedLimit = null;
        cachedAt = 0;
    }
    if (inFlight?.key === apiKey || (cachedAt > 0 && (now() - cachedAt) < QUOTA_CACHE_MS)) return;

    const promise = fetchMessageQuota(apiKey, fetchFn, { now }).then(quota => {
        // Ignore a response for a key that was removed/replaced while this request was running.
        if (cachedKey !== apiKey) return;
        cachedAt = now();
        cachedRemaining = quota?.remaining ?? null;
        cachedLimit = quota?.limit ?? null;
        // A completed null result is still a meaningful state transition (loading -> unavailable),
        // so Settings must repaint even when the numeric value did not change.
        onUpdate?.();
    }).finally(() => {
        if (inFlight?.promise === promise) inFlight = null;
    });
    inFlight = { key: apiKey, promise };
    return promise;
}

/** Reset module state; useful for deterministic tests and future account-switch hooks. */
export function resetQuotaCache() {
    cachedRemaining = null;
    cachedLimit = null;
    cachedAt = 0;
    cachedKey = null;
    inFlight = null;
}
