// Outlier — spoiler-free share text and the share/copy action.
import { tierById, MAX_SCORE } from './scoring.js';

/**
 * Outlier #331 · 455/700
 * 🟧🟩⬜🟪🟦🟩⬛
 * <url, if given>
 * `rounds` may be RoundResults ({tierId, points}) or tier id strings.
 * `score` defaults to the sum of round points.
 */
export function shareText({ day, rounds = [], score, url, max = MAX_SCORE } = {}) {
  const tiers = rounds.map((r) => tierById(typeof r === 'string' ? r : r && r.tierId) || tierById('miss'));
  const total = score ?? rounds.reduce((s, r, i) => s + (typeof r === 'string' ? tiers[i].points : (r && r.points) || 0), 0);
  const lines = [`Outlier #${day} · ${total}/${max}`, tiers.map((t) => t.emoji).join('')];
  if (url) lines.push(String(url));
  return lines.join('\n');
}

function prefersShareSheet() {
  try {
    return !!(globalThis.matchMedia && globalThis.matchMedia('(pointer: coarse)').matches);
  } catch {
    return false;
  }
}

function legacyCopy(text) {
  try {
    const doc = globalThis.document;
    if (!doc || !doc.body || typeof doc.execCommand !== 'function') return false;
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    doc.body.appendChild(ta);
    ta.select();
    const ok = doc.execCommand('copy');
    doc.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}

/**
 * Share via the native share sheet (on touch devices, or when opts.preferShare) and fall back
 * to the clipboard. Resolves 'shared' | 'copied' | 'failed'. A user-cancelled share sheet
 * resolves 'failed' without copying.
 */
export async function shareResult(text, { preferShare = prefersShareSheet() } = {}) {
  const nav = globalThis.navigator;
  if (preferShare && nav && typeof nav.share === 'function') {
    try {
      await nav.share({ text });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'failed';
      // otherwise fall through to clipboard
    }
  }
  if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
    try {
      await nav.clipboard.writeText(text);
      return 'copied';
    } catch { /* try legacy */ }
  }
  return legacyCopy(text) ? 'copied' : 'failed';
}
