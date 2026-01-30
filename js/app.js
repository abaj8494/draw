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

            // Load saved state
            await this.loadSavedState();

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
