// =====================================================================
// Weyland-LTM — Long-Term Memory manager (v1.3.2)
// =====================================================================
// Async draft generation, editable draft window, reroll (regenerates from
// source when known, otherwise rewrites), pin, merge, bulk-select delete,
// version history, backward-compat ingest of entries created by the old
// system.

import {
    loadWorldInfo,
    saveWorldInfo,
    createWorldInfoEntry,
    createNewWorldInfo,
    METADATA_KEY,
    world_names,
} from '../../world-info.js';
import { oai_settings } from '../../openai.js';
import { SlashCommand } from '../../slash-commands/SlashCommand.js';
import { SlashCommandParser } from '../../slash-commands/SlashCommandParser.js';
loadWorldInfo
const ctx = SillyTavern.getContext();
const {
    extensionSettings,
    saveSettingsDebounced,
    eventSource,
    event_types,
} = ctx;

export const WLM_MODULE_NAME = 'Weyland-LTM';
const EXT_VERSION = '1.3.2';

// Default LTM model out of the box for every fresh install. Lucky wants
// Sonnet reserved for actual roleplay messaging rather than burned on LTM
// summarization, so these are the alternatives offered as quick-fill
// buttons in the settings panel. Existing users who've already saved a
// (possibly blank) modelOverride are untouched — RECOMMENDED_LTM_MODEL only
// applies as the default the first time the extension initializes for a
// given install.
const RECOMMENDED_LTM_MODEL = 'glm-4.7-thinking';
const ALTERNATE_LTM_MODELS = ['minimax-m3', 'gemini-3-pro-preview'];

// =====================================================================
// SETTINGS
// =====================================================================

/**
 * @typedef {Object} WeylandLTMSettings
 * @property {boolean} enabled
 * @property {boolean} debug
 * @property {string} modelOverride          // '' => use main chat model
 * @property {number} messagesBetweenLTMs    // suggestion cadence
 * @property {number} activeLTMCount         // how many stay constant-loaded before demotion
 * @property {number} maxVersionsPerEntry    // cap version history
 * @property {number} maxResponseTokens      // generation budget
 * @property {boolean} streamDrafts          // stream tokens into the editor
 * @property {boolean} suggestLTMs           // show "time for an LTM?" chip
 * @property {'auto'|'first'|'third'} povMode // auto = 1st person solo / 3rd person for groups
 * @property {Object} __drafts               // per-chat unsaved editor state
 * @property {Object} __chatState            // per-chat { lastLtmMessageId }
 */

/** @type {WeylandLTMSettings} */
const defaultSettings = {
    enabled: true,
    debug: false,
    modelOverride: RECOMMENDED_LTM_MODEL,
    messagesBetweenLTMs: 100,
    activeLTMCount: 3,
    maxVersionsPerEntry: 10,
    maxResponseTokens: 2000,
    streamDrafts: true,
    suggestLTMs: true,
    povMode: 'auto',
    __drafts: {},
    __chatState: {},
};

/** @type {WeylandLTMSettings} */
let settings;

function loadSettings() {
    extensionSettings[WLM_MODULE_NAME] ??= structuredClone(defaultSettings);
    settings = extensionSettings[WLM_MODULE_NAME];
    for (const [k, v] of Object.entries(defaultSettings)) {
        if (settings[k] === undefined) settings[k] = structuredClone(v);
    }
}

function persistSettings() {
    saveSettingsDebounced();
}

// =====================================================================
// LOGGING
// =====================================================================

function ltmLog(msg, data) {
    if (!settings?.debug) return;
    data !== undefined
        ? console.debug(`[${WLM_MODULE_NAME}] ${msg}`, data)
        : console.debug(`[${WLM_MODULE_NAME}] ${msg}`);
}

function ltmWarn(msg, data) {
    data !== undefined
        ? console.warn(`[${WLM_MODULE_NAME}] ${msg}`, data)
        : console.warn(`[${WLM_MODULE_NAME}] ${msg}`);
}

function toast(kind, msg) {
    try { globalThis.toastr?.[kind]?.(msg, 'Weyland-LTM'); } catch { /* no toastr, no problem */ }
}

// =====================================================================
// MODEL RESOLUTION
// =====================================================================
// Same source->field map Weyland-Router uses. We only READ from it —
// the override is passed per-call, never written to settings.

const MODEL_FIELD_BY_SOURCE = {
    openai: 'openai_model',
    claude: 'claude_model',
    openrouter: 'openrouter_model',
    ai21: 'ai21_model',
    makersuite: 'google_model',
    vertexai: 'vertexai_model',
    mistralai: 'mistralai_model',
    cohere: 'cohere_model',
    perplexity: 'perplexity_model',
    groq: 'groq_model',
    nanogpt: 'nanogpt_model',
    deepseek: 'deepseek_model',
    aimlapi: 'aimlapi_model',
    xai: 'xai_model',
    pollinations: 'pollinations_model',
    moonshot: 'moonshot_model',
    fireworks: 'fireworks_model',
    cometapi: 'cometapi_model',
    custom: 'custom_model',
};

function getCurrentSource() {
    return oai_settings?.chat_completion_source || 'custom';
}

function getCurrentModelId() {
    const field = MODEL_FIELD_BY_SOURCE[getCurrentSource()] || 'custom_model';
    return oai_settings?.[field] || oai_settings?.custom_model || '';
}

function resolveGenerationModel() {
    return (settings.modelOverride || '').trim() || getCurrentModelId();
}

// =====================================================================
// JOB REGISTRY — async draft generations
// =====================================================================

/**
 * @typedef {Object} LTMJob
 * @property {string} id
 * @property {'queued'|'generating'|'ready'|'failed'} status
 * @property {string} chatId
 * @property {{ firstMessageId:number, lastMessageId:number } | null} range   // messages to feed the CURRENT generation call
 * @property {string} model
 * @property {string} draft
 * @property {string} [error]
 * @property {number} startedAt
 * @property {number} [finishedAt]
 * @property {string[]} versions
 * @property {{role:string, content:string}[]} [messagesOverride]  // set for merge/rewrite jobs instead of building fresh from `range`
 * @property {boolean} isFreshSummary       // true only for a from-scratch summary of new chat messages — gates recordLTMCoverage
 * @property {{ firstMessageId:number, lastMessageId:number } | null} [sourceRangeForSave]  // persisted on the saved entry so a later reroll can regenerate from source
 * @property {string} [rewriteTargetUid]    // entry replaced on save
 * @property {string[]} [mergeSourceUids]   // entries consumed on save
 * @property {AbortController} [abort]
 */

// In-memory only, intentionally not persisted to extensionSettings — a
// generating/ready draft that hasn't been saved yet is lost on a full page
// reload. This is an accepted tradeoff (drafts are cheap to regenerate;
// persisting partial generations/AbortControllers across reloads would add
// real complexity for little benefit). Saved entries obviously aren't
// affected — those live in the lorebook, not here.
/** @type {Map<string, LTMJob>} */
const jobs = new Map();

function createJob(chatId, range, extra = {}) {
    const job = /** @type {LTMJob} */ ({
        id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
        status: 'queued',
        chatId,
        range,
        model: resolveGenerationModel() || '(current model)',
        draft: '',
        startedAt: Date.now(),
        versions: [],
        ...extra,
    });
    jobs.set(job.id, job);
    return job;
}

function getJobsForChat(chatId) {
    return [...jobs.values()].filter(j => j.chatId === chatId);
}

// =====================================================================
// CHAT HELPERS
// =====================================================================

function getCurrentChatId() {
    const c = SillyTavern.getContext();
    return String(c.chatId ?? 'unknown');
}

// Weyland Tavern doesn't use SillyTavern's native group-chat feature at all —
// multi-character casts (e.g. Cerberus Sisters: Fawne, Neshe, Astrid) are
// authored as a single character card, so groupId is never set and there's
// no reliable signal to auto-detect "this is actually a multi-character
// cast" from ST's own APIs. Instead, POV is read from a tag baked into the
// character card itself (character.data.tags — the creator-embedded tags
// field, separate from SillyTavern's local per-install tag_map), so the
// backend team can set it once per character file and it travels with the
// card to every subscriber. Recognized tags (case-insensitive):
//   "LTM-POV-First" / "LTM-POV-Third" / "LTM-POV-Group" (alias for Third)
function getCharacterPovTag() {
    const c = SillyTavern.getContext();
    const character = c.characters?.[c.characterId];
    const cardTags = character?.data?.tags;
    if (!Array.isArray(cardTags)) return null;
    for (const raw of cardTags) {
        const t = String(raw).trim().toLowerCase().replace(/[:\s]/g, '-');
        if (t === 'ltm-pov-first') return 'first';
        if (t === 'ltm-pov-third' || t === 'ltm-pov-group') return 'third';
    }
    return null;
}

function getCurrentCharacterName() {
    const c = SillyTavern.getContext();
    return c.name2 || 'the character';
}

function getUserName() {
    return SillyTavern.getContext().name1 || 'the user';
}

function collectChatRange(firstMessageId, lastMessageId) {
    const chat = SillyTavern.getContext().chat || [];
    const slice = chat.slice(Math.max(0, firstMessageId), lastMessageId + 1);
    return slice
        .filter(m => !m.is_system && typeof m.mes === 'string' && m.mes.trim())
        .map(m => `${m.name || (m.is_user ? getUserName() : getCurrentCharacterName())}: ${m.mes}`)
        .join('\n\n');
}

// Weyland's writing style mandates every AI message open with a header like
// "¦¦ Saturday, June 4th ~ 11:51 PM ~ Flight JL062, Tokyo-Bound ~ (SAPH) ¦¦"
// (see the [HEADER FORMATTING] instructions in WeylandUni.json). That means
// the in-story date/time is almost always sitting right there in the chat
// log — no need to make the model guess it, which is what caused it to fall
// back to today's real-world date.
const HEADER_RE = /¦¦\s*([^¦\n]+?)\s*¦¦/;

/**
 * @param {string} mes
 * @returns {{date:string, time:string, location:string, tag:string} | null}
 */
function extractMessageHeader(mes) {
    if (!mes) return null;
    const m = String(mes).match(HEADER_RE);
    if (!m) return null;
    const [date, time, location, tag] = m[1].split('~').map(s => s.trim());
    if (!date || !time) return null;
    return { date, time, location: location || '', tag: (tag || '').replace(/[()]/g, '') };
}

/**
 * Walks the message range in order and returns every header found,
 * de-duping consecutive repeats (edited/regenerated messages often repeat
 * the same header). The last entry is the most recent in-story moment
 * covered by this excerpt — the right anchor date for the memory.
 */
function extractTimelineFromRange(firstMessageId, lastMessageId) {
    const chat = SillyTavern.getContext().chat || [];
    const slice = chat.slice(Math.max(0, firstMessageId), lastMessageId + 1);
    const timeline = [];
    for (const m of slice) {
        if (m.is_user || m.is_system) continue;
        const h = extractMessageHeader(m.mes);
        if (!h) continue;
        const prev = timeline[timeline.length - 1];
        if (prev && prev.date === h.date && prev.time === h.time) continue;
        timeline.push(h);
    }
    return timeline;
}

function computeRangeFromCurrentChat() {
    const chat = SillyTavern.getContext().chat || [];
    const last = chat.length - 1;
    const state = settings.__chatState[getCurrentChatId()];
    // Start after the last message covered by a previous LTM, capped so a
    // giant backlog doesn't blow the context window.
    const HARD_CAP = 200;
    let first = (state?.lastLtmMessageId ?? -1) + 1;
    if (last - first + 1 > HARD_CAP) first = last - HARD_CAP + 1;
    if (first > last) first = Math.max(0, last - settings.messagesBetweenLTMs + 1);
    return { firstMessageId: Math.max(0, first), lastMessageId: Math.max(0, last) };
}

/**
 * The absolute message index the next LTM is aiming for — either a manual
 * override (like the old system's "Set LTM Goal") or computed from the
 * cadence setting off the last LTM's coverage. Mirrors the old system's
 * "LTM Progress X/Y" concept, just derived instead of hand-tracked.
 */
function getEffectiveGoal(chatId = getCurrentChatId()) {
    const state = settings.__chatState[chatId];
    if (Number.isInteger(state?.goalOverride)) return state.goalOverride;
    return (state?.lastLtmMessageId ?? -1) + Number(settings.messagesBetweenLTMs || 100);
}

function setGoalOverride(chatId, absoluteMessageId) {
    settings.__chatState[chatId] ??= {};
    settings.__chatState[chatId].goalOverride = Math.max(0, Math.floor(absoluteMessageId));
    persistSettings();
}

function clearGoalOverride(chatId) {
    if (settings.__chatState[chatId]) {
        delete settings.__chatState[chatId].goalOverride;
        persistSettings();
    }
}

function recordLTMCoverage(lastMessageId) {
    // Overwriting wholesale is intentional — a fresh summary resets the
    // cadence baseline, so any manual goal override should clear too.
    settings.__chatState[getCurrentChatId()] = { lastLtmMessageId: lastMessageId };
    persistSettings();
}

// =====================================================================
// LTM PROMPT
// =====================================================================
// Every prompt builder below returns a MESSAGE ARRAY, not a single string,
// structured as a sandwich:

const THINKING_DISCIPLINE = `Keep any <think></think> reasoning SHORT — a handful of terse bullet points, not an essay. The instant you close </think>, continue in that SAME response with the actual output. Stopping after only the thinking block is a failure — you are not done until [END MEMORY ENTRY] (or the equivalent closing marker) has been written.`;

/**
 * @param {'first'|'third'} [override] explicit POV, bypassing settings.povMode
 * @returns {'first'|'third'}
 */
function resolvePovMode(override) {
    if (override === 'first' || override === 'third') return override;
    if (settings.povMode === 'first') return 'first';
    if (settings.povMode === 'third') return 'third';
    // auto: character card tag wins if present, otherwise default to 1st person
    return getCharacterPovTag() ?? 'first';
}

/**
 * @param {string} chatHistoryText
 * @param {ReturnType<typeof extractTimelineFromRange>} timeline
 */
function buildLTMPrompt(chatHistoryText, timeline = []) {
    const character = getCurrentCharacterName();
    const user = getUserName();
    const povMode = resolvePovMode();
    const anchor = timeline.length ? timeline[timeline.length - 1] : null;

    const timelineBlock = timeline.length
        ? `\nTIME MARKERS FOUND IN THIS EXCERPT (from message headers, chronological order — this is ground truth, not something to infer):\n${timeline
            .map((h, i) => `${i + 1}. ${h.date} - ${h.time}${h.location ? ` @ ${h.location}` : ''}${h.tag ? ` [${h.tag}]` : ''}`)
            .join('\n')}\n`
        : '';

    const dateInstruction = anchor
        ? `- The in-story date and time is already known from the excerpt's own message headers (see TIME MARKERS above) — do NOT infer or invent one. The output template below already has the correct value filled in on the date/time line; reproduce that line exactly as written, character for character.`
        : `- Determine the IN-STORY date and time from context clues in the excerpt itself (explicit dates/times, time-of-day cues, anything establishing the story's own timeline). This is a FICTIONAL scene — it has no relation to today's real-world calendar date, so never use that. If the excerpt gives no explicit date, use a relative marker instead (e.g. "Later that evening", "The next morning") rather than inventing a specific one.`;

    const dateLine = anchor
        ? `[${anchor.date} - ${anchor.time}]`
        : `[IN-STORY DATE AND TIME, taken from the excerpt's own timeline — e.g. "Saturday, June 4th - 11:51 PM" — or a relative marker like "Later that evening" if the excerpt gives no explicit date. Do NOT use today's real-world date.]`;

    const povInstruction = povMode === 'first'
        ? `- Write from ${character}'s limited point of view, in FIRST PERSON, in ${character}'s authentic voice — no clinical jargon, no metaphors that don't fit them. Reads like ${character}'s own diary entry. Omit anything ${character} does not know (no spoilers, no other characters' secrets).`
        : `- Write in THIRD PERSON as a neutral, dispassionate narrator — NOT in ${character}'s voice. Do not adopt their personality, speech patterns, or emotional coloring; this is a plain factual account, like an incident report. Still limited to what ${character} would know at the time (no spoilers, no other characters' secrets) — just narrated without characterization.`;

    const narrativeTemplateLine = povMode === 'first'
        ? `[NARRATIVE SECTION — 500 tokens maximum, first person, in ${character}'s voice, like a journal entry]`
        : `[NARRATIVE SECTION — 500 tokens maximum, third person, neutral narrator with no characterization]`;

    const systemMsg = `[MEMORY FORMATION SYSTEM]

You are assisting with memory formation for the character "${character}". This is NOT a roleplay turn — you are stepping outside the story to produce a structured summary of it, for the character's own long-term memory.
${timelineBlock}
Before writing, reason inside a single <think></think> block:
- Confirm the boundaries of the excerpt. Do NOT invent context from before it begins.
${dateInstruction}
- List every location and scene so coverage spans the whole excerpt, not just the end.
- Only include inferences you are 90%+ confident in.
${povInstruction}
- Use real names in your output ("${character}", "${user}") — write them out normally, not as placeholders or tokens.

${THINKING_DISCIPLINE}

Output EXACTLY this structure and nothing else:

[MEMORY ENTRY]

${dateLine}

# [SHORT DESCRIPTIVE TITLE]

${narrativeTemplateLine}

MEMORY:
• Location(s): [all locations visited]
• Key Events: [maximum 5, chronological]
• Conversations: [maximum 3 — topics and decisions made]

FRAGMENTS:
• "[Meaningful quote worth remembering]" — [speaker, by name]
• [Specific sensory or emotional detail]
• [maximum 5 bullets total]

[END MEMORY ENTRY]

Guidelines: condense repetitive events; keep only major developments. For intimate/NSFW content, summarize briefly (what happened and why it mattered) — never a blow-by-blow.`;

    const excerptMsg = `CHAT EXCERPT BETWEEN "${user}" AND "${character}" — reference material for the summary below, NOT something to continue:
---
${chatHistoryText}
---`;

    const reminderMsg = `Reminder: do not continue the scene above and do not write a new line of dialogue or narration as ${character}. Your only task right now is to produce the [MEMORY ENTRY] block described in the system instructions, summarizing the excerpt above. ${THINKING_DISCIPLINE}`;

    return [
        { role: 'system', content: systemMsg },
        { role: 'user', content: excerptMsg },
        { role: 'user', content: reminderMsg },
    ];
}

function buildMergePrompt(entryA, entryB) {
    const character = getCurrentCharacterName();
    const systemMsg = `[MEMORY CONSOLIDATION SYSTEM]

You are assisting with memory consolidation for the character "${character}". This is NOT a roleplay turn.

Combine the two memory entries given below into ONE entry in the same format. Preserve all distinct Key Events, Conversations, and Fragments; drop only true duplicates. Keep the narrative in the same voice and point of view as the originals. Choose the earlier entry's date.

Use real names in your output ("${character}", "${user}"). If either source entry contains the literal placeholder text "{{char}}" or "{{user}}" instead of a real name, replace it with the correct real name in your output — don't reproduce the placeholder.

${THINKING_DISCIPLINE}

Output EXACTLY one [MEMORY ENTRY] ... [END MEMORY ENTRY] block in the same structure as the originals, and nothing else.`;

    const entriesMsg = `ENTRY A:
---
${entryA.content}
---

ENTRY B:
---
${entryB.content}
---`;

    const reminderMsg = `Reminder: do not roleplay as ${character}. Your only task right now is to output the single merged [MEMORY ENTRY] block described in the system instructions. ${THINKING_DISCIPLINE}`;

    return [
        { role: 'system', content: systemMsg },
        { role: 'user', content: entriesMsg },
        { role: 'user', content: reminderMsg },
    ];
}

function buildRewritePrompt(entry) {
    const character = getCurrentCharacterName();
    const systemMsg = `[MEMORY REWRITE SYSTEM]

You are assisting with cleaning up an existing memory entry for the character "${character}". This is NOT a roleplay turn.

Rewrite the entry given below in the exact same format, improving clarity and prose quality. Preserve all factual content — every Key Event, Conversation, and Fragment must still be present in some form. Do not add new information, do not remove information, and do not change the date/time line.

Use real names in your output ("${character}", "${user}"). If the source entry contains the literal placeholder text "{{char}}" or "{{user}}" instead of a real name, replace it with the correct real name in your output — don't reproduce the placeholder.

${THINKING_DISCIPLINE}

Output EXACTLY one [MEMORY ENTRY] ... [END MEMORY ENTRY] block in the same structure as the original, and nothing else.`;

    const entryMsg = `EXISTING ENTRY:
---
${entry.content}
---`;

    const reminderMsg = `Reminder: do not roleplay as ${character}. Your only task right now is to output the rewritten [MEMORY ENTRY] block described in the system instructions. ${THINKING_DISCIPLINE}`;

    return [
        { role: 'system', content: systemMsg },
        { role: 'user', content: entryMsg },
        { role: 'user', content: reminderMsg },
    ];
}

// =====================================================================
// OUTPUT CLEANUP + SHAPE VALIDATION
// =====================================================================

function stripThinkBlocks(text) {
    return String(text || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .replace(/<think(?:ing)?>[\s\S]*$/i, '')
        .trim();
}

/**
 * Cuts everything before "[MEMORY ENTRY]" and everything after
 * "[END MEMORY ENTRY]" — models often preface the entry with chatter
 * ("I'll analyze the excerpt...") or add a sign-off after it. If the
 * header hasn't appeared yet (still streaming, or a full refusal), the
 * text is returned unchanged so callers can tell the difference.
 */
function cutToMemoryEntry(text) {
    const str = String(text || '');
    const startMatch = str.match(/\[MEMORY ENTRY\]/i);
    if (!startMatch) return str;
    let out = str.slice(startMatch.index);
    const endMatch = out.match(/\[END MEMORY ENTRY\]/i);
    if (endMatch) out = out.slice(0, endMatch.index + endMatch[0].length);
    return out.trim();
}

function validateLTMShape(draft) {
    const trimmed = stripThinkBlocks(draft);
    if (!trimmed) return { ok: false, reason: 'empty output' };
    if (trimmed.length < 100) return { ok: false, reason: 'output too short' };
    if (!/\[MEMORY ENTRY\]/i.test(trimmed)) return { ok: false, reason: 'missing [MEMORY ENTRY] header' };
    if (!/\bMEMORY:/i.test(trimmed)) return { ok: false, reason: 'missing MEMORY section' };
    if (/^(i (can'?t|cannot|won'?t|am unable)|i'?m sorry)/i.test(trimmed)) {
        return { ok: false, reason: 'model refused' };
    }
    return { ok: true };
}

function extractTitleFromDraft(text) {
    const m = String(text || '').match(/^#\s+(.+)$/m);
    return m ? m[1].trim().replace(/[\[\]]/g, '') : '(untitled LTM)';
}

/**
 * Priority order for what to save as an entry's title:
 * 1. The dedicated title input, if the user typed something in it.
 * 2. The "# Title" line parsed out of the body text.
 * 3. Whatever title the entry already had (editing an existing entry
 *    without touching either of the above shouldn't blank its title).
 * 4. "(untitled LTM)" as an absolute fallback.
 */
function resolveTitleForSave(text, fallbackTitle) {
    const manual = titleInputEl()?.value.trim();
    if (manual) return manual;
    const parsed = extractTitleFromDraft(text);
    if (parsed !== '(untitled LTM)') return parsed;
    return fallbackTitle || '(untitled LTM)';
}

/** The bracketed date/time line directly under [MEMORY ENTRY] — see buildLTMPrompt. */
function extractDateFromDraft(text) {
    const m = String(text || '').match(/\[MEMORY ENTRY\]\s*\n+\s*\[([^\]]+)\]/i);
    return m ? m[1].trim() : '';
}

function displayName(text) {
    return String(text || '')
        .replace(/\{\{char\}\}/gi, getCurrentCharacterName())
        .replace(/\{\{user\}\}/gi, getUserName());
}

// =====================================================================
// GENERATION — raw ChatCompletionService call
// =====================================================================

/**
 * @param {{role:string, content:string}[]} messages
 * @param {boolean} stream
 */
function buildRequestPayload(messages, stream) {
    const source = getCurrentSource();
    const payload = {
        stream,
        messages,
        model: resolveGenerationModel(),
        chat_completion_source: source,
        max_tokens: Number(settings.maxResponseTokens) || 2000,
        // Ask the API to keep extended thinking minimal where the source
        // supports it (OpenAI-family, OpenRouter, xAI, etc.) — cuts down on
        // the "thinks for a while then stops without ever writing the entry"
        // failure mode. Harmless no-op on sources that don't honor it.
        reasoning_effort: 'min',
    };
    // No model resolvable — let the backend/provider use its default rather
    // than sending an empty string.
    if (!payload.model) delete payload.model;
    // Pass through connection details the backend needs for certain sources.
    if (source === 'custom' && oai_settings?.custom_url) payload.custom_url = oai_settings.custom_url;
    if (oai_settings?.reverse_proxy) {
        payload.reverse_proxy = oai_settings.reverse_proxy;
        payload.proxy_password = oai_settings.proxy_password || '';
    }
    return payload;
}

async function generateDraft(job) {
    job.status = 'generating';
    job.draft = '';
    job.error = undefined;
    job.abort = new AbortController();
    updateChip();
    refreshSidebar();
    setEditorGenerating(job, true);

    const messages = job.messagesOverride
        ?? buildLTMPrompt(
            collectChatRange(job.range.firstMessageId, job.range.lastMessageId),
            extractTimelineFromRange(job.range.firstMessageId, job.range.lastMessageId),
        );

    try {
        const service = SillyTavern.getContext().ChatCompletionService;
        if (!service) throw new Error('ChatCompletionService not available in this SillyTavern version');

        const payload = buildRequestPayload(messages, !!settings.streamDrafts);
        // Messages logged in full on purpose — this is exactly what gets sent
        // to the model, and that's the point of debug mode. proxy_password is
        // redacted so a pasted console log can't leak it by accident.
        ltmLog('generation payload', { ...payload, proxy_password: payload.proxy_password ? '(redacted)' : undefined });

        const result = await service.processRequest(payload, {}, true, job.abort.signal);

        if (typeof result === 'function') {
            // Streaming: result is an async generator factory.
            for await (const chunk of result()) {
                const stripped = stripThinkBlocks(chunk.text ?? '');
                const headerSeen = /\[MEMORY ENTRY\]/i.test(stripped);
                job.draft = cutToMemoryEntry(stripped);
                // Hide any preamble chatter entirely until the model actually
                // reaches the [MEMORY ENTRY] header — don't flash it in the editor.
                streamIntoEditor(job.id, headerSeen ? job.draft : '…composing memory…');
            }
        } else {
            job.draft = cutToMemoryEntry(stripThinkBlocks(result?.content ?? ''));
        }

        const check = validateLTMShape(job.draft);
        if (!check.ok) {
            job.status = 'failed';
            job.error = check.reason;
            toast('warning', `LTM draft failed validation: ${check.reason}`);
        } else {
            job.status = 'ready';
            toast('success', 'LTM draft ready for review');
        }
    } catch (err) {
        if (job.abort?.signal?.aborted) {
            job.status = 'failed';
            job.error = 'stopped by user';
        } else {
            job.status = 'failed';
            job.error = String(err?.error?.message ?? err?.message ?? err);
            ltmWarn('generation failed', err);
            toast('error', `LTM generation failed: ${job.error}`);
        }
    } finally {
        job.finishedAt = Date.now();
        job.abort = undefined;
        setEditorGenerating(job, false);
        updateChip();
        refreshSidebar();
        if (selectedRef.current?.kind === 'job' && selectedRef.current.job.id === job.id) {
            selectJob(job); // refresh title/buttons/draft
        }
    }
}

// =====================================================================
// LOREBOOK IO
// =====================================================================

const LTM_MARKER_PREFIX = 'ltm:'; // new entries: automationId = "ltm:<uuid>"

// Mirrors ST's own `/getchatbook` naming convention exactly (same sanitize
// regex, same "Chat Book <id>" pattern) so that a chat that already has a
// bound lorebook — from the old STscript pipeline, or from the user
// manually attaching one — gets reused instead of a second book getting
// created alongside it.
async function getOrCreateChatBookName() {
    const c = SillyTavern.getContext();
    const meta = c.chatMetadata;
    if (meta[METADATA_KEY] && Array.isArray(world_names) && world_names.includes(meta[METADATA_KEY])) {
        return meta[METADATA_KEY];
    }
    if (!c.chatId) throw new Error('Open a chat first');
    const name = `Chat Book ${c.chatId}`.replace(/[^a-z0-9]/gi, '_').replace(/_{2,}/g, '_').substring(0, 64);
    await createNewWorldInfo(name);
    meta[METADATA_KEY] = name;
    await c.saveMetadata();
    document.querySelectorAll('.chat_lorebook_button').forEach(el => el.classList.add('world_set'));
    return name;
}

function getChatBookNameIfExists() {
    const meta = SillyTavern.getContext().chatMetadata;
    const name = meta?.[METADATA_KEY];
    return (name && Array.isArray(world_names) && world_names.includes(name)) ? name : null;
}

// Backward-compat detection for entries created by the old STscript pipeline
function entryLooksLikeLTM(entry) {
    const autoId = String(entry.automationId ?? '');
    if (autoId.startsWith(LTM_MARKER_PREFIX)) return true;
    if (/^\d+$/.test(autoId)) {
        return /MEMORY ENTRY|LTM/i.test(entry.comment || '') || /MEMORY:/i.test(entry.content || '');
    }
    return false;
}

async function readAllLTMEntries() {
    const bookName = getChatBookNameIfExists();
    if (!bookName) return [];
    let book;
    try {
        book = await loadWorldInfo(bookName);
    } catch (err) {
        ltmWarn('loadWorldInfo failed', err);
        return [];
    }
    if (!book?.entries) return [];

    const out = [];
    for (const entry of Object.values(book.entries)) {
        if (!entryLooksLikeLTM(entry)) continue;
        out.push({
            uid: entry.uid,
            automationId: String(entry.automationId ?? ''),
            title: (entry.comment || extractTitleFromDraft(entry.content) || '(untitled LTM)'),
            date: extractDateFromDraft(entry.content),
            content: entry.content || '',
            constant: !!entry.constant,
            vectorized: !!entry.vectorized,
            disabled: !!entry.disable,
            pinned: !!entry.wlmPinned,
            order: entry.order ?? 0,
            legacy: !String(entry.automationId ?? '').startsWith(LTM_MARKER_PREFIX),
            sourceRange: entry.wlmSourceRange || null,
        });
    }
    out.sort((a, b) => a.order - b.order);
    return out;
}

/**
 * Combines two entries' source ranges into the span that covers both —
 * used when saving a merged entry so it can still be "regenerated from
 * source" later instead of only ever being rewrite-polished.
 */
function unionSourceRange(a, b) {
    if (!a || !b) return null;
    return {
        firstMessageId: Math.min(a.firstMessageId, b.firstMessageId),
        lastMessageId: Math.max(a.lastMessageId, b.lastMessageId),
    };
}

/**
 * Create or update an LTM lorebook entry. Returns the uid.
 * `sourceRange`, when given, is the original chat message span this memory
 * was summarized from — stored so a later reroll can regenerate from the
 * real conversation instead of just rewriting the saved text. Passing null
 * leaves whatever's already on the entry untouched (a plain text edit
 * shouldn't erase a previously-recorded source range).
 */
async function saveLTMEntry({ uid = null, title, content, pinned = false, sourceRange = null }) {
    const bookName = await getOrCreateChatBookName();
    const book = await loadWorldInfo(bookName);
    if (!book) throw new Error(`Could not load lorebook "${bookName}"`);

    let entry;
    if (uid !== null && book.entries[uid]) {
        entry = book.entries[uid];
    } else {
        entry = createWorldInfoEntry(bookName, book);
        if (!entry) throw new Error('Could not create a new lorebook entry');
        entry.automationId = `${LTM_MARKER_PREFIX}${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
        // Highest order so newest memories sort last (chronological).
        const maxOrder = Math.max(0, ...Object.values(book.entries).map(e => e.order ?? 0));
        entry.order = maxOrder + 1;
        entry.constant = true;
        entry.position = 0; // world_info_position.before === 0 → "before_char" (confirmed against world-info.js:3241)
        entry.preventRecursion = true;
        entry.addMemo = true;
    }

    entry.comment = title;
    entry.content = content;
    entry.disable = false;
    entry.wlmPinned = !!pinned;
    if (sourceRange) entry.wlmSourceRange = sourceRange;

    await saveWorldInfo(bookName, book, true);
    return entry.uid;
}

async function deleteLTMEntry(uid) {
    const bookName = getChatBookNameIfExists();
    if (!bookName) return;
    const book = await loadWorldInfo(bookName);
    if (!book?.entries?.[uid]) return;
    delete book.entries[uid];
    await saveWorldInfo(bookName, book, true);
}

/**
 * Keep the newest `activeLTMCount` unpinned LTMs constant-loaded; demote
 * the rest to vectorized. Pinned entries always stay constant.
 */
async function demoteExcessLTMs() {
    const bookName = getChatBookNameIfExists();
    if (!bookName) return;
    const book = await loadWorldInfo(bookName);
    if (!book?.entries) return;

    // Sorted oldest-first (ascending `order`, which is assigned incrementally
    // at creation time — see saveLTMEntry). That means the FRONT of this
    // array is the oldest unpinned entries and the TAIL is the most recent —
    // `.slice(0, N)` below is "everything except the newest keepCount",
    // i.e. the ones to demote.
    const ltms = Object.values(book.entries)
        .filter(entryLooksLikeLTM)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const unpinned = ltms.filter(e => !e.wlmPinned);
    const keepCount = Math.max(0, Number(settings.activeLTMCount) || 3);
    const demote = unpinned.slice(0, Math.max(0, unpinned.length - keepCount));
    const promote = unpinned.slice(Math.max(0, unpinned.length - keepCount));

    let changed = false;
    for (const e of demote) {
        if (!e.vectorized || e.constant) { e.vectorized = true; e.constant = false; changed = true; }
    }
    for (const e of [...promote, ...ltms.filter(x => x.wlmPinned)]) {
        if (e.vectorized || !e.constant) { e.vectorized = false; e.constant = true; changed = true; }
    }
    if (changed) {
        await saveWorldInfo(bookName, book, true);
        ltmLog('demotion pass complete', { demoted: demote.length });
    }
}

// =====================================================================
// DRAFT PERSISTENCE
// =====================================================================

function saveDraftState(chatId, text) {
    if (!text || !text.trim()) { discardDraftState(chatId); return; }
    settings.__drafts[chatId] = { text, savedAt: Date.now() };
    persistSettings();
}

function loadDraftState(chatId) {
    return settings.__drafts?.[chatId] ?? null;
}

function discardDraftState(chatId) {
    if (settings.__drafts?.[chatId]) {
        delete settings.__drafts[chatId];
        persistSettings();
    }
}

// =====================================================================
// VERSION HISTORY
// =====================================================================

function pushVersion(job) {
    const check = validateLTMShape(job.draft);
    if (!check.ok) return; // never archive garbage
    job.versions.push(job.draft);
    while (job.versions.length > (Number(settings.maxVersionsPerEntry) || 10)) job.versions.shift();
    renderVersionPicker(job);
}

function renderVersionPicker(job) {
    const picker = /** @type {HTMLSelectElement} */ (document.getElementById('wlm-version-picker'));
    if (!picker) return;
    if (!job || !job.versions.length) { picker.style.display = 'none'; return; }
    picker.style.display = '';
    picker.innerHTML = '<option value="current">Current draft</option>' + job.versions
        .map((_, i) => `<option value="${i}">Version ${i + 1}</option>`)
        .join('');
    picker.value = 'current';
}

// =====================================================================
// UI — NOTIFICATION CHIP
// =====================================================================

const CHIP_ID = 'wlm-chip';

function ensureChip() {
    if (document.getElementById(CHIP_ID)) return;
    const chip = document.createElement('div');
    chip.id = CHIP_ID;
    chip.className = 'wlm-chip wlm-chip-hidden';
    chip.title = 'Weyland-LTM';
    chip.addEventListener('click', () => openPanel());
    document.body.appendChild(chip);
}

function setChip(text, kind) {
    ensureChip();
    const chip = document.getElementById(CHIP_ID);
    chip.textContent = text;
    chip.dataset.kind = kind;
    chip.classList.remove('wlm-chip-hidden');
}

function hideChip() {
    document.getElementById(CHIP_ID)?.classList.add('wlm-chip-hidden');
}

// Priority order matters here (checked top to bottom, first match wins):
// an in-flight generation is the most actionable thing to tell the user
// about, then a ready draft, then a failure, and only if none of those
// apply do we fall back to the passive "you might want to make one of
// these" nudge. Doesn't matter how stale the suggestion is — an active job
// always takes precedence over it.
function updateChip() {
    if (!settings.enabled) return hideChip();
    const chatJobs = getJobsForChat(getCurrentChatId());
    const ready = chatJobs.filter(j => j.status === 'ready').length;
    const failed = chatJobs.filter(j => j.status === 'failed').length;
    const generating = chatJobs.filter(j => j.status === 'generating').length;

    if (generating) return setChip('🧠 LTM generating…', 'info');
    if (ready) return setChip(`📝 ${ready} LTM draft${ready > 1 ? 's' : ''} ready`, 'ready');
    if (failed) return setChip('⚠️ LTM failed — click to reroll', 'error');
    const chat = SillyTavern.getContext().chat || [];
    if (settings.suggestLTMs && (chat.length - 1) >= getEffectiveGoal()) {
        return setChip('💭 Time for an LTM?', 'suggest');
    }
    hideChip();
}

// =====================================================================
// UI — MODAL PANEL
// =====================================================================

const MODAL_ID = 'wlm-modal-overlay';

function buildModalHtml() {
    return `
<div id="${MODAL_ID}" style="display:none; position:fixed; inset:0; z-index:99990; pointer-events:none;">
  <div id="wlm-modal">
    <div id="wlm-titlebar">
      <span class="wlm-title">🧠 Long-Term Memory</span>
      <div class="wlm-titlebar-actions">
        <button id="wlm-settings-btn" title="Open LTM settings — model, cadence, point of view, and more">LTM Settings ⚙</button>
        <button id="wlm-close-btn" title="Close">✕</button>
      </div>
    </div>
    <div id="wlm-body">
      <div id="wlm-sidebar">
        <div class="wlm-sidebar-actions">
          <button id="wlm-new-btn" class="wlm-btn-primary" title="Generate a new LTM from recent messages">+ New LTM</button>
          <button id="wlm-merge-btn" class="wlm-btn-sm" disabled title="Check two entries below, then merge them">Merge</button>
          <button id="wlm-bulk-delete-btn" class="wlm-btn-sm wlm-btn-danger" disabled title="Check one or more entries below, then delete them">🗑 Delete Selected</button>
        </div>
        <div id="wlm-progress-row">
          <span id="wlm-progress-text">— / —</span>
          <input id="wlm-goal-input" type="number" min="0" style="display:none" title="Message # to make the next LTM at" />
          <button id="wlm-goal-edit-btn" class="wlm-btn-sm" title="Set an exact message # for the next LTM">✎</button>
          <button id="wlm-goal-reset-btn" class="wlm-btn-sm" style="display:none" title="Reset to the default cadence">↺</button>
        </div>
        <div id="wlm-entry-list"></div>
      </div>
      <div id="wlm-editor">
        <div id="wlm-editor-header">
          <button id="wlm-mobile-expand-btn" class="wlm-btn-sm wlm-mobile-only" title="Expand the editor to use most of the screen">⤢</button>
          <span id="wlm-editor-title">No entry selected</span>
          <div class="wlm-editor-meta">
            <span id="wlm-token-count"></span>
            <select id="wlm-version-picker" style="display:none" title="Browse previous reroll attempts for this draft"></select>
          </div>
        </div>
        <input id="wlm-title-input" type="text" placeholder="Memory title" style="display:none" title="Rename this memory. Overrides whatever '# Title' line is in the text below." />
        <textarea id="wlm-editor-body" spellcheck="false" placeholder="Select an LTM from the sidebar, or hit '+ New LTM' to generate a draft from your recent messages."></textarea>
        <div id="wlm-editor-actions">
          <span id="wlm-editor-status"></span>
          <button id="wlm-stop-btn" class="wlm-btn-sm wlm-btn-danger" style="display:none" title="Cancel the current generation">■ Stop</button>
          <button id="wlm-reroll-btn" class="wlm-btn-sm" disabled title="Generate a new attempt. For a saved entry, regenerates from the original messages if known, otherwise rewrites the existing text.">🔁 Reroll</button>
          <button id="wlm-pin-btn" class="wlm-btn-sm" disabled title="Keep this memory permanently loaded — pinned entries are never demoted to vectorized-only.">📌 Pin</button>
          <button id="wlm-delete-btn" class="wlm-btn-sm wlm-btn-danger" disabled title="Delete this memory permanently.">🗑 Delete</button>
          <button id="wlm-save-btn" class="wlm-btn-primary" disabled title="Save this draft/edit to the character's memory.">💾 Save</button>
        </div>
      </div>
      <div id="wlm-settings-pane" style="display:none">
        <h3>Settings</h3>
        <label class="wlm-field wlm-check" title="Turn off to silence the memory chip entirely — no draft-ready, failed, or suggestion notifications will appear.">
          <input id="wlm-set-enabled" type="checkbox" />
          <span>Enable LTM notifications <small>(drafts ready/failed, and suggestions below)</small></span>
        </label>
        <label class="wlm-field" title="Model ID used only for LTM calls — never affects your actual chat connection. Leave blank to use whatever model your chat is currently connected to.">
          <span>Model for LTM generation <small>(blank = current chat model)</small></span>
          <div class="wlm-inline">
            <input id="wlm-set-model" type="text" placeholder="${getCurrentModelId() || 'model id'}" />
            <button id="wlm-use-current-model" class="wlm-btn-sm" title="Copy the active chat model">Use current</button>
          </div>
          <div class="wlm-recommend-row">
            <span class="wlm-recommend-label">Recommended LTM Model:</span>
            <button class="wlm-btn-sm wlm-model-quickfill" data-model="${RECOMMENDED_LTM_MODEL}" title="Fill the field above with ${RECOMMENDED_LTM_MODEL}">${RECOMMENDED_LTM_MODEL}</button>
            ${ALTERNATE_LTM_MODELS.map(m => `<button class="wlm-btn-sm wlm-model-quickfill" data-model="${m}" title="Fill the field above with ${m}">${m}</button>`).join('')}
          </div>
          <small class="wlm-recommend-disclaimer">Lucky does not recommend Sonnet for LTM generation. Instead, use glm-4.7-thinking and gemini-3-pro-preview whenever possible. This ensures our Sonnet supply is used for actual messaging rather than LTM requests.</small>
        </label>
        <label class="wlm-field" title="How many new messages should pass before the 'Time for an LTM?' reminder chip appears. Also sets the default range size for a new draft.">
          <span>Suggest an LTM every N messages</span>
          <input id="wlm-set-cadence" type="number" min="10" step="10" />
        </label>
        <label class="wlm-field" title="How many recent memories stay permanently loaded in context at once. Older ones switch to semantic-search-only (vectorized) instead of disappearing — pinned memories are always exempt.">
          <span>Active (always-loaded) LTMs — older ones get vectorized <small>(recommended: 3)</small></span>
          <input id="wlm-set-active" type="number" min="0" step="1" />
        </label>
        <label class="wlm-field" title="Generation budget for a single LTM call. Raise this if drafts are getting cut off mid-entry.">
          <span>Max response tokens</span>
          <input id="wlm-set-maxtokens" type="number" min="500" step="100" />
        </label>
        <label class="wlm-field wlm-check" title="Show the draft appearing token-by-token as it generates, instead of waiting silently for the full response.">
          <input id="wlm-set-stream" type="checkbox" />
          <span>Stream drafts into the editor</span>
        </label>
        <label class="wlm-field wlm-check" title="A gentle nudge chip that appears once enough new messages have piled up since the last saved memory.">
          <input id="wlm-set-suggest" type="checkbox" />
          <span>Show "Time for an LTM?" reminders</span>
        </label>
        <label class="wlm-field" title="Controls whether memories are written as the character's own diary entry (1st person) or as a neutral, uncharacterized account (3rd person).">
          <span>Narrative point of view</span>
          <select id="wlm-set-povmode">
            <option value="auto">Auto — reads the character card's tag, else 1st person</option>
            <option value="first">Force 1st person — diary entry, in character's voice</option>
            <option value="third">Force 3rd person — plain narrator, no characterization</option>
          </select>
          <small>"Auto" uses each character's built-in memory style, preconfigured by the Weyland team — most characters journal in 1st person; multi-character casts use a neutral narrator. Pick a forced option only if you want to override that for everyone.</small>
        </label>
        <label class="wlm-field wlm-check" title="For troubleshooting — only enable if asked to.">
          <input id="wlm-set-debug" type="checkbox" />
          <span>Debug</span>
        </label>
        <div class="wlm-settings-actions">
          <button id="wlm-settings-back" class="wlm-btn-primary">← Back to editor</button>
        </div>
      </div>
    </div>
  </div>
</div>`;
}

let modalInjected = false;

function injectModal() {
    if (modalInjected && document.getElementById(MODAL_ID)) return;
    document.getElementById(MODAL_ID)?.remove();
    document.body.insertAdjacentHTML('beforeend', buildModalHtml());
    modalInjected = true;

    document.getElementById('wlm-close-btn').addEventListener('click', closePanel);
    document.getElementById('wlm-settings-btn').addEventListener('click', () => toggleSettingsView());
    document.getElementById('wlm-settings-back').addEventListener('click', () => toggleSettingsView(false));
    document.getElementById('wlm-new-btn').addEventListener('click', onNewLTMClicked);
    document.getElementById('wlm-merge-btn').addEventListener('click', onMergeClicked);
    document.getElementById('wlm-bulk-delete-btn').addEventListener('click', onBulkDeleteClicked);
    document.getElementById('wlm-stop-btn').addEventListener('click', onStopClicked);
    document.getElementById('wlm-reroll-btn').addEventListener('click', onRerollClicked);
    document.getElementById('wlm-pin-btn').addEventListener('click', onPinToggleClicked);
    document.getElementById('wlm-delete-btn').addEventListener('click', onDeleteClicked);
    document.getElementById('wlm-save-btn').addEventListener('click', onSaveClicked);
    document.getElementById('wlm-editor-body').addEventListener('input', onEditorChanged);
    document.getElementById('wlm-version-picker').addEventListener('change', onVersionPicked);
    document.getElementById('wlm-use-current-model').addEventListener('click', () => {
        const input = /** @type {HTMLInputElement} */ (document.getElementById('wlm-set-model'));
        input.value = getCurrentModelId();
        input.dispatchEvent(new Event('change'));
    });
    // One handler for the recommended model + every alternate quick-fill button.
    document.querySelectorAll('.wlm-model-quickfill').forEach((quickfillBtn) => {
        quickfillBtn.addEventListener('click', () => {
            const input = /** @type {HTMLInputElement} */ (document.getElementById('wlm-set-model'));
            input.value = /** @type {HTMLElement} */ (quickfillBtn).dataset.model;
            input.dispatchEvent(new Event('change'));
        });
    });
    document.getElementById('wlm-goal-edit-btn').addEventListener('click', beginGoalEdit);
    document.getElementById('wlm-goal-input').addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') commitGoalEdit();
        if (ev.key === 'Escape') cancelGoalEdit();
    });
    document.getElementById('wlm-goal-input').addEventListener('blur', commitGoalEdit);
    document.getElementById('wlm-goal-reset-btn').addEventListener('click', () => {
        clearGoalOverride(getCurrentChatId());
        renderProgress();
        updateChip();
    });
    document.getElementById('wlm-mobile-expand-btn').addEventListener('click', toggleMobileExpand);

    // Settings inputs → live-save on change
    bindSetting('wlm-set-model', 'modelOverride', v => String(v || '').trim());
    bindSetting('wlm-set-cadence', 'messagesBetweenLTMs', v => Math.max(10, Number(v) || 100));
    bindSetting('wlm-set-active', 'activeLTMCount', v => Math.max(0, Number(v) || 3));
    bindSetting('wlm-set-maxtokens', 'maxResponseTokens', v => Math.max(500, Number(v) || 2000));
    bindSetting('wlm-set-stream', 'streamDrafts', null, true);
    bindSetting('wlm-set-suggest', 'suggestLTMs', null, true);
    bindSetting('wlm-set-debug', 'debug', null, true);
    bindSetting('wlm-set-enabled', 'enabled', null, true);
    bindSetting('wlm-set-povmode', 'povMode', v => (['first', 'third'].includes(v) ? v : 'auto'));
    document.getElementById('wlm-set-enabled').addEventListener('change', () => updateChip());
    document.getElementById('wlm-set-cadence').addEventListener('change', () => { renderProgress(); updateChip(); });

    setupDragging();

    // Escape closes
    document.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape') return;
        const overlay = document.getElementById(MODAL_ID);
        if (overlay && overlay.style.display !== 'none') closePanel();
    });
}

function bindSetting(elId, key, transform, isCheckbox = false) {
    const el = /** @type {HTMLInputElement} */ (document.getElementById(elId));
    if (!el) return;
    el.addEventListener('change', () => {
        settings[key] = isCheckbox ? el.checked : (transform ? transform(el.value) : el.value);
        persistSettings();
        ltmLog(`setting ${key} =`, settings[key]);
    });
}

function loadSettingsIntoForm() {
    const set = (id, val) => { const el = /** @type {HTMLInputElement} */ (document.getElementById(id)); if (el) el.value = String(val); };
    const check = (id, val) => { const el = /** @type {HTMLInputElement} */ (document.getElementById(id)); if (el) el.checked = !!val; };
    set('wlm-set-model', settings.modelOverride || '');
    set('wlm-set-cadence', settings.messagesBetweenLTMs);
    set('wlm-set-active', settings.activeLTMCount);
    set('wlm-set-maxtokens', settings.maxResponseTokens);
    check('wlm-set-stream', settings.streamDrafts);
    check('wlm-set-suggest', settings.suggestLTMs);
    check('wlm-set-debug', settings.debug);
    check('wlm-set-enabled', settings.enabled);
    set('wlm-set-povmode', settings.povMode || 'auto');
}

/**
 * Progress readout in the sidebar — "current / goal" messages, mirroring
 * the old system's "LTM Progress X/Y" display, plus an editable override.
 */
function renderProgress() {
    const textEl = document.getElementById('wlm-progress-text');
    if (!textEl) return;
    const chatId = getCurrentChatId();
    const chat = SillyTavern.getContext().chat || [];
    const current = Math.max(0, chat.length - 1);
    const goal = getEffectiveGoal(chatId);
    textEl.textContent = `${current} / ${goal} messages`;
    const hasOverride = Number.isInteger(settings.__chatState[chatId]?.goalOverride);
    const resetBtn = document.getElementById('wlm-goal-reset-btn');
    if (resetBtn) resetBtn.style.display = hasOverride ? '' : 'none';
}

function beginGoalEdit() {
    const textEl = document.getElementById('wlm-progress-text');
    const input = /** @type {HTMLInputElement} */ (document.getElementById('wlm-goal-input'));
    if (!textEl || !input) return;
    input.value = String(getEffectiveGoal(getCurrentChatId()));
    input.style.display = '';
    textEl.style.display = 'none';
    input.focus();
    input.select();
}

function commitGoalEdit() {
    const textEl = document.getElementById('wlm-progress-text');
    const input = /** @type {HTMLInputElement} */ (document.getElementById('wlm-goal-input'));
    if (!input || input.style.display === 'none') return; // already committed/cancelled
    const val = Number(input.value);
    if (Number.isFinite(val) && val >= 0) setGoalOverride(getCurrentChatId(), val);
    input.style.display = 'none';
    textEl.style.display = '';
    renderProgress();
    updateChip();
}

function cancelGoalEdit() {
    const textEl = document.getElementById('wlm-progress-text');
    const input = document.getElementById('wlm-goal-input');
    if (!input || !textEl) return;
    input.style.display = 'none';
    textEl.style.display = '';
}

function toggleSettingsView(force) {
    const editor = document.getElementById('wlm-editor');
    const pane = document.getElementById('wlm-settings-pane');
    const showSettings = force !== undefined ? force : pane.style.display === 'none';
    if (showSettings) loadSettingsIntoForm();
    pane.style.display = showSettings ? 'flex' : 'none';
    editor.style.display = showSettings ? 'none' : 'flex';
}

// Mobile-only (see the `.wlm-mobile-only` / `.wlm-mobile-expanded` rules in
// style.css, scoped inside `@media (max-width: 700px)`). Below that width
// the panel stacks list-on-top, editor-on-bottom instead of side-by-side —
// there isn't enough width for two columns, but a half-height editor is
// still cramped for actually reading/writing a memory, hence this toggle to
// temporarily give the editor most of the screen and collapse the list
// down to just its action buttons.
function toggleMobileExpand() {
    const modal = document.getElementById('wlm-modal');
    const btn = document.getElementById('wlm-mobile-expand-btn');
    const expanded = modal.classList.toggle('wlm-mobile-expanded');
    btn.textContent = expanded ? '⤡' : '⤢';
    btn.title = expanded ? 'Shrink the editor back down' : 'Expand the editor to use most of the screen';
}

/** No-op outside the mobile breakpoint — see toggleMobileExpand. */
function autoExpandEditorOnMobile() {
    if (!window.matchMedia('(max-width: 700px)').matches) return;
    document.getElementById('wlm-modal')?.classList.add('wlm-mobile-expanded');
    const btn = document.getElementById('wlm-mobile-expand-btn');
    if (btn) { btn.textContent = '⤡'; btn.title = 'Shrink the editor back down'; }
}

function setupDragging() {
    const modal = document.getElementById('wlm-modal');
    const titlebar = document.getElementById('wlm-titlebar');
    let dragging = false, offX = 0, offY = 0;

    titlebar.addEventListener('mousedown', (ev) => {
        if (/** @type {HTMLElement} */ (ev.target).closest('button')) return;
        dragging = true;
        const rect = modal.getBoundingClientRect();
        offX = ev.clientX - rect.left;
        offY = ev.clientY - rect.top;
        ev.preventDefault();
    });
    window.addEventListener('mousemove', (ev) => {
        if (!dragging) return;
        const W = modal.offsetWidth, H = modal.offsetHeight;
        const newLeft = Math.min(Math.max(0, ev.clientX - offX), window.innerWidth - Math.min(W, 120));
        const newTop = Math.min(Math.max(0, ev.clientY - offY), window.innerHeight - 40);
        modal.style.left = newLeft + 'px';
        modal.style.top = newTop + 'px';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
}

async function openPanel() {
    injectModal();
    const overlay = document.getElementById(MODAL_ID);
    overlay.style.display = 'block';
    overlay.style.pointerEvents = 'auto';
    toggleSettingsView(false);
    await refreshSidebar();

    const chatId = getCurrentChatId();
    const chatJobs = getJobsForChat(chatId);
    const interesting = chatJobs.find(j => j.status === 'ready')
        ?? chatJobs.find(j => j.status === 'generating')
        ?? chatJobs.find(j => j.status === 'failed');
    if (interesting) {
        selectJob(interesting);
    } else {
        const draft = loadDraftState(chatId);
        if (draft?.text) {
            const job = createJob(chatId, computeRangeFromCurrentChat());
            job.status = 'ready';
            job.draft = draft.text;
            selectJob(job);
            document.getElementById('wlm-editor-title').textContent = 'Restored draft';
            refreshSidebar();
        }
    }
    updateChip();
}

function closePanel() {
    const overlay = document.getElementById(MODAL_ID);
    if (!overlay) return;
    overlay.style.display = 'none';
    overlay.style.pointerEvents = 'none';
    // Persist unsaved editor text so nothing is lost on close.
    if (selectedRef.current?.kind === 'job') {
        const editor = /** @type {HTMLTextAreaElement} */ (document.getElementById('wlm-editor-body'));
        saveDraftState(getCurrentChatId(), editor?.value ?? '');
    }
}

// =====================================================================
// UI — SIDEBAR
// =====================================================================

async function refreshSidebar() {
    const listEl = document.getElementById('wlm-entry-list');
    if (!listEl) return;
    renderProgress();
    listEl.innerHTML = '';
    checkedEntries.clear();
    const mergeBtn = /** @type {HTMLButtonElement} */ (document.getElementById('wlm-merge-btn'));
    if (mergeBtn) mergeBtn.disabled = true;
    const bulkDeleteBtn = /** @type {HTMLButtonElement} */ (document.getElementById('wlm-bulk-delete-btn'));
    if (bulkDeleteBtn) bulkDeleteBtn.disabled = true;

    const chatId = getCurrentChatId();
    for (const job of getJobsForChat(chatId)) {
        const row = document.createElement('div');
        row.className = 'wlm-sidebar-row wlm-row-draft';
        row.textContent = `${statusIcon(job.status)} Draft — ${statusLabel(job.status)}`;
        row.addEventListener('click', () => selectJob(job));
        listEl.appendChild(row);
    }

    let entries = [];
    try {
        entries = await readAllLTMEntries();
    } catch (err) {
        ltmWarn('readAllLTMEntries failed', err);
    }
    entries.forEach((entry, idx) => {
        const row = document.createElement('div');
        row.className = 'wlm-sidebar-row';
        if (entry.legacy) row.title = 'Created by the old LTM system';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'wlm-merge-checkbox';
        checkbox.title = 'Select — check two and hit Merge, or any number and hit Delete Selected';
        checkbox.addEventListener('click', (ev) => ev.stopPropagation());
        checkbox.addEventListener('change', () => setEntryChecked(entry, row, checkbox.checked));

        const label = document.createElement('span');
        label.className = 'wlm-sidebar-row-label';
        label.addEventListener('click', () => selectEntry(entry));

        const titleLine = document.createElement('div');
        titleLine.className = 'wlm-sidebar-row-title';
        titleLine.textContent = `${idx + 1}. ${entry.pinned ? '📌 ' : ''}${entry.vectorized ? '🔍 ' : ''}${displayName(entry.title)}`;
        label.appendChild(titleLine);

        if (entry.date) {
            const dateLine = document.createElement('div');
            dateLine.className = 'wlm-sidebar-row-date';
            dateLine.textContent = entry.date;
            label.appendChild(dateLine);
        }

        row.appendChild(checkbox);
        row.appendChild(label);
        listEl.appendChild(row);
    });

    if (!listEl.children.length) {
        const empty = document.createElement('div');
        empty.className = 'wlm-sidebar-empty';
        empty.textContent = 'No memories yet. Hit + New LTM to create the first one.';
        listEl.appendChild(empty);
    }
}

function statusIcon(status) {
    return { queued: '⏳', generating: '⚡', ready: '📝', failed: '⚠️' }[status] ?? '•';
}

function statusLabel(status) {
    return { queued: 'queued', generating: 'generating…', ready: 'ready to review', failed: 'failed' }[status] ?? status;
}

// =====================================================================
// UI — SELECTION + EDITOR
// =====================================================================

const selectedRef = { current: /** @type {null | {kind:'job',job:LTMJob} | {kind:'entry',entry:any}} */ (null) };
const checkedEntries = new Map(); // uid -> entry, shared by Merge (needs 2) and bulk-Delete (needs 1+)

function editorEl() {
    return /** @type {HTMLTextAreaElement} */ (document.getElementById('wlm-editor-body'));
}

function titleInputEl() {
    return /** @type {HTMLInputElement} */ (document.getElementById('wlm-title-input'));
}

/**
 * Blanks the editor pane back to "nothing selected". Pulled out into one
 * place because 4 call sites (chat switch, delete, save, bulk-delete) all
 * needed the exact same teardown — duplicating it risked them drifting out
 * of sync (e.g. someone adds a new field to the header and forgets to clear
 * it in 3 of the 4 spots).
 */
function clearEditorDisplay() {
    if (!document.getElementById(MODAL_ID)) return; // panel never injected yet
    const editor = editorEl();
    if (editor) editor.value = '';
    const titleEl = document.getElementById('wlm-editor-title');
    if (titleEl) titleEl.textContent = 'No entry selected';
    const titleInput = titleInputEl();
    if (titleInput) { titleInput.value = ''; titleInput.style.display = 'none'; }
    renderVersionPicker(null);
    updateTokenCount('');
    const btn = id => /** @type {HTMLButtonElement} */ (document.getElementById(id));
    if (btn('wlm-reroll-btn')) btn('wlm-reroll-btn').disabled = true;
    if (btn('wlm-pin-btn')) { btn('wlm-pin-btn').disabled = true; btn('wlm-pin-btn').textContent = '📌 Pin'; }
    if (btn('wlm-delete-btn')) btn('wlm-delete-btn').disabled = true;
    if (btn('wlm-save-btn')) btn('wlm-save-btn').disabled = true;
    if (btn('wlm-merge-btn')) btn('wlm-merge-btn').disabled = true;
    if (btn('wlm-stop-btn')) btn('wlm-stop-btn').style.display = 'none';
    const statusEl = document.getElementById('wlm-editor-status');
    if (statusEl) statusEl.textContent = '';
    // Nothing selected → collapse back to the normal split so the list is
    // visible again for picking something else (mobile only; a no-op class
    // toggle above the breakpoint).
    document.getElementById('wlm-modal')?.classList.remove('wlm-mobile-expanded');
    const expandBtn = document.getElementById('wlm-mobile-expand-btn');
    if (expandBtn) { expandBtn.textContent = '⤢'; expandBtn.title = 'Expand the editor to use most of the screen'; }
}

/**
 * Clears the editor pane AND selection state. Must run on every chat
 * switch — otherwise the previous character's draft/entry stays visible
 * in the editor even after the sidebar refreshes to the new chat's list.
 */
function resetEditorSelection() {
    selectedRef.current = null;
    checkedEntries.clear();
    clearEditorDisplay();
}

/**
 * Reveals the dedicated title field and pre-fills it with whatever title
 * is already known — parsed from a "# Title" line for a draft, or the
 * entry's stored title for a saved memory. Left blank (not "(untitled
 * LTM)") when nothing's known yet, so the placeholder text shows instead.
 */
function showTitleInputWith(value) {
    const input = titleInputEl();
    if (!input) return;
    input.style.display = '';
    input.value = (value && value !== '(untitled LTM)') ? value : '';
}

function selectJob(job) {
    selectedRef.current = { kind: 'job', job };
    const title = job.status === 'ready' ? 'Draft — ready to review'
        : job.status === 'failed' ? `Draft — failed (${job.error ?? 'unknown error'})`
        : 'Draft — generating…';
    document.getElementById('wlm-editor-title').textContent = title;
    editorEl().value = job.draft;
    editorEl().readOnly = job.status === 'generating';
    showTitleInputWith(extractTitleFromDraft(job.draft));
    setEditorButtons({ kind: 'job', job });
    renderVersionPicker(job);
    updateTokenCount(job.draft);
    autoExpandEditorOnMobile();
}

function selectEntry(entry) {
    selectedRef.current = { kind: 'entry', entry };
    document.getElementById('wlm-editor-title').textContent = displayName(entry.title) + (entry.legacy ? '  (legacy)' : '');
    // Resolved for display/editing — if this entry was saved during the
    // brief window with the {{char}}/{{user}} bug, editing and re-saving
    // now permanently fixes it (Save writes back whatever's in the textarea).
    const resolvedContent = displayName(entry.content);
    editorEl().value = resolvedContent;
    editorEl().readOnly = false;
    showTitleInputWith(displayName(entry.title));
    setEditorButtons({ kind: 'entry', entry });
    renderVersionPicker(null);
    updateTokenCount(resolvedContent);
    autoExpandEditorOnMobile();
}

function setEditorButtons(sel) {
    const btn = id => /** @type {HTMLButtonElement} */ (document.getElementById(id));
    const generating = sel.kind === 'job' && sel.job.status === 'generating';
    btn('wlm-stop-btn').style.display = generating ? '' : 'none';
    btn('wlm-reroll-btn').disabled = generating;
    btn('wlm-pin-btn').disabled = sel.kind !== 'entry';
    btn('wlm-pin-btn').textContent = sel.kind === 'entry' && sel.entry.pinned ? '📌 Unpin' : '📌 Pin';
    btn('wlm-delete-btn').disabled = generating;
    btn('wlm-save-btn').disabled = generating;
    document.getElementById('wlm-editor-status').textContent =
        sel.kind === 'job' && sel.job.status === 'failed' ? `⚠ ${sel.job.error ?? 'failed'}` : '';
}

function setEditorGenerating(job, generating) {
    if (selectedRef.current?.kind !== 'job' || selectedRef.current.job.id !== job.id) return;
    const editor = editorEl();
    if (!editor) return;
    editor.readOnly = generating;
    editor.classList.toggle('wlm-generating', generating);
    setEditorButtons({ kind: 'job', job });
}

function streamIntoEditor(jobId, text) {
    if (selectedRef.current?.kind !== 'job' || selectedRef.current.job.id !== jobId) return;
    const editor = editorEl();
    if (!editor) return;
    editor.value = text;
    editor.scrollTop = editor.scrollHeight;
    updateTokenCount(text);
}

function onEditorChanged() {
    const text = editorEl().value;
    if (selectedRef.current?.kind === 'job') selectedRef.current.job.draft = text;
    updateTokenCount(text);
}

async function updateTokenCount(text) {
    const el = document.getElementById('wlm-token-count');
    if (!el) return;
    if (!text) { el.textContent = ''; return; }
    try {
        const count = await SillyTavern.getContext().getTokenCountAsync(text);
        el.textContent = `${count} tokens`;
    } catch {
        el.textContent = `~${Math.ceil(text.length / 4)} tokens`;
    }
}

function onVersionPicked(ev) {
    if (selectedRef.current?.kind !== 'job') return;
    const job = selectedRef.current.job;
    const val = /** @type {HTMLSelectElement} */ (ev.target).value;
    if (val === 'current') return;
    const idx = Number(val);
    if (Number.isInteger(idx) && job.versions[idx] !== undefined) {
        // Swap: current draft becomes a version, picked version becomes current.
        const picked = job.versions[idx];
        const current = editorEl().value;
        job.versions[idx] = current;
        job.draft = picked;
        editorEl().value = picked;
        updateTokenCount(picked);
        /** @type {HTMLSelectElement} */ (ev.target).value = 'current';
        toast('info', `Swapped in version ${idx + 1}`);
    }
}

// =====================================================================
// UI — BUTTON HANDLERS
// =====================================================================

async function onNewLTMClicked() {
    const chatId = getCurrentChatId();
    const chat = SillyTavern.getContext().chat || [];
    if (chat.length < 2) { toast('warning', 'Not enough messages to summarize yet'); return; }
    const range = computeRangeFromCurrentChat();
    const job = createJob(chatId, range, { isFreshSummary: true, sourceRangeForSave: range });
    await refreshSidebar();
    selectJob(job);
    generateDraft(job); // async on purpose — user can close the panel and keep chatting
}

function onStopClicked() {
    if (selectedRef.current?.kind !== 'job') return;
    selectedRef.current.job.abort?.abort();
}

async function onRerollClicked() {
    if (selectedRef.current?.kind === 'job') {
        const job = selectedRef.current.job;
        if (job.status === 'generating') return;
        pushVersion(job);
        generateDraft(job);
        return;
    }
    if (selectedRef.current?.kind === 'entry') {
        const entry = selectedRef.current.entry;
        let job;
        if (entry.sourceRange) {
            // The original chat range is known — regenerate from the actual
            // conversation (fixes wrong/hallucinated facts, not just prose).
            // This is what the old system's "Reroll LTM" always did.
            job = createJob(getCurrentChatId(), entry.sourceRange, {
                isFreshSummary: false,
                sourceRangeForSave: entry.sourceRange,
                rewriteTargetUid: entry.uid,
            });
            toast('info', 'Regenerating from the original messages…');
        } else {
            // No known source (legacy or merged entry) — fall back to a
            // rewrite pass on the entry's own saved text.
            job = createJob(getCurrentChatId(), null, {
                messagesOverride: buildRewritePrompt(entry),
                isFreshSummary: false,
                sourceRangeForSave: null,
                rewriteTargetUid: entry.uid,
            });
            toast('info', 'No original source recorded for this entry — rewriting existing text instead');
        }
        await refreshSidebar();
        selectJob(job);
        generateDraft(job);
    }
}

async function onPinToggleClicked() {
    if (selectedRef.current?.kind !== 'entry') return;
    const entry = selectedRef.current.entry;
    try {
        entry.pinned = !entry.pinned;
        await saveLTMEntry({ uid: entry.uid, title: entry.title, content: editorEl().value, pinned: entry.pinned });
        await demoteExcessLTMs();
        toast('success', entry.pinned ? 'Pinned — this memory will always stay loaded' : 'Unpinned');
        await refreshSidebar();
        selectEntry(entry);
    } catch (err) {
        ltmWarn('pin toggle failed', err);
        toast('error', `Could not update entry: ${err?.message ?? err}`);
    }
}

async function onDeleteClicked() {
    if (!selectedRef.current) return;
    if (selectedRef.current.kind === 'job') {
        const job = selectedRef.current.job;
        job.abort?.abort();
        jobs.delete(job.id);
        discardDraftState(job.chatId);
    } else {
        if (!window.confirm('Delete this memory permanently?')) return;
        try {
            await deleteLTMEntry(selectedRef.current.entry.uid);
        } catch (err) {
            ltmWarn('delete failed', err);
            toast('error', `Could not delete: ${err?.message ?? err}`);
            return;
        }
    }
    selectedRef.current = null;
    clearEditorDisplay();
    await refreshSidebar();
    updateChip();
}

async function onSaveClicked() {
    const text = editorEl().value.trim();
    if (!text) { toast('warning', 'Nothing to save'); return; }

    const check = validateLTMShape(text);
    if (!check.ok && !window.confirm(`This doesn't look like a normal LTM (${check.reason}). Save anyway?`)) {
        return;
    }

    try {
        if (selectedRef.current?.kind === 'job') {
            const job = selectedRef.current.job;
            await saveLTMEntry({
                title: resolveTitleForSave(text, null),
                content: text,
                sourceRange: job.sourceRangeForSave ?? null,
            });

            // Merge jobs consume their source entries on successful save.
            if (Array.isArray(job.mergeSourceUids)) {
                for (const uid of job.mergeSourceUids) await deleteLTMEntry(uid);
            }
            // Entry rewrites/regenerations replace their target.
            if (job.rewriteTargetUid !== undefined) await deleteLTMEntry(job.rewriteTargetUid);

            // Only from-scratch summaries of new messages advance chat
            // coverage — merges and rewrites/regenerations of old entries
            // don't cover new ground and must NOT move the cursor backward.
            if (job.isFreshSummary) recordLTMCoverage(job.range.lastMessageId);
            jobs.delete(job.id);
            discardDraftState(job.chatId);
        } else if (selectedRef.current?.kind === 'entry') {
            const entry = selectedRef.current.entry;
            await saveLTMEntry({
                uid: entry.uid,
                title: resolveTitleForSave(text, entry.title),
                content: text,
                pinned: entry.pinned,
                sourceRange: entry.sourceRange ?? null,
            });
        } else {
            return;
        }

        await demoteExcessLTMs();
        toast('success', 'Memory saved 🧠');
        selectedRef.current = null;
        clearEditorDisplay();
        await refreshSidebar();
        updateChip();
    } catch (err) {
        ltmWarn('save failed', err);
        toast('error', `Save failed: ${err?.message ?? err}`);
    }
}

// Checkboxes are shared between Merge (needs exactly 2) and bulk-Delete
// (needs 1+) — no cap on how many can be checked, each button just enables
// or stays disabled based on the count it actually needs.
function setEntryChecked(entry, rowEl, checked) {
    if (checked) {
        checkedEntries.set(entry.uid, entry);
        rowEl.classList.add('wlm-selected');
    } else {
        checkedEntries.delete(entry.uid);
        rowEl.classList.remove('wlm-selected');
    }
    /** @type {HTMLButtonElement} */ (document.getElementById('wlm-merge-btn')).disabled = checkedEntries.size !== 2;
    /** @type {HTMLButtonElement} */ (document.getElementById('wlm-bulk-delete-btn')).disabled = checkedEntries.size === 0;
}

async function onMergeClicked() {
    if (checkedEntries.size !== 2) return;
    const [a, b] = [...checkedEntries.values()];
    const job = createJob(getCurrentChatId(), null, {
        messagesOverride: buildMergePrompt(a, b),
        isFreshSummary: false,
        sourceRangeForSave: unionSourceRange(a.sourceRange, b.sourceRange),
        mergeSourceUids: [a.uid, b.uid],
    });
    checkedEntries.clear();
    await refreshSidebar();
    selectJob(job);
    generateDraft(job);
}

async function onBulkDeleteClicked() {
    if (checkedEntries.size === 0) return;
    const entries = [...checkedEntries.values()];
    const count = entries.length;
    if (!window.confirm(`Delete ${count} ${count === 1 ? 'memory' : 'memories'} permanently? This can't be undone.`)) {
        return;
    }
    let failures = 0;
    for (const entry of entries) {
        try {
            await deleteLTMEntry(entry.uid);
        } catch (err) {
            failures++;
            ltmWarn(`bulk delete failed for "${entry.title}"`, err);
        }
    }
    checkedEntries.clear();
    if (failures === 0) {
        toast('success', `Deleted ${count} ${count === 1 ? 'memory' : 'memories'}`);
    } else {
        toast('error', `Deleted ${count - failures}/${count} — ${failures} failed, check console`);
    }
    // The active editor selection may have just been deleted out from under it.
    selectedRef.current = null;
    clearEditorDisplay();
    await refreshSidebar();
    updateChip();
}

// =====================================================================
// SLASH COMMANDS
// =====================================================================

function registerSlashCommands() {
    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'ltm',
            callback: async () => { await openPanel(); return ''; },
            helpString: 'Opens the Weyland Long-Term Memory panel.',
        }));
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'ltm-new',
            callback: async () => {
                injectModal();
                await onNewLTMClicked();
                return '';
            },
            helpString: 'Queues a new LTM draft from recent messages (generation runs in the background).',
        }));
        ltmLog('slash commands registered: /ltm, /ltm-new');
    } catch (err) {
        ltmWarn('slash command registration failed', err);
    }
}

// =====================================================================
// WAND MENU ENTRY (Extensions dropdown)
// =====================================================================

function addWandMenuItem() {
    const container = document.getElementById('extensionsMenu');
    if (!container || document.getElementById('wlm-wand-item')) return;
    const item = document.createElement('div');
    item.id = 'wlm-wand-item';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = '<span>🧠</span><span>Long-Term Memory</span>';
    item.addEventListener('click', () => openPanel());
    container.appendChild(item);
}

// =====================================================================
// BOOTSTRAP
// =====================================================================

(function init() {
    try {
        loadSettings();
        ensureChip();
        registerSlashCommands();
        addWandMenuItem();

        eventSource?.on?.(event_types?.CHAT_CHANGED, () => {
            resetEditorSelection();
            updateChip();
            if (document.getElementById(MODAL_ID)?.style.display === 'block') {
                refreshSidebar();
            }
        });
        eventSource?.on?.(event_types?.MESSAGE_RECEIVED, () => updateChip());
        eventSource?.on?.(event_types?.APP_READY, () => addWandMenuItem());

        console.info(`[${WLM_MODULE_NAME}] initialized v${EXT_VERSION}`);
    } catch (err) {
        console.error(`[${WLM_MODULE_NAME}] init failed`, err);
    }
})();
