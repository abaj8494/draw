/**
 * Storage Module - LocalStorage & IndexedDB management
 */

const Storage = {
    DB_NAME: 'DrawingApp',
    DB_VERSION: 1,
    STORE_NAME: 'drawings',
    AUTO_SAVE_KEY: 'draw_autosave',
    SETTINGS_KEY: 'draw_settings',
    db: null,

    /**
     * Initialize IndexedDB
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onerror = () => {
                console.error('Failed to open IndexedDB:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
                    store.createIndex('name', 'name', { unique: false });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    },

    /**
     * Generate default name based on AEST date/time
     */
    generateDefaultName() {
        const now = new Date();
        // Convert to AEST (UTC+10/UTC+11 with DST)
        const aestOffset = 10 * 60; // AEST is UTC+10
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
     * Save drawing to IndexedDB
     */
    async saveDrawing(name, drawingState) {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        const drawing = {
            id: name || this.generateDefaultName(),
            name: name || this.generateDefaultName(),
            data: drawingState,
            timestamp: Date.now()
        };

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);
            const request = store.put(drawing);

            request.onsuccess = () => resolve(drawing.id);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Load drawing from IndexedDB
     */
    async loadDrawing(id) {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
            const store = transaction.objectStore(this.STORE_NAME);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * List all saved drawings
     */
    async listDrawings() {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
            const store = transaction.objectStore(this.STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                const drawings = request.result.sort((a, b) => b.timestamp - a.timestamp);
                resolve(drawings);
            };
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Delete drawing from IndexedDB
     */
    async deleteDrawing(id) {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
};
