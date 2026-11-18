// GENERATED from src/lib/strategic-context.ts by scripts/generate-xmatrix-svg-mirror.cjs: do not edit.
// The local mode (json-store.js) keeps the written frame of a strategy with it.

// The written frame of a strategy (docs/sprint-contexte-strategique.md): why the
// organization exists (purpose, one per organization, with translations) and, per
// matrix, where it wants to be (vision), where it starts from (context) and what it
// chose and gave up (tradeoffs). An agent arriving cold reads why, not only what.
//
// Each level keeps a draft and a validated version. An agent writes the draft only;
// a person validates in the app (the routes enforce that, not this file). Only what
// is validated AND shared ever leaves the organization.
//
// Stored as Json (organizations.purpose, matrices.context). Pure and dependency-free:
// mcp-server/lib/strategic-context.js is generated from this file
// (node scripts/generate-xmatrix-svg-mirror.cjs) so the local mode applies the same rules.
export const MATRIX_SECTIONS = ['vision', 'context', 'tradeoffs'];
export const CONTEXT_VISIBILITIES = ['shared', 'internal'];
export const DRAFT_ORIGINS = ['app', 'agent'];
export const SECTION_MAX = 4000;
export const PURPOSE_MAX = 3000;
export const PURPOSE_LABEL_MAX = 60;
/** Why and where to: meant to be told. Where from and what was given up: internal unless said otherwise. */
export const DEFAULT_VISIBILITY = {
    purpose: 'shared',
    vision: 'shared',
    context: 'internal',
    tradeoffs: 'internal',
};
const fail = (code, message) => ({ ok: false, code, message });
function isObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}
/** A text as stored: one line-ending, no surrounding blank; null when nothing is left or it does not fit. */
function cleanText(v, max) {
    if (typeof v !== 'string')
        return null;
    const t = v.replace(/\r\n?/g, '\n').trim();
    return t.length > 0 && t.length <= max ? t : null;
}
function isVisibility(v) {
    return v === 'shared' || v === 'internal';
}
function isLocale(v) {
    return typeof v === 'string' && /^[a-z]{2}$/.test(v);
}
function isOrigin(v) {
    return v === 'app' || v === 'agent';
}
const idOrNull = (v) => (typeof v === 'string' && v.length > 0 ? v : null);
// ---------------------------------------------------------------------------
// Matrix: vision, context, tradeoffs
// ---------------------------------------------------------------------------
function readMatrixDoc(raw) {
    const doc = {};
    if (!isObject(raw))
        return doc;
    for (const s of MATRIX_SECTIONS) {
        const t = cleanText(raw[s], SECTION_MAX);
        if (t)
            doc[s] = t;
    }
    if (isObject(raw.visibility)) {
        const vis = {};
        for (const s of MATRIX_SECTIONS)
            if (isVisibility(raw.visibility[s]))
                vis[s] = raw.visibility[s];
        if (Object.keys(vis).length > 0)
            doc.visibility = vis;
    }
    return doc;
}
const hasMatrixText = (doc) => MATRIX_SECTIONS.some((s) => !!doc[s]);
/** The sections and their visibility alone: what a draft says, without who wrote it and when. */
function matrixDocOf(source) {
    const doc = {};
    for (const s of MATRIX_SECTIONS)
        if (source[s])
            doc[s] = source[s];
    if (source.visibility && Object.keys(source.visibility).length > 0)
        doc.visibility = { ...source.visibility };
    return doc;
}
export function sectionVisibility(doc, section) {
    return doc.visibility?.[section] ?? DEFAULT_VISIBILITY[section];
}
function sameMatrixDoc(a, b) {
    return MATRIX_SECTIONS.every((s) => (a[s] ?? null) === (b[s] ?? null) && sectionVisibility(a, s) === sectionVisibility(b, s));
}
/** What is stored, read back: anything that no longer parses reads as absent, never as an error. */
export function readMatrixContext(raw) {
    const out = {};
    if (!isObject(raw))
        return out;
    if (isObject(raw.published) && typeof raw.published.validatedAt === 'string') {
        const doc = readMatrixDoc(raw.published);
        if (hasMatrixText(doc))
            out.published = { ...doc, validatedBy: idOrNull(raw.published.validatedBy), validatedAt: raw.published.validatedAt };
    }
    if (isObject(raw.draft) && typeof raw.draft.updatedAt === 'string') {
        out.draft = {
            ...readMatrixDoc(raw.draft),
            updatedBy: idOrNull(raw.draft.updatedBy),
            updatedAt: raw.draft.updatedAt,
            origin: isOrigin(raw.draft.origin) ? raw.draft.origin : 'app',
        };
    }
    return out;
}
/**
 * The stored value after a change to the draft. The draft starts from the validated
 * version, so a change to one section proposes the whole next version. Each field
 * given replaces, null clears, absent keeps. A draft that ends up saying what is
 * already validated is no draft: nothing would be left to validate.
 */
export function patchMatrixDraft(raw, patch, meta) {
    if (!isObject(patch))
        return fail('VALIDATION_ERROR', 'Expected an object.');
    const touched = MATRIX_SECTIONS.filter((s) => patch[s] !== undefined);
    const vis = patch.visibility;
    if (vis !== undefined && !isObject(vis))
        return fail('VALIDATION_ERROR', 'visibility: expected an object keyed by section.');
    const visTouched = vis ? MATRIX_SECTIONS.filter((s) => vis[s] !== undefined) : [];
    if (touched.length === 0 && visTouched.length === 0)
        return fail('EMPTY_UPDATE', 'No changes provided');
    const stored = readMatrixContext(raw);
    const base = stored.draft ?? stored.published ?? {};
    const doc = {};
    for (const s of MATRIX_SECTIONS)
        if (base[s])
            doc[s] = base[s];
    const visibility = { ...(base.visibility ?? {}) };
    for (const s of touched) {
        const v = patch[s];
        if (v === null) {
            delete doc[s];
            continue;
        }
        if (typeof v !== 'string')
            return fail('VALIDATION_ERROR', `${s}: expected a text, or null to clear it.`);
        const normalized = v.replace(/\r\n?/g, '\n').trim();
        if (normalized.length === 0)
            return fail('VALIDATION_ERROR', `${s}: empty text. Pass null to clear the section.`);
        if (normalized.length > SECTION_MAX)
            return fail('VALIDATION_ERROR', `${s}: ${normalized.length} characters, ${SECTION_MAX} at most.`);
        doc[s] = normalized;
    }
    for (const s of visTouched) {
        const v = vis[s];
        if (!isVisibility(v))
            return fail('VALIDATION_ERROR', `visibility.${s}: expected "shared" or "internal".`);
        visibility[s] = v;
    }
    if (Object.keys(visibility).length > 0)
        doc.visibility = visibility;
    // The same draft sent again is not a new draft: its author, its origin and the day
    // it started to wait stay (an agent re-sending a person's text would otherwise
    // take it over and restart the wait the agenda counts).
    if (stored.draft && sameMatrixDoc(doc, stored.draft))
        return { ok: true, value: stored };
    const next = {};
    if (stored.published)
        next.published = stored.published;
    if (!sameMatrixDoc(doc, stored.published ?? {})) {
        next.draft = { ...doc, updatedBy: meta.by, updatedAt: meta.at.toISOString(), origin: meta.origin };
    }
    return { ok: true, value: next };
}
const DRAFT_CHANGED = 'The draft changed since you read it. Read it again before validating.';
const EMPTY_DRAFT = 'This draft has no text and nothing is validated yet: there is nothing to validate. Write the text, or discard the draft.';
/** The draft becomes the validated version. A draft with no text left withdraws the validated one. */
export function validateMatrixContext(raw, meta) {
    const stored = readMatrixContext(raw);
    if (!stored.draft)
        return fail('NO_DRAFT', 'There is no draft to validate.');
    if (meta.expectedDraftAt !== undefined && meta.expectedDraftAt !== stored.draft.updatedAt)
        return fail('DRAFT_CHANGED', DRAFT_CHANGED);
    const doc = matrixDocOf(stored.draft);
    if (!hasMatrixText(doc) && !stored.published)
        return fail('EMPTY_DRAFT', EMPTY_DRAFT);
    if (!hasMatrixText(doc))
        return { ok: true, value: {} };
    return { ok: true, value: { published: { ...doc, validatedBy: meta.by, validatedAt: meta.at.toISOString() } } };
}
export function discardMatrixDraft(raw) {
    const stored = readMatrixContext(raw);
    if (!stored.draft)
        return fail('NO_DRAFT', 'There is no draft to discard.');
    return { ok: true, value: stored.published ? { published: stored.published } : {} };
}
/**
 * The frame of a matrix as it lands in a copy (another organization, or the example
 * a new organization starts from): the text of the source, as a draft. Nobody of
 * the new organization validated it, and the name of who did elsewhere stays there.
 */
export function contextAsDraft(raw, meta) {
    const stored = readMatrixContext(raw);
    const source = stored.published ?? stored.draft;
    if (!source || !hasMatrixText(source))
        return {};
    return { draft: { ...matrixDocOf(source), updatedBy: meta.by, updatedAt: meta.at.toISOString(), origin: meta.origin } };
}
function matrixDocView(doc) {
    return {
        vision: doc.vision ?? null,
        context: doc.context ?? null,
        tradeoffs: doc.tradeoffs ?? null,
        visibility: {
            vision: sectionVisibility(doc, 'vision'),
            context: sectionVisibility(doc, 'context'),
            tradeoffs: sectionVisibility(doc, 'tradeoffs'),
        },
    };
}
/** What a member (or their agent) reads: the validated version, and the draft told apart. */
export function matrixContextView(raw) {
    const stored = readMatrixContext(raw);
    return {
        ...matrixDocView(stored.published ?? {}),
        validatedAt: stored.published?.validatedAt ?? null,
        validatedBy: stored.published?.validatedBy ?? null,
        draft: stored.draft
            ? { ...matrixDocView(stored.draft), updatedAt: stored.draft.updatedAt, updatedBy: stored.draft.updatedBy, origin: stored.draft.origin }
            : null,
    };
}
/** What may leave the organization: validated sections marked shared. Never a draft. */
export function externalMatrixContext(raw) {
    const doc = readMatrixContext(raw).published ?? {};
    const show = (s) => (doc[s] && sectionVisibility(doc, s) === 'shared' ? doc[s] : null);
    return { vision: show('vision'), context: show('context'), tradeoffs: show('tradeoffs') };
}
/** The validated sections, with their visibility: what a review snapshot freezes. */
export function publishedMatrixContext(raw) {
    const stored = readMatrixContext(raw);
    if (!stored.published)
        return null;
    return { ...matrixDocView(stored.published), validatedAt: stored.published.validatedAt };
}
/** Since when a draft waits, or null. The agenda decides when that is too long. */
export function draftWaitingSince(raw) {
    if (!isObject(raw) || !isObject(raw.draft))
        return null;
    return typeof raw.draft.updatedAt === 'string' ? raw.draft.updatedAt : null;
}
// ---------------------------------------------------------------------------
// Organization: purpose
// ---------------------------------------------------------------------------
function readPurposeDoc(raw) {
    const doc = {};
    if (!isObject(raw))
        return doc;
    const text = cleanText(raw.text, PURPOSE_MAX);
    if (text)
        doc.text = text;
    const label = cleanText(raw.label, PURPOSE_LABEL_MAX);
    if (label)
        doc.label = label;
    if (isVisibility(raw.visibility))
        doc.visibility = raw.visibility;
    if (isLocale(raw.locale))
        doc.locale = raw.locale;
    return doc;
}
export function readPurpose(raw) {
    const out = {};
    if (!isObject(raw))
        return out;
    if (isObject(raw.published) && typeof raw.published.validatedAt === 'string') {
        const doc = readPurposeDoc(raw.published);
        if (doc.text)
            out.published = { ...doc, validatedBy: idOrNull(raw.published.validatedBy), validatedAt: raw.published.validatedAt };
    }
    if (isObject(raw.draft) && typeof raw.draft.updatedAt === 'string') {
        out.draft = {
            ...readPurposeDoc(raw.draft),
            updatedBy: idOrNull(raw.draft.updatedBy),
            updatedAt: raw.draft.updatedAt,
            origin: isOrigin(raw.draft.origin) ? raw.draft.origin : 'app',
        };
    }
    if (out.published && isObject(raw.translations)) {
        const translations = {};
        for (const [locale, value] of Object.entries(raw.translations)) {
            if (!isLocale(locale) || !isObject(value) || typeof value.sourceAt !== 'string')
                continue;
            const text = cleanText(value.text, PURPOSE_MAX);
            if (!text)
                continue;
            const label = cleanText(value.label, PURPOSE_LABEL_MAX);
            translations[locale] = { text, ...(label && { label }), sourceAt: value.sourceAt };
        }
        if (Object.keys(translations).length > 0)
            out.translations = translations;
    }
    return out;
}
/** The purpose a draft proposes, without who wrote it and when. */
function purposeDocOf(source) {
    const doc = {};
    if (source.text)
        doc.text = source.text;
    if (source.label)
        doc.label = source.label;
    if (source.visibility)
        doc.visibility = source.visibility;
    if (source.locale)
        doc.locale = source.locale;
    return doc;
}
const samePurposeDoc = (a, b) => (a.text ?? null) === (b.text ?? null) &&
    (a.label ?? null) === (b.label ?? null) &&
    (a.visibility ?? DEFAULT_VISIBILITY.purpose) === (b.visibility ?? DEFAULT_VISIBILITY.purpose) &&
    (a.locale ?? null) === (b.locale ?? null);
/**
 * The stored value after a change to the draft of the purpose. `defaultLocale` is
 * the language of whoever writes: the language of a first text, unless one is given.
 */
export function patchPurposeDraft(raw, patch, meta) {
    if (!isObject(patch))
        return fail('VALIDATION_ERROR', 'Expected an object.');
    if (patch.text === undefined && patch.label === undefined && patch.visibility === undefined && patch.locale === undefined) {
        return fail('EMPTY_UPDATE', 'No changes provided');
    }
    const stored = readPurpose(raw);
    const doc = purposeDocOf(stored.draft ?? stored.published ?? {});
    for (const [key, max] of [['text', PURPOSE_MAX], ['label', PURPOSE_LABEL_MAX]]) {
        const v = patch[key];
        if (v === undefined)
            continue;
        if (v === null) {
            delete doc[key];
            continue;
        }
        if (typeof v !== 'string')
            return fail('VALIDATION_ERROR', `${key}: expected a text, or null to clear it.`);
        const normalized = v.replace(/\r\n?/g, '\n').trim();
        if (normalized.length === 0)
            return fail('VALIDATION_ERROR', `${key}: empty text. Pass null to clear it.`);
        if (normalized.length > max)
            return fail('VALIDATION_ERROR', `${key}: ${normalized.length} characters, ${max} at most.`);
        doc[key] = normalized;
    }
    if (patch.visibility !== undefined) {
        if (!isVisibility(patch.visibility))
            return fail('VALIDATION_ERROR', 'visibility: expected "shared" or "internal".');
        doc.visibility = patch.visibility;
    }
    if (patch.locale !== undefined) {
        if (!isLocale(patch.locale))
            return fail('VALIDATION_ERROR', 'locale: expected a two-letter language code.');
        doc.locale = patch.locale;
    }
    if (!doc.locale && isLocale(meta.defaultLocale))
        doc.locale = meta.defaultLocale;
    // The same draft sent again keeps its author, its origin and its date (see patchMatrixDraft).
    if (stored.draft && samePurposeDoc(doc, stored.draft))
        return { ok: true, value: stored };
    const next = {};
    if (stored.published)
        next.published = stored.published;
    if (stored.translations)
        next.translations = stored.translations;
    if (!samePurposeDoc(doc, stored.published ?? {}) && (stored.published || doc.text || doc.label)) {
        next.draft = { ...doc, updatedBy: meta.by, updatedAt: meta.at.toISOString(), origin: meta.origin };
    }
    return { ok: true, value: next };
}
/**
 * The draft becomes the validated purpose. A draft with no text withdraws it, and its
 * translations with it. A translation follows a validation that changed neither the
 * text nor the label; otherwise it stays stored but is stale (see purposeIn).
 */
export function validatePurpose(raw, meta) {
    const stored = readPurpose(raw);
    if (!stored.draft)
        return fail('NO_DRAFT', 'There is no draft to validate.');
    if (meta.expectedDraftAt !== undefined && meta.expectedDraftAt !== stored.draft.updatedAt)
        return fail('DRAFT_CHANGED', DRAFT_CHANGED);
    const doc = purposeDocOf(stored.draft);
    if (!doc.text && !stored.published)
        return fail('EMPTY_DRAFT', EMPTY_DRAFT);
    if (!doc.text)
        return { ok: true, value: {} };
    const validatedAt = meta.at.toISOString();
    const next = { published: { ...doc, validatedBy: meta.by, validatedAt } };
    if (stored.translations) {
        const before = stored.published;
        const unchanged = !!before && before.text === doc.text && (before.label ?? null) === (doc.label ?? null);
        const translations = {};
        for (const [locale, t] of Object.entries(stored.translations)) {
            if (locale === doc.locale)
                continue;
            translations[locale] = unchanged && t.sourceAt === before.validatedAt ? { ...t, sourceAt: validatedAt } : t;
        }
        if (Object.keys(translations).length > 0)
            next.translations = translations;
    }
    return { ok: true, value: next };
}
export function discardPurposeDraft(raw) {
    const stored = readPurpose(raw);
    if (!stored.draft)
        return fail('NO_DRAFT', 'There is no draft to discard.');
    const rest = {};
    if (stored.published)
        rest.published = stored.published;
    if (stored.translations)
        rest.translations = stored.translations;
    return { ok: true, value: rest };
}
/** A translation of the validated purpose. There is nothing to translate before a validation. */
export function setPurposeTranslation(raw, locale, input) {
    const stored = readPurpose(raw);
    if (!stored.published)
        return fail('PURPOSE_NOT_VALIDATED', 'Validate the purpose before translating it.');
    if (!isLocale(locale))
        return fail('VALIDATION_ERROR', 'locale: expected a two-letter language code.');
    if (locale === stored.published.locale)
        return fail('SOURCE_LOCALE', 'This is the language the purpose is written in: change the purpose itself.');
    const text = cleanText(input?.text, PURPOSE_MAX);
    if (!text)
        return fail('VALIDATION_ERROR', `text: required, ${PURPOSE_MAX} characters at most.`);
    let label = null;
    if (input.label !== undefined && input.label !== null) {
        label = cleanText(input.label, PURPOSE_LABEL_MAX);
        if (!label)
            return fail('VALIDATION_ERROR', `label: ${PURPOSE_LABEL_MAX} characters at most.`);
    }
    const translation = { text, ...(label && { label }), sourceAt: stored.published.validatedAt };
    return { ok: true, value: { ...stored, translations: { ...(stored.translations ?? {}), [locale]: translation } } };
}
export function removePurposeTranslation(raw, locale) {
    const stored = readPurpose(raw);
    if (!stored.translations?.[locale])
        return fail('TRANSLATION_NOT_FOUND', 'No translation in this language.');
    const others = Object.fromEntries(Object.entries(stored.translations).filter(([key]) => key !== locale));
    const rest = {};
    if (stored.published)
        rest.published = stored.published;
    if (stored.draft)
        rest.draft = stored.draft;
    if (Object.keys(others).length > 0)
        rest.translations = others;
    return { ok: true, value: rest };
}
/**
 * The validated purpose in the first language of `preferred` it exists in, else in
 * the language it was written in. A translation made for an earlier text is not served.
 */
export function purposeIn(raw, preferred) {
    const stored = readPurpose(raw);
    const source = stored.published;
    if (!source?.text)
        return null;
    for (const locale of preferred) {
        if (!locale)
            continue;
        if (locale === source.locale)
            break;
        const t = stored.translations?.[locale];
        if (t && t.sourceAt === source.validatedAt)
            return { label: t.label ?? source.label ?? null, text: t.text, locale, translated: true };
    }
    return { label: source.label ?? null, text: source.text, locale: source.locale ?? null, translated: false };
}
/** What a member reads of the purpose, in their language when it exists. */
export function purposeView(raw, preferred) {
    const stored = readPurpose(raw);
    const read = purposeIn(raw, preferred);
    return {
        label: read?.label ?? null,
        text: read?.text ?? null,
        locale: read?.locale ?? null,
        sourceLocale: stored.published?.locale ?? null,
        visibility: stored.published?.visibility ?? DEFAULT_VISIBILITY.purpose,
        validatedAt: stored.published?.validatedAt ?? null,
        validatedBy: stored.published?.validatedBy ?? null,
        translations: Object.entries(stored.translations ?? {}).map(([locale, t]) => ({
            locale,
            stale: t.sourceAt !== stored.published?.validatedAt,
        })),
        draft: stored.draft
            ? {
                label: stored.draft.label ?? null,
                text: stored.draft.text ?? null,
                locale: stored.draft.locale ?? null,
                visibility: stored.draft.visibility ?? DEFAULT_VISIBILITY.purpose,
                updatedAt: stored.draft.updatedAt,
                updatedBy: stored.draft.updatedBy,
                origin: stored.draft.origin,
            }
            : null,
    };
}
/** The purpose as it may be shown outside: validated and shared, or nothing. */
export function externalPurpose(raw, preferred) {
    const stored = readPurpose(raw);
    if (!stored.published || (stored.published.visibility ?? DEFAULT_VISIBILITY.purpose) !== 'shared')
        return null;
    const read = purposeIn(raw, preferred);
    return read ? { label: read.label, text: read.text, locale: read.locale } : null;
}
/** A stored translation, as written (settings screen): null when there is none. */
export function purposeTranslation(raw, locale) {
    const stored = readPurpose(raw);
    const t = stored.translations?.[locale];
    if (!t)
        return null;
    return { locale, text: t.text, label: t.label ?? null, stale: t.sourceAt !== stored.published?.validatedAt };
}
