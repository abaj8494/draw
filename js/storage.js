/**
 * Storage Module - LocalStorage for auto-save, Server API for named saves
 */

const Storage = {
    AUTO_SAVE_KEY: 'draw_autosave',
    SETTINGS_KEY: 'draw_settings',

    /**
     * Initialize storage (no-op for server storage)
     */
    async init() {
        // No initialization needed for server storage
        return Promise.resolve();
    },

    /**
     * Generate default name based on AEST date/time
     */
    generateDefaultName() {
        const now = new Date();
        // Convert to AEST (UTC+10)
        const aestOffset = 10 * 60;
        const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
        const aestTime = new Date(utcTime + (aestOffset * 60000));

        const year = aestTime.getFullYear();
        const month = String(aestTime.getMonth() + 1).padStart(2, '0');
        const day = String(aestTime.getDate()).padStart(2, '0');
        const hours = String(aestTime.getHours()).padStart(2, '0');
        const minutes = String(aestTime.getMinutes()).padStart(2, '0');
        const seconds = String(aestTime.getSeconds()).padStart(2, '0');

        return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
    },

    /**
     * Auto-save current drawing to LocalStorage
     */
    autoSave(drawingState) {
        try {
            const data = JSON.stringify(drawingState);
            localStorage.setItem(this.AUTO_SAVE_KEY, data);
        } catch (e) {
            console.error('Auto-save failed:', e);
        }
    },

    /**
     * Load auto-saved drawing from LocalStorage
     */
    loadAutoSave() {
        try {
            const data = localStorage.getItem(this.AUTO_SAVE_KEY);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.error('Failed to load auto-save:', e);
            return null;
        }
    },

    /**
     * Clear auto-save
     */
    clearAutoSave() {
        localStorage.removeItem(this.AUTO_SAVE_KEY);
    },

    /**
     * Save settings to LocalStorage
     */
    saveSettings(settings) {
        try {
            localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(settings));
        } catch (e) {
            console.error('Failed to save settings:', e);
        }
    },

    /**
     * Load settings from LocalStorage
     */
    loadSettings() {
        try {
            const data = localStorage.getItem(this.SETTINGS_KEY);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.error('Failed to load settings:', e);
            return null;
        }
    },

    /**
     * Save drawing to server
     */
    async saveDrawing(name, drawingState) {
        const saveName = name || this.generateDefaultName();

        const response = await fetch('/api/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: saveName,
                data: drawingState
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save');
        }

        const result = await response.json();
        return result.name;
    },

    /**
     * Load drawing from server
     */
    async loadDrawing(name) {
        const response = await fetch(`/api/load/${encodeURIComponent(name)}`);

        if (!response.ok) {
            throw new Error('Drawing not found');
        }

        const data = await response.json();
        return {
            id: name,
            name: name,
            data: data
        };
    },

    /**
     * List all saved drawings from server
     */
    async listDrawings() {
        const response = await fetch('/api/list');

        if (!response.ok) {
            throw new Error('Failed to list drawings');
        }

        const files = await response.json();
        return files.map(f => ({
            id: f.name,
            name: f.name,
            timestamp: f.timestamp * 1000 // Convert to milliseconds
        }));
    },

    /**
     * Delete drawing from server
     */
    async deleteDrawing(name) {
        const response = await fetch(`/api/delete/${encodeURIComponent(name)}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('Failed to delete drawing');
        }
    }
};
