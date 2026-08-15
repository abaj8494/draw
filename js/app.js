/**
 * Main Application Module
 */

const App = {
    autoSaveTimer: null,
    AUTO_SAVE_DELAY: 1000, // 1 second debounce

    /**
     * Initialize the application
     */
    async init() {
        try {
            // Initialize storage first
            await Storage.init();

            // Initialize canvas
            Canvas.init();

            // Initialize tools
            Tools.init();

            // Initialize UI
            UI.init();

            // Initialize video embedding
            Video.init();

            // Load saved state
            await this.loadSavedState();

            // Start the session layer (fire-and-forget: solo drawing must
            // work even if the server or network is down).
            if (typeof Sync !== 'undefined') {
                Sync.init().catch(err => console.error('Sync init failed:', err));
            }

            console.log('Drawing app initialized');
        } catch (error) {
            console.error('Failed to initialize app:', error);
        }
    },

    /**
     * Load saved state from LocalStorage
     */
    async loadSavedState() {
        // Load auto-saved drawing
        const autoSave = Storage.loadAutoSave();
        if (autoSave) {
            Canvas.loadState(autoSave);
            UI.updateBackgroundSelection(autoSave.background || 'grid-light');
        }

        // Load settings
        const settings = Storage.loadSettings();
        if (settings) {
            Tools.loadSettings(settings);
            UI.loadSettings(settings);
        }

        UI.updateUndoRedoButtons();
    },

    /**
     * Trigger auto-save with debounce
     */
    triggerAutoSave() {
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
        }

        this.autoSaveTimer = setTimeout(() => {
            this.autoSave();
        }, this.AUTO_SAVE_DELAY);
    },

    /**
     * Auto-save current state
     */
    autoSave() {
        // [sync] the shared live document must not clobber the visitor's solo
        // localStorage drawing; the server owns session persistence.
        if (typeof Sync !== 'undefined' && Sync.active) {
            UI.updateUndoRedoButtons();
            return;
        }

        const drawingState = Canvas.getState();
        Storage.autoSave(drawingState);

        const toolSettings = Tools.getSettings();
        Storage.saveSettings(toolSettings);

        // Update undo/redo button states
        UI.updateUndoRedoButtons();
    },

    /**
     * Save drawing to IndexedDB
     */
    async saveDrawing(name) {
        try {
            const state = Canvas.getState();
            await Storage.saveDrawing(name, state);
            console.log('Drawing saved:', name);
        } catch (error) {
            console.error('Failed to save drawing:', error);
            alert('Failed to save drawing. Please try again.');
        }
    },

    /**
     * Load drawing from IndexedDB
     */
    async loadDrawing(id) {
        try {
            // [sync] in a session, Load replaces the LIVE canvas for every
            // participant: the server rebroadcasts the snapshot as ops.
            if (typeof Sync !== 'undefined' && Sync.active) {
                await Sync.loadSnapshot(id);
                return;
            }
            const drawing = await Storage.loadDrawing(id);
            if (drawing && drawing.data) {
                Canvas.loadState(drawing.data);
                UI.updateBackgroundSelection(drawing.data.background || 'grid-light');
                UI.updateUndoRedoButtons();
                this.triggerAutoSave();
                console.log('Drawing loaded:', id);
            }
        } catch (error) {
            console.error('Failed to load drawing:', error);
            alert('Failed to load drawing. Please try again.');
        }
    },

    /**
     * Reset the application
     */
    reset() {
        Canvas.reset();
        Storage.clearAutoSave();
        UI.updateBackgroundSelection('grid-light');
        UI.updateUndoRedoButtons();
    }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
