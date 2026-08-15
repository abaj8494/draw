/**
 * Reducer Module - the ONE definition of how a sync op mutates a document.
 *
 * Loaded as a plain browser script by index.html (used by js/sync.js) and
 * require()d by the server (server/rooms.js). Because both sides run this
 * exact file, client and server materialize identical documents from the same
 * op stream - the parity the sync design depends on.
 *
 * A document is { strokes: [...], background: 'grid-light' }. The strokes
 * array is always mutated IN PLACE so a caller holding a reference to it
 * (Canvas.strokes) stays live across applies.
 */

const Reducer = {
    OP_KINDS: ['add', 'upsert', 'delete', 'clear', 'background'],

    BACKGROUNDS: [
        'grid-light', 'grid-dark', 'grid-sepia',
        'blank-light', 'blank-dark', 'blank-sepia'
    ],

    indexById(strokes, id) {
        for (let i = 0; i < strokes.length; i++) {
            if (strokes[i] && strokes[i].id === id) return i;
        }
        return -1;
    },

    /**
     * Apply one op to a document. Returns true when the document changed.
     * Unknown/malformed ops are ignored (returns false) - full validation is
     * the server's job before an op ever reaches the log.
     */
    apply(doc, op) {
        if (!doc || !op || typeof op.kind !== 'string') return false;

        switch (op.kind) {
            case 'add': {
                const stroke = op.stroke;
                if (!stroke || !stroke.id) return false;
                const existing = this.indexById(doc.strokes, stroke.id);
                // A replayed add is an upsert: last write wins, position kept.
                if (existing >= 0) doc.strokes[existing] = stroke;
                else doc.strokes.push(stroke);
                return true;
            }

            case 'upsert': {
                if (!Array.isArray(op.strokes)) return false;
                let changed = false;
                for (const stroke of op.strokes) {
                    if (!stroke || !stroke.id) continue;
                    const existing = this.indexById(doc.strokes, stroke.id);
                    if (existing >= 0) doc.strokes[existing] = stroke;
                    else doc.strokes.push(stroke);
                    changed = true;
                }
                return changed;
            }

            case 'delete': {
                if (!Array.isArray(op.ids)) return false;
                let changed = false;
                for (const id of op.ids) {
                    const existing = this.indexById(doc.strokes, id);
                    if (existing >= 0) {
                        doc.strokes.splice(existing, 1);
                        changed = true;
                    }
                }
                return changed;
            }

            case 'clear': {
                if (doc.strokes.length === 0) return false;
                doc.strokes.length = 0;
                return true;
            }

            case 'background': {
                if (this.BACKGROUNDS.indexOf(op.key) === -1) return false;
                if (doc.background === op.key) return false;
                doc.background = op.key;
                return true;
            }

            default:
                return false;
        }
    }
};

// Server-side require() interop; a no-op in the browser.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Reducer;
}
